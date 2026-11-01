import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";

/**
 * Pause the social queue only (E-SOC-06): vacation or crisis mode for social —
 * nothing scheduled goes out — while articles, discovery and every other dial
 * carry on. The global pause is the emergency brake for everything; this is the
 * narrow one.
 *
 * ⚠ Posts keep their times while paused, so the ones whose time passes would
 * all go out the minute it resumed. Resume therefore asks: put the missed posts
 * into the next free slots (the default), or send them now.
 */

export const QUEUE_PAUSE_SETTING = "social:queue_paused";
export type QueuePause = { since: string; by: string; note: string };

export async function socialQueuePause(workspaceId: string): Promise<QueuePause | null> {
  const raw = await getSetting(QUEUE_PAUSE_SETTING, workspaceId).catch(() => "");
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<QueuePause>;
    return v.since ? { since: v.since, by: v.by ?? "someone", note: v.note ?? "" } : null;
  } catch {
    return null;
  }
}

/** Workspaces whose social queue is paused — for the publish sweep and the recycler. */
export async function socialQueuePausedIds(): Promise<string[]> {
  const rows = await db.workspaceSetting.findMany({ where: { key: QUEUE_PAUSE_SETTING, NOT: { value: "" } }, select: { workspaceId: true } });
  return rows.map((r) => r.workspaceId);
}

/** Scheduled posts whose time has come while the queue was paused. */
export function missedWhilePaused(workspaceId: string) {
  return db.socialPost.findMany({
    where: { workspaceId, status: "scheduled", scheduledAt: { lte: new Date(Date.now() + 60_000) } },
    orderBy: { scheduledAt: "asc" },
    select: { id: true, category: true, scheduledAt: true },
  });
}
