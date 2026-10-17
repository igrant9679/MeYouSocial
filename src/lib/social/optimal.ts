import { analyseBestTimes, MIN_POSTS } from "@/lib/social/best-time";
import { getQueue, zonedParts, zonedTimeToUtc, formatInZone } from "@/lib/social/slots";
import { db } from "@/lib/db";

/**
 * "Optimal" — Socialmonials' fourth send option, done the honest way
 * (2026-10-17). Most tools sell "optimal time" as a model dressed as a
 * measurement; here it is ONLY the measured best-time report
 * (social/best-time.ts): a weekday+hour bucket that has enough posts to be
 * judged and beats this workspace's own average by OUTPERFORM. Until that
 * exists, there is no optimal time and the composer says why instead of
 * offering one.
 *
 * Choice, in order:
 *   1. the earliest FREE posting slot in the next fortnight that falls in a
 *      best bucket — it keeps the schedule's shape;
 *   2. else the next occurrence (within 7 days) of the strongest best bucket,
 *      on the hour, if nothing else is already going out that minute.
 */

export type OptimalPick =
  | { ok: true; at: Date; label: string; why: string }
  | { ok: false; reason: string };

export async function optimalTime(workspaceId: string, excludePostId?: string): Promise<OptimalPick> {
  const report = await analyseBestTimes(workspaceId);
  if (report.best.length === 0) {
    return {
      ok: false,
      reason:
        report.reason ??
        (report.measured < MIN_POSTS
          ? `No measured best time yet — ${report.measured} of the ${MIN_POSTS} posts with engagement and impressions it needs.`
          : "No posting time beats this workspace's average by enough to call it better yet."),
    };
  }
  const tz = report.timeZone;
  const bestKey = new Map(report.best.map((b) => [`${b.weekday}-${b.hour}`, b]));
  const { free } = await getQueue(workspaceId, { excludePostId, limit: 120 });
  const horizon = Date.now() + 14 * 86_400_000;
  for (const s of free) {
    if (s.at.getTime() > horizon) break;
    const z = zonedParts(s.at, tz);
    const b = bestKey.get(`${z.weekday}-${Math.floor(z.minute / 60)}`);
    if (b) {
      return {
        ok: true,
        at: s.at,
        label: formatInZone(s.at, tz),
        why: `${b.label} posts do ${b.ratio.toFixed(1)}× your average engagement rate (${b.posts} measured) — the earliest free slot in that hour.`,
      };
    }
  }
  // No free slot lands in a best hour: the next occurrence of the strongest one.
  const top = [...report.best].sort((a, b) => b.ratio - a.ratio)[0];
  const now = new Date();
  for (let d = 0; d <= 7; d++) {
    const probe = new Date(now.getTime() + d * 86_400_000);
    const z = zonedParts(probe, tz);
    if (z.weekday !== top.weekday) continue;
    const at = zonedTimeToUtc(z.year, z.month, z.day, top.hour, 0, tz);
    if (at.getTime() <= now.getTime() + 5 * 60_000) continue;
    const clash = await db.socialPost.count({
      where: { workspaceId, status: "scheduled", scheduledAt: at, ...(excludePostId ? { id: { not: excludePostId } } : {}) },
    });
    if (clash) continue;
    return {
      ok: true,
      at,
      label: formatInZone(at, tz),
      why: `${top.label} posts do ${top.ratio.toFixed(1)}× your average engagement rate (${top.posts} measured). No free slot falls in that hour, so this is its next occurrence.`,
    };
  }
  return {
    ok: false,
    reason: `Your best measured time is ${top.label} (${top.ratio.toFixed(1)}× your average, ${top.posts} measured), but it's already taken every time it comes round this week and no free slot falls in a best hour. Queue it or pick a time.`,
  };
}
