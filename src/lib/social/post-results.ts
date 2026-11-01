import { db } from "@/lib/db";
import { latestPerTarget, type TargetReading } from "@/lib/social/performance";

/**
 * Results on the Sent list (E-SOC-14): each post's impressions, engagement and
 * clicks — the latest reading of each network it went to, summed. Readings are
 * cumulative (performance.ts), so only the newest per network counts. A post
 * with no reading has no result: null, shown as a dash, never a zero.
 */

export type PostResult = {
  impressions: number | null;
  engagement: number | null;
  clicks: number | null;
  /** The newest reading behind these numbers. */
  measuredAt: Date;
};

const snapshotSelect = {
  targetId: true, capturedAt: true, impressions: true, reach: true, likes: true, comments: true,
  shares: true, saves: true, clicks: true, views: true,
  target: { select: { provider: true, postId: true } },
} as const;

function sum(rs: TargetReading[], pick: (r: TargetReading) => number | null): number | null {
  const vals = rs.map(pick).filter((v): v is number => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}

function byPost(readings: TargetReading[]): Map<string, PostResult> {
  const groups = new Map<string, TargetReading[]>();
  for (const r of readings) groups.set(r.postId, [...(groups.get(r.postId) ?? []), r]);
  const out = new Map<string, PostResult>();
  for (const [postId, rs] of groups) {
    out.set(postId, {
      impressions: sum(rs, (r) => r.stats.impressions),
      engagement: sum(rs, (r) => r.engagement),
      clicks: sum(rs, (r) => r.stats.clicks),
      measuredAt: new Date(Math.max(...rs.map((r) => r.capturedAt.getTime()))),
    });
  }
  return out;
}

export async function resultsForPosts(postIds: string[]): Promise<Map<string, PostResult>> {
  if (!postIds.length) return new Map();
  const rows = await db.socialSnapshot.findMany({ where: { target: { postId: { in: postIds } } }, select: snapshotSelect });
  return byPost(latestPerTarget(rows));
}

/** How far back "top performer" looks, and the share of measured posts it names. */
export const TOP_WINDOW_DAYS = 90;
export const TOP_SHARE = 0.1;
/** Fewer measured posts than this and nobody is "top" — a best of three is noise. */
export const TOP_MIN_MEASURED = 5;

/**
 * The best-engaged posts sent in the last 90 days: the top tenth (at least one,
 * ties included) of those with an engagement reading. Empty below five measured
 * posts. Recycled clones count as themselves — repost and evergreen act on the
 * source, which the list links to.
 */
export async function topPerformers(workspaceId: string, now = Date.now()): Promise<{ ids: Set<string>; threshold: number | null; measured: number }> {
  const rows = await db.socialSnapshot.findMany({
    where: { target: { status: "posted", postedAt: { gte: new Date(now - TOP_WINDOW_DAYS * 86_400_000) }, post: { workspaceId } } },
    select: snapshotSelect,
  });
  const measured = [...byPost(latestPerTarget(rows))].filter(([, r]) => r.engagement != null) as Array<[string, PostResult & { engagement: number }]>;
  if (measured.length < TOP_MIN_MEASURED) return { ids: new Set(), threshold: null, measured: measured.length };
  const sorted = measured.map(([, r]) => r.engagement).sort((a, b) => b - a);
  const threshold = sorted[Math.max(1, Math.ceil(measured.length * TOP_SHARE)) - 1];
  // Nobody tops a list of zeros.
  if (threshold <= 0) return { ids: new Set(), threshold: null, measured: measured.length };
  return { ids: new Set(measured.filter(([, r]) => r.engagement >= threshold).map(([id]) => id)), threshold, measured: measured.length };
}

/** "1.2k" — a compact count for the list. */
export function compact(n: number | null): string {
  if (n == null) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}
