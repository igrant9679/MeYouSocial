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

export async function isGloballyPaused(workspaceId: string): Promise<boolean> {
  const s = await db.automationState.findUnique({ where: { workspaceId } });
  return s?.globalPause ?? false;
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
}
