import { db } from "@/lib/db";

// Soft limits (audit SET-02): optional caps an admin sets on /admin/limits —
// guards on shared cost, never tied to payment. They used to be saved and never
// checked; now every place a person creates one of these asks first.
//
// Months are UTC calendar months. The per-person caps count what that person
// started; the engine's own work is held by the daily AI budget instead. The
// channel cap is the workspace's.

export type SoftLimitKind = "script" | "thumbnail" | "agentRun" | "channel";

export const monthStartUtc = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** The UsageLog rows the thumbnail and Agent Mode caps count (written at creation). */
export const THUMBNAIL_ACTIONS = ["thumbnail.brainstorm", "thumbnail.clone"];
export const AGENT_RUN_ACTION = "agent.run";

/** How many of `kind` this person started since `since` (default: this month). */
export function personCount(kind: Exclude<SoftLimitKind, "channel">, workspaceId: string, userId: string, since = monthStartUtc()): Promise<number> {
  if (kind === "script") {
    return db.script.count({ where: { authorId: userId, channel: { workspaceId }, createdAt: { gte: since } } });
  }
  return db.usageLog.count({
    where: { workspaceId, actorId: userId, action: kind === "thumbnail" ? { in: THUMBNAIL_ACTIONS } : AGENT_RUN_ACTION, createdAt: { gte: since } },
  });
}

const NOUN: Record<Exclude<SoftLimitKind, "channel">, [string, string]> = {
  script: ["script", "scripts"],
  thumbnail: ["thumbnail set", "thumbnail sets"],
  agentRun: ["Agent Mode run", "Agent Mode runs"],
};

/** Why this person can't create one more `kind` now, as a sentence, or null. */
export async function softLimitProblem(kind: SoftLimitKind, workspaceId: string, userId: string | null): Promise<string | null> {
  const ws = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { limitScriptsPerUserMonth: true, limitThumbnailsPerUserMonth: true, limitAgentRunsPerUserMonth: true, limitChannels: true },
  });
  if (!ws) return null;
  if (kind === "channel") {
    const cap = ws.limitChannels;
    if (!cap) return null;
    const n = await db.channel.count({ where: { workspaceId } });
    return n >= cap ? `This workspace is at its limit of ${cap} channel${cap === 1 ? "" : "s"}. An admin can raise it under Settings → Usage → Limits.` : null;
  }
  if (!userId) return null;
  const cap = kind === "script" ? ws.limitScriptsPerUserMonth : kind === "thumbnail" ? ws.limitThumbnailsPerUserMonth : ws.limitAgentRunsPerUserMonth;
  if (!cap) return null;
  const n = await personCount(kind, workspaceId, userId);
  if (n < cap) return null;
  return `You've reached this month's limit of ${cap} ${NOUN[kind][cap === 1 ? 0 : 1]}. It resets on the 1st (UTC), or an admin can raise it under Settings → Usage → Limits.`;
}
