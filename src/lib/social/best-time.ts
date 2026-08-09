import { db } from "@/lib/db";
import { readingsForWorkspace } from "@/lib/social/performance";
import { resolveTimeZone, listPostingSlots, zonedParts, WEEKDAY_LABELS, formatMinute } from "@/lib/social/slots";

/**
 * When this workspace's posts actually do best — measured, or not stated.
 *
 * Every competitor sells "best time to post" as a headline feature, and almost
 * all of it is a model dressed as a measurement. This is deliberately the dull
 * version: a mean, a baseline, and a threshold, computed only from posts whose
 * engagement we have actually pulled back. It says nothing at all until it has
 * enough posts to say something — and when it stays silent it names the number
 * it is waiting for, because "no recommendation" and "not enough data" are
 * different messages and only one of them is honest here.
 *
 * ⚠ Buckets are WALL CLOCK in the workspace's posting timezone, via
 * `zonedParts` — slots.ts is the only converter in this codebase, and a
 * "best hour" computed in UTC would drift by one every daylight-saving change
 * and quietly disagree with the schedule it is meant to inform.
 *
 * ⚠ The metric is engagement RATE (engagement ÷ impressions), and only where
 * BOTH numbers exist. Ranking by raw engagement would just rank by reach —
 * the post that went out when more people were online wins by definition,
 * which is the very thing we're trying to test. Readings missing either half
 * are excluded rather than mixed in, and the count of what was excluded is
 * reported.
 */

/** Posts with a usable rate before ANY figure is shown. */
export const MIN_POSTS = 8;
/** Posts in one weekday+hour bucket before that bucket is judged. */
export const MIN_PER_BUCKET = 3;
/** How far above the baseline a bucket must sit to be called better. */
export const OUTPERFORM = 1.25;

export type TimeBucket = {
  weekday: number;
  hour: number;
  posts: number;
  /** Mean engagement rate, as a percentage. */
  rate: number;
  /** rate ÷ baseline. 1.0 = exactly average. */
  ratio: number;
  /** True once `posts` clears MIN_PER_BUCKET. */
  judged: boolean;
  label: string;
};

export type BestTimeReport = {
  timeZone: string;
  timeZoneConfigured: boolean;
  /** Posts that had BOTH engagement and impressions — the usable sample. */
  measured: number;
  /** Posts dropped because one of the two numbers was missing. */
  unmeasurable: number;
  /** Null until `measured` clears MIN_POSTS. */
  baseline: number | null;
  /** Empty until there is a baseline. */
  buckets: TimeBucket[];
  best: TimeBucket[];
  worst: TimeBucket[];
  /** Set whenever nothing can be concluded. Rendered verbatim. */
  reason: string | null;
  /** Buckets that beat the baseline and have no posting slot yet. */
  suggestions: { weekday: number; minute: number; label: string; ratio: number }[];
};

function labelFor(weekday: number, hour: number): string {
  return `${WEEKDAY_LABELS[weekday]} ${formatMinute(hour * 60)}`;
}

/** One measured post: when it went out, and how well it did. */
export type TimePoint = { weekday: number; hour: number; rate: number };

/**
 * The maths, with no database in it.
 *
 * Exported and pure for the same reason `latestPerTarget` is: this is the part
 * that can be quietly wrong in a way nothing else notices, and it needs to be
 * checkable against a hand-built series rather than against whatever
 * production happens to contain today. Production currently holds four
 * measured posts, which exercises only the refusal path.
 */
export function summariseBuckets(
  points: TimePoint[],
  existingSlotKeys: Set<string>,
): Pick<BestTimeReport, "baseline" | "buckets" | "best" | "worst" | "reason" | "suggestions"> {
  const grouped = new Map<string, TimePoint[]>();
  for (const p of points) {
    const k = `${p.weekday}-${p.hour}`;
    grouped.set(k, [...(grouped.get(k) ?? []), p]);
  }

  /**
   * ⚠ THE BASELINE COMES ONLY FROM JUDGED BUCKETS.
   *
   * Averaging every point looks obviously right and is wrong. A hand-built
   * series caught it: one freak post at 99% with n=1 was correctly barred from
   * WINNING, then dragged the baseline from 3% to 12.6% anyway — at which
   * point the genuinely best time (Tue 09:00, 4.00%, n=3) was reported at
   * 0.32× and listed as UNDERPERFORMING. The outlier couldn't win, so it made
   * everything else lose.
   *
   * A bucket too thin to be judged is too thin to set the standard. Compare
   * like with like: the yardstick is built from exactly the population that is
   * measured against it.
   */
  const judgedPoints = [...grouped.values()].filter((ps) => ps.length >= MIN_PER_BUCKET).flat();
  const basisPoints = judgedPoints.length > 0 ? judgedPoints : points;
  const baseline = basisPoints.reduce((a, p) => a + p.rate, 0) / basisPoints.length;

  const buckets: TimeBucket[] = [...grouped.values()]
    .map((ps) => {
      const rate = ps.reduce((a, p) => a + p.rate, 0) / ps.length;
      return {
        weekday: ps[0].weekday,
        hour: ps[0].hour,
        posts: ps.length,
        rate,
        ratio: baseline > 0 ? rate / baseline : 1,
        judged: ps.length >= MIN_PER_BUCKET,
        label: labelFor(ps[0].weekday, ps[0].hour),
      };
    })
    // Judged first, then by ratio — otherwise a thin outlier sits at the top of
    // the list wearing a 7.9x badge, which is the same lie in a quieter font.
    .sort((a, b) => Number(b.judged) - Number(a.judged) || b.ratio - a.ratio);

  // Only judged buckets are ever called better or worse. An unjudged one is
  // shown with its count so the thinness is visible, never ranked.
  const judged = buckets.filter((b) => b.judged);
  const best = judged.filter((b) => b.ratio >= OUTPERFORM);
  const worst = judged.filter((b) => b.ratio <= 1 / OUTPERFORM);

  const suggestions = best
    .filter((b) => !existingSlotKeys.has(`${b.weekday}-${b.hour}`))
    .map((b) => ({ weekday: b.weekday, minute: b.hour * 60, label: b.label, ratio: b.ratio }));

  return {
    baseline,
    buckets,
    best,
    worst,
    reason: judged.length === 0
      ? `${points.length} posts measured, but none of the ${buckets.length} time slots has the ${MIN_PER_BUCKET} posts needed to judge it on its own. Posting more consistently at fewer times is what makes this answerable.`
      : null,
    suggestions,
  };
}

export async function analyseBestTimes(
  workspaceId: string,
  lookbackDays = 180,
): Promise<BestTimeReport> {
  const [{ timeZone, configured }, slots] = await Promise.all([
    resolveTimeZone(workspaceId),
    listPostingSlots(workspaceId),
  ]);

  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const readings = await readingsForWorkspace(workspaceId, since);

  const empty = (reason: string): BestTimeReport => ({
    timeZone, timeZoneConfigured: configured, measured: 0, unmeasurable: 0,
    baseline: null, buckets: [], best: [], worst: [], reason, suggestions: [],
  });

  if (readings.length === 0) {
    return empty("No engagement has been pulled back yet, so there is nothing to measure. Publish some posts, then use Pull engagement on the Performance tab.");
  }

  // When each post actually went out. `postId` on a reading is our own
  // SocialPost id, so this is a plain join rather than a guess.
  const posts = await db.socialPost.findMany({
    where: { id: { in: [...new Set(readings.map((r) => r.postId))] }, workspaceId },
    select: { id: true, publishedAt: true },
  });
  const publishedAt = new Map(posts.map((p) => [p.id, p.publishedAt]));

  const points: TimePoint[] = [];
  let unmeasurable = 0;

  for (const r of readings) {
    const when = publishedAt.get(r.postId);
    const impressions = r.stats.impressions ?? r.stats.reach;
    // Both halves, or it doesn't count. A null denominator isn't a zero.
    if (!when || r.engagement === null || impressions === null || impressions <= 0) {
      unmeasurable++;
      continue;
    }
    const { weekday, minute } = zonedParts(when, timeZone);
    points.push({ weekday, hour: Math.floor(minute / 60), rate: (r.engagement / impressions) * 100 });
  }

  if (points.length < MIN_POSTS) {
    const need = MIN_POSTS - points.length;
    return {
      ...empty(
        `Not enough measured posts yet: ${points.length} of the ${MIN_POSTS} needed` +
        (unmeasurable > 0
          ? `. ${unmeasurable} more ${unmeasurable === 1 ? "post has" : "posts have"} engagement but no impressions figure, so ${unmeasurable === 1 ? "it can't" : "they can't"} be compared fairly.`
          : `. ${need} more will do it.`),
      ),
      measured: points.length,
      unmeasurable,
    };
  }

  // A suggestion is only useful if it isn't already in the schedule.
  const existing = new Set(slots.filter((s) => s.enabled).map((s) => `${s.weekday}-${Math.floor(s.minute / 60)}`));

  return {
    timeZone,
    timeZoneConfigured: configured,
    measured: points.length,
    unmeasurable,
    ...summariseBuckets(points, existing),
  };
}
