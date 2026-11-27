import { db } from "@/lib/db";

// A workspace on hold (2026-11-26): its free trial ended, its trial used up the AI allowance, or the
// meyousocial.com membership behind it lapsed. Nothing is deleted. While held:
// - its members (never the platform operator) are sent to /on-hold from every page, action and
//   route that resolves a workspace (lib/acl.ts requireMembership);
// - `isGloballyPaused` answers true (lib/governance.ts), so every engine path, sweep and AI router
//   that already honours the pause stops for it too — without a hold being a pause someone can
//   "Resume" from Settings → Automation;
// - the AI routers name the hold rather than the pause (WorkspaceOnHoldError).
// A trial's end and allowance are read live; a lapse is a stamp (`heldAt`, `holdReason`) the
// membership's return clears. Cached for 30 s per workspace, like settings.

export type HoldReason = "trial_ended" | "trial_used_up" | "membership_lapsed";
export type Hold = { reason: HoldReason; since: Date | null };
export type TrialUsage = { tokens: number; uncountedCalls: number; images: number };
export type TrialCaps = { tokens: number; images: number };

/**
 * A text call whose size the provider didn't report (a streamed reply) counts as this many tokens
 * against a trial's allowance — otherwise streaming would be a way round the limit. Only the
 * allowance uses it; Usage still shows measured tokens only.
 */
export const UNCOUNTED_CALL_TOKENS = 3000;

const REASONS: ReadonlySet<string> = new Set<HoldReason>(["trial_ended", "trial_used_up", "membership_lapsed"]);

type HoldRow = { trialEndsAt: Date | null; heldAt: Date | null; holdReason: string | null };

/** Tokens counted against a trial: measured ones plus the estimate for calls that reported none. */
export function trialTokens(u: TrialUsage): number {
  return u.tokens + u.uncountedCalls * UNCOUNTED_CALL_TOKENS;
}

/** Pure: the hold a workspace is under. A cap of 0 is no cap. */
export function holdFrom(ws: HoldRow, usage: TrialUsage | null, caps: TrialCaps, now = Date.now()): Hold | null {
  if (ws.heldAt) {
    const reason = ws.holdReason && REASONS.has(ws.holdReason) ? (ws.holdReason as HoldReason) : "membership_lapsed";
    return { reason, since: ws.heldAt };
  }
  if (!ws.trialEndsAt) return null;
  if (ws.trialEndsAt.getTime() <= now) return { reason: "trial_ended", since: ws.trialEndsAt };
  if (usage && ((caps.tokens > 0 && trialTokens(usage) >= caps.tokens) || (caps.images > 0 && usage.images >= caps.images))) {
    return { reason: "trial_used_up", since: null };
  }
  return null;
}

/** What one sentence says about a hold — the on-hold page, the operator's banner and the AI's refusal. */
export function holdSentence(reason: HoldReason): string {
  switch (reason) {
    case "trial_ended":
      return "This workspace's free trial has ended.";
    case "trial_used_up":
      return "This workspace has used its free trial's AI allowance.";
    case "membership_lapsed":
      return "The meyousocial.com membership behind this workspace has ended.";
  }
}

// AI calls that count, i.e. not the named placeholder (`provider` "mock").
const real = { OR: [{ provider: null }, { provider: { not: "mock" } }] };

/** What a trial workspace has used since it started. */
export async function trialUsage(workspaceId: string, since: Date): Promise<TrialUsage> {
  const [sum, uncountedCalls, images] = await Promise.all([
    db.usageLog.aggregate({ where: { workspaceId, action: "ai.text", createdAt: { gte: since }, ...real }, _sum: { tokens: true } }),
    db.usageLog.count({ where: { workspaceId, action: "ai.text", tokens: null, createdAt: { gte: since }, ...real } }),
    db.usageLog.count({ where: { workspaceId, action: "ai.image", createdAt: { gte: since }, ...real } }),
  ]);
  return { tokens: sum._sum.tokens ?? 0, uncountedCalls, images };
}

async function caps(): Promise<TrialCaps> {
  const { trialPolicy } = await import("@/lib/trial-policy");
  const p = await trialPolicy();
  return { tokens: p.tokenCap, images: p.imageCap };
}

const TTL_MS = 30_000;
const cache = new Map<string, { hold: Hold | null; expires: number }>();

/** Drop cached holds after a change (this replica; others catch up within 30 s). */
export function forgetHold(workspaceId?: string): void {
  if (workspaceId) cache.delete(workspaceId);
  else cache.clear();
}

/** The hold `workspaceId` is under, or null. Never throws (a failed read is no hold, and logged). */
export async function workspaceHold(workspaceId: string): Promise<Hold | null> {
  const hit = cache.get(workspaceId);
  if (hit && hit.expires > Date.now()) return hit.hold;
  let hold: Hold | null = null;
  try {
    const ws = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { createdAt: true, trialEndsAt: true, heldAt: true, holdReason: true },
    });
    if (ws) {
      const live = !ws.heldAt && ws.trialEndsAt && ws.trialEndsAt.getTime() > Date.now();
      const [usage, c] = live ? await Promise.all([trialUsage(workspaceId, ws.createdAt), caps()]) : [null, { tokens: 0, images: 0 }];
      hold = holdFrom(ws, usage, c);
    }
  } catch (e) {
    console.warn(`[workspace-hold] read failed for ${workspaceId} — treating as not held:`, e instanceof Error ? e.message : e);
  }
  cache.set(workspaceId, { hold, expires: Date.now() + TTL_MS });
  return hold;
}

/** Every live workspace on hold — for sweeps that span workspaces (lib/governance.ts pausedWorkspaceIds). */
export async function heldWorkspaceIds(): Promise<string[]> {
  const now = new Date();
  const [stamped, trialing] = await Promise.all([
    db.workspace.findMany({ where: { deletedAt: null, OR: [{ heldAt: { not: null } }, { trialEndsAt: { lte: now } }] }, select: { id: true } }),
    db.workspace.findMany({ where: { deletedAt: null, heldAt: null, trialEndsAt: { gt: now } }, select: { id: true } }),
  ]);
  const usedUp: string[] = [];
  for (const w of trialing) if (await workspaceHold(w.id)) usedUp.push(w.id);
  return [...stamped.map((w) => w.id), ...usedUp];
}

export type TrialState = {
  endsAt: Date;
  daysLeft: number;
  usage: TrialUsage;
  caps: TrialCaps;
  /** The larger share of the two allowances used, 0–100. */
  usedPct: number;
  hold: Hold | null;
};

/** A trial workspace's standing — the shell's banner and Settings → Sign-ups. Null when not on a trial. */
export async function trialState(workspaceId: string): Promise<TrialState | null> {
  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { createdAt: true, trialEndsAt: true, heldAt: true, holdReason: true } });
  if (!ws?.trialEndsAt) return null;
  const [usage, c] = await Promise.all([trialUsage(workspaceId, ws.createdAt), caps()]);
  const share = (used: number, cap: number) => (cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0);
  return {
    endsAt: ws.trialEndsAt,
    daysLeft: Math.max(0, Math.ceil((ws.trialEndsAt.getTime() - Date.now()) / 86_400_000)),
    usage,
    caps: c,
    usedPct: Math.max(share(trialTokens(usage), c.tokens), share(usage.images, c.images)),
    hold: holdFrom(ws, usage, c),
  };
}
