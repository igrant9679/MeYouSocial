import { db } from "@/lib/db";

/**
 * How each Topic lane is doing (E-IDE-20), for its header on the Ideas board:
 * when its last idea arrived, how many have waited a week for a decision, how
 * often its ideas get approved, and how much of it reached the audience.
 * Article and social ideas together (video ideas are per channel, not per lane).
 */
export type LaneHealth = {
  lastIdeaAt: Date | null;
  /** Discovered and untouched for STALE_DAYS or more (a "Not yet" restarts the clock). */
  waiting: number;
  /** Approved (or made) out of everything decided — null with nothing decided yet. */
  approvalRate: number | null;
  /** Articles published and social posts sent under this Topic. */
  published: number;
};

export const STALE_DAYS = 7;
const NONE = "none";

export async function laneHealth(workspaceId: string, now = new Date()): Promise<Map<string, LaneHealth>> {
  const cutoff = new Date(now.getTime() - STALE_DAYS * 86_400_000);
  const [aStatus, sStatus, aLast, sLast, aWait, sWait, posts, sent] = await Promise.all([
    db.blogIdea.groupBy({ by: ["topicId", "status"], where: { workspaceId }, _count: { _all: true } }),
    db.socialIdea.groupBy({ by: ["topicId", "status"], where: { workspaceId }, _count: { _all: true } }),
    db.blogIdea.groupBy({ by: ["topicId"], where: { workspaceId }, _max: { createdAt: true } }),
    db.socialIdea.groupBy({ by: ["topicId"], where: { workspaceId }, _max: { createdAt: true } }),
    db.blogIdea.groupBy({ by: ["topicId"], where: { workspaceId, status: "discovered", updatedAt: { lt: cutoff } }, _count: { _all: true } }),
    db.socialIdea.groupBy({ by: ["topicId"], where: { workspaceId, status: "discovered", updatedAt: { lt: cutoff } }, _count: { _all: true } }),
    db.blogPost.groupBy({ by: ["topicId"], where: { workspaceId, status: "published" }, _count: { _all: true } }),
    db.socialPost.groupBy({ by: ["topicId"], where: { workspaceId, status: { in: ["posted", "partial"] } }, _count: { _all: true } }),
  ]);
  const out = new Map<string, LaneHealth & { yes: number; no: number }>();
  const at = (t: string | null) => {
    const k = t ?? NONE;
    let h = out.get(k);
    if (!h) { h = { lastIdeaAt: null, waiting: 0, approvalRate: null, published: 0, yes: 0, no: 0 }; out.set(k, h); }
    return h;
  };
  for (const r of [...aStatus, ...sStatus]) {
    const h = at(r.topicId);
    if (r.status === "rejected") h.no += r._count._all;
    else if (r.status !== "discovered") h.yes += r._count._all; // approved, drafted, merged
  }
  for (const r of [...aLast, ...sLast]) {
    const h = at(r.topicId);
    const d = r._max.createdAt;
    if (d && (!h.lastIdeaAt || d > h.lastIdeaAt)) h.lastIdeaAt = d;
  }
  for (const r of [...aWait, ...sWait]) at(r.topicId).waiting += r._count._all;
  for (const r of [...posts, ...sent]) at(r.topicId).published += r._count._all;
  for (const h of out.values()) h.approvalRate = h.yes + h.no ? h.yes / (h.yes + h.no) : null;
  return new Map([...out].map(([k, { yes: _y, no: _n, ...h }]) => [k, h]));
}

export function laneKey(topicId: string | null | undefined): string {
  return topicId ?? NONE;
}
