import { db } from "@/lib/db";

/**
 * MeYouSocial governance core: the three-mode autonomy dial + global kill
 * switch + audit trail (Spark's AutomationSetting/audit ported and extended).
 *
 * Modes per governed function:
 *   manual   — human drives; AI acts only on explicit clicks
 *   assisted — AI may run work autonomously but queues at a human checkpoint
 *   auto     — end-to-end unattended (scheduler lands in Phase 3; until then
 *              auto behaves like assisted for background runs)
 *
 * The global pause overrides every mode and also blocks manual AI generation —
 * it is the emergency brake for spend and output alike.
 */

export const GOVERNED_FUNCTIONS = [
  "ideation",
  "blog_drafting",
  "video_packaging",
  "video_rendering",
  "publishing",
  "social",
] as const;
export type GovernedFunction = (typeof GOVERNED_FUNCTIONS)[number];

export const MODES = ["manual", "assisted", "auto"] as const;
export type Mode = (typeof MODES)[number];

export const FUNCTION_LABELS: Record<GovernedFunction, string> = {
  ideation: "Idea discovery",
  blog_drafting: "Blog drafting",
  video_packaging: "Video packaging",
  video_rendering: "Video rendering",
  publishing: "Publishing",
  social: "Social distribution",
};

export async function getModes(workspaceId: string): Promise<Record<GovernedFunction, Mode>> {
  const rows = await db.functionMode.findMany({ where: { workspaceId } });
  const out = Object.fromEntries(GOVERNED_FUNCTIONS.map((f) => [f, "manual"])) as Record<GovernedFunction, Mode>;
  for (const r of rows) {
    if ((GOVERNED_FUNCTIONS as readonly string[]).includes(r.function) && (MODES as readonly string[]).includes(r.mode)) {
      out[r.function as GovernedFunction] = r.mode as Mode;
    }
  }
  return out;
}

/**
 * Whether nothing may generate or act for this workspace: the admin's pause (Settings → Automation)
 * OR a hold (lib/workspace-hold.ts — a trial that ended or ran out, a membership that lapsed).
 * Every engine path, sweep and router asks this, so a hold stops them all. ⚠ Pages that show the
 * pause SWITCH, and anything that saves or restores it, ask `isPauseSwitchOn` instead — a hold is
 * not something "Resume" can clear.
 */
export async function isGloballyPaused(workspaceId: string): Promise<boolean> {
  if (await isPauseSwitchOn(workspaceId)) return true;
  const { workspaceHold } = await import("@/lib/workspace-hold");
  return Boolean(await workspaceHold(workspaceId));
}

/** The admin's pause switch alone (Settings → Automation), without holds. */
export async function isPauseSwitchOn(workspaceId: string): Promise<boolean> {
  const s = await db.automationState.findUnique({ where: { workspaceId } });
  return s?.globalPause ?? false;
}

/** Every workspace paused or on hold — for sweeps that span workspaces. */
export async function pausedWorkspaceIds(): Promise<string[]> {
  const switched = (await db.automationState.findMany({ where: { globalPause: true }, select: { workspaceId: true } })).map((r) => r.workspaceId);
  const { heldWorkspaceIds } = await import("@/lib/workspace-hold");
  const held = await heldWorkspaceIds().catch(() => [] as string[]);
  return [...new Set([...switched, ...held])];
}

/**
 * Thrown by the LLM and image routers for a paused workspace. The pause is the
 * emergency brake and says it blocks every AI action, manual clicks included;
 * before this only the paths that remembered to ask honoured it (audit ENG-03).
 */
export class GenerationPausedError extends Error {
  constructor() {
    super("This workspace is paused (Settings → Automation), so no AI generation runs. Resume it there first.");
    this.name = "GenerationPausedError";
  }
}

/** The routers' refusal for a workspace on hold — a pause by another name, saying which (lib/workspace-hold.ts). */
export class WorkspaceOnHoldError extends GenerationPausedError {
  constructor(sentence: string) {
    super();
    this.message = `${sentence} AI, publishing and the engine are stopped until a membership starts — nothing has been deleted.`;
    this.name = "WorkspaceOnHoldError";
  }
}

/** Throws for a workspace on hold, then for the pause switch — what the LLM and image routers ask before every call. */
export async function refuseGenerationIfStopped(workspaceId: string, opts: { allowWhilePaused?: boolean } = {}): Promise<void> {
  const { workspaceHold, holdSentence } = await import("@/lib/workspace-hold");
  const hold = await workspaceHold(workspaceId);
  if (hold) throw new WorkspaceOnHoldError(holdSentence(hold.reason));
  if (!opts.allowWhilePaused && (await isPauseSwitchOn(workspaceId))) throw new GenerationPausedError();
}

/** Append-only audit entry. actorId null = system/AI. Never throws. */
export async function writeAudit(params: {
  workspaceId: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        workspaceId: params.workspaceId,
        actorId: params.actorId ?? null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId ?? null,
        meta: JSON.stringify(params.meta ?? {}),
      },
    });
  } catch {
    // Auditing must never break the action it records.
  }
  // The changes that decide who can do what reach every admin (E-SEC-12).
  try {
    const { sendSecurityNotice } = await import("@/lib/security-notices");
    await sendSecurityNotice(params);
  } catch {
    // A notice must never break the action either.
  }
}
