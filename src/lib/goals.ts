import { db } from "@/lib/db";
import { zonedParts, zonedTimeToUtc } from "@/lib/social/slots";

/**
 * Goals and pacing (E-MEA-05): a target per metric for the week or the month,
 * and whether the period so far is on pace for it.
 *
 * Periods are the posting zone's calendar — a week starts Monday 00:00 there,
 * a month on the 1st — so "this week" means the same thing as the schedule.
 *
 * ⚠ PACE IS MEASURED TO THE DATA, NOT TO NOW. Search Console lags ~2 days, so
 * on Wednesday the clicks cover Monday at best; comparing them with three days'
 * worth of target would call every week "behind". Search clicks are paced to
 * the last day a reading covers; the counts the app records itself (articles,
 * posts) to now. A period with no reading is "not measured", never zero.
 */

export const GOAL_METRICS = ["search_clicks", "articles_published", "social_posts_sent", "social_engagement"] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];
export const GOAL_PERIODS = ["week", "month"] as const;
export type GoalPeriod = (typeof GOAL_PERIODS)[number];

export const GOAL_LABEL: Record<GoalMetric, { name: string; unit: string; one: string; channel: "search" | "social" | "production" }> = {
  search_clicks: { name: "Search clicks", unit: "clicks", one: "click", channel: "search" },
  articles_published: { name: "Articles published", unit: "articles", one: "article", channel: "production" },
  social_posts_sent: { name: "Social posts sent", unit: "posts", one: "post", channel: "social" },
  social_engagement: { name: "Social engagements", unit: "engagements", one: "engagement", channel: "social" },
};

/** "1 post" / "3 posts". */
export const goalAmount = (metric: GoalMetric, n: number) => `${n.toLocaleString("en-GB")} ${n === 1 ? GOAL_LABEL[metric].one : GOAL_LABEL[metric].unit}`;

export const isGoalMetric = (v: string): v is GoalMetric => (GOAL_METRICS as readonly string[]).includes(v);
export const isGoalPeriod = (v: string): v is GoalPeriod => (GOAL_PERIODS as readonly string[]).includes(v);

/** The calendar week (Monday-based) or month holding `now`, in `timeZone`. */
export function periodBounds(period: GoalPeriod, timeZone: string, now: Date): { start: Date; end: Date } {
  const p = zonedParts(now, timeZone);
  if (period === "month") {
    const start = zonedTimeToUtc(p.year, p.month, 1, 0, 0, timeZone);
    const end = p.month === 12 ? zonedTimeToUtc(p.year + 1, 1, 1, 0, 0, timeZone) : zonedTimeToUtc(p.year, p.month + 1, 1, 0, 0, timeZone);
    return { start, end };
  }
  const back = (p.weekday + 6) % 7; // days since Monday
  const monday = new Date(Date.UTC(p.year, p.month - 1, p.day - back));
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day - back + 7));
  return {
    start: zonedTimeToUtc(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), 0, 0, timeZone),
    end: zonedTimeToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, timeZone),
  };
}

export type PaceStatus = "met" | "on_pace" | "slightly_behind" | "behind" | "not_measured";

export const PACE_LABEL: Record<PaceStatus, string> = {
  met: "met",
  on_pace: "on pace",
  slightly_behind: "a little behind",
  behind: "behind",
  not_measured: "not measured yet",
};

/**
 * Where `actual` stands against `target` with `fraction` of the period
 * measured: met once it's reached; on pace at or above the straight-line share;
 * a little behind within 20% of it; behind below that. Too early to judge (under
 * a tenth of the period measured) reads as on pace unless it's already met.
 */
export function pace(target: number, actual: number | null, fraction: number): { status: PaceStatus; expected: number; projected: number | null } {
  const f = Math.max(0, Math.min(1, fraction));
  const expected = Math.round(target * f);
  if (actual === null) return { status: "not_measured", expected, projected: null };
  const projected = f >= 0.1 ? Math.round(actual / f) : null;
  if (actual >= target) return { status: "met", expected, projected };
  if (f < 0.1 || actual >= target * f) return { status: "on_pace", expected, projected };
  if (actual >= target * f * 0.8) return { status: "slightly_behind", expected, projected };
  return { status: "behind", expected, projected };
}

export type GoalProgress = {
  metric: GoalMetric;
  period: GoalPeriod;
  target: number;
  actual: number | null;
  /** Share of the period the actual covers (to the data for search, to now otherwise). */
  fraction: number;
  measuredTo: Date;
  start: Date;
  end: Date;
  status: PaceStatus;
  expected: number;
  projected: number | null;
  updatedById: string | null;
  updatedAt: Date;
};

/** The measured value of one metric over [start, end), and how far into the window it reaches. */
async function actualFor(workspaceId: string, metric: GoalMetric, start: Date, end: Date, now: Date): Promise<{ actual: number | null; measuredTo: Date }> {
  const to = now < end ? now : end;
  if (metric === "search_clicks") {
    const rows = await db.blogSnapshot.findMany({
      where: { post: { workspaceId }, capturedAt: { gte: start, lt: end }, clicks: { not: null } },
      select: { clicks: true, capturedAt: true },
    });
    if (!rows.length) return { actual: null, measuredTo: start };
    const last = rows.reduce((m, r) => (r.capturedAt > m ? r.capturedAt : m), rows[0].capturedAt);
    // A daily reading covers its whole day.
    const covered = new Date(Math.min(to.getTime(), last.getTime() + 86_400_000));
    return { actual: rows.reduce((a, r) => a + (r.clicks ?? 0), 0), measuredTo: covered };
  }
  if (metric === "articles_published") {
    const n = await db.blogPost.count({ where: { workspaceId, status: "published", publishedAt: { gte: start, lt: end } } });
    return { actual: n, measuredTo: to };
  }
  if (metric === "social_posts_sent") {
    const n = await db.socialPost.count({ where: { workspaceId, targets: { some: { status: "posted", postedAt: { gte: start, lt: end } } } } });
    return { actual: n, measuredTo: to };
  }
  // Engagement on the posts SENT this period, as last pulled from the networks
  // (lifetime counters — the same basis as Measure's social numbers).
  const { readingsForWorkspace } = await import("@/lib/social/performance");
  const readings = await readingsForWorkspace(workspaceId, start, end);
  const vals = readings.map((r) => r.engagement).filter((v): v is number => v !== null);
  return { actual: vals.length ? vals.reduce((a, v) => a + v, 0) : null, measuredTo: to };
}

export async function goalProgress(workspaceId: string, timeZone: string, now = new Date()): Promise<GoalProgress[]> {
  const goals = await db.goal.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } });
  const out: GoalProgress[] = [];
  for (const g of goals) {
    if (!isGoalMetric(g.metric) || !isGoalPeriod(g.period)) continue;
    const { start, end } = periodBounds(g.period, timeZone, now);
    const { actual, measuredTo } = await actualFor(workspaceId, g.metric, start, end, now);
    const fraction = (measuredTo.getTime() - start.getTime()) / (end.getTime() - start.getTime());
    const p = pace(g.target, actual, fraction);
    out.push({ metric: g.metric, period: g.period, target: g.target, actual, fraction, measuredTo, start, end, ...p, updatedById: g.updatedById, updatedAt: g.updatedAt });
  }
  return out.sort((a, b) => GOAL_METRICS.indexOf(a.metric) - GOAL_METRICS.indexOf(b.metric));
}
