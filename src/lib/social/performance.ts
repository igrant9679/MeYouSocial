import { db } from "@/lib/db";
import { getZernioAnalytics, getZernioConfig } from "@/lib/zernio";
import { writeAudit } from "@/lib/governance";
import { engagementOf, fromZernioMetrics, hasAnyStat, EMPTY_STATS, type SocialStats } from "@/lib/social/stats";

/**
 * Social performance pullback — the social half of what the analytics sync does
 * for the blog. Without it, `/social` can say a post went out but never what it
 * did, and the metrics spine measures a distribution channel it cannot see.
 *
 * ── The aggregation rule, which is NOT the blog's ───────────────────────────
 * BlogSnapshot rows are PER-DAY (GSC/GA4 are queried with a date dimension), so
 * `collectPerformance` SUMS them. SocialSnapshot rows are CUMULATIVE LIFETIME
 * totals — Zernio's docs state this explicitly, and it is what every social
 * platform reports. Summing those across days would multiply-count by roughly
 * the number of times we polled.
 *
 * The correct aggregation is therefore: **latest snapshot per target, then sum
 * across targets.** `latestPerTarget()` below is the single place that does it.
 *
 * ── What the window means ───────────────────────────────────────────────────
 * A consequence of cumulative storage: you cannot ask "engagement earned in the
 * last 30 days", only "engagement to date on posts published in the last 30
 * days". Metrics are scoped by the post's SEND date for that reason, and every
 * evidence string says so.
 *
 * ── One call per workspace ──────────────────────────────────────────────────
 * Zernio's `GET /analytics` takes a `profileId` and returns every post with a
 * `platformAnalytics[]` breakdown, so a whole workspace refreshes in one
 * paginated request rather than one call per post. Its numbers carry the
 * platform's own reporting delay (~24h on Instagram); `lastUpdated` says when
 * Zernio last synced, and nothing here pretends to be more current than that.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back to keep re-polling. Engagement is mostly earned early. */
const DEFAULT_LOOKBACK_DAYS = 30;
const MAX_PAGES = 5; // 100 rows/page — 500 posts per workspace per run

/** UTC midnight of `d` — the day key a snapshot is filed under. */
export function dayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export type SocialSyncOutcome = {
  ok: boolean;
  message: string;
  targetsPolled: number;
  rowsWritten: number;
  failures: number;
  /** True when Zernio isn't configured at all — a no-op, not a failure. */
  skipped: boolean;
};

/**
 * Pull fresh engagement for one workspace's recently-posted targets.
 *
 * Safe to call when nothing is connected: reports `skipped` rather than
 * erroring, which is what lets the scheduler run it unconditionally.
 */
export async function syncWorkspaceSocialPerformance(
  workspaceId: string,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
): Promise<SocialSyncOutcome> {
  const cfg = await getZernioConfig(workspaceId);
  if (!cfg) {
    return {
      ok: true, skipped: true, targetsPolled: 0, rowsWritten: 0, failures: 0,
      message: "Zernio isn't configured, so there's nothing to pull. Add the API key under Admin → Connections.",
    };
  }
  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { zernioProfileId: true } });
  if (!ws?.zernioProfileId) {
    return {
      ok: true, skipped: true, targetsPolled: 0, rowsWritten: 0, failures: 0,
      message: "This workspace has no Zernio profile yet — connect a social account first.",
    };
  }

  const since = new Date(Date.now() - lookbackDays * DAY_MS);
  // Our targets, keyed by the Zernio post id + account they were sent as.
  const targets = await db.socialPostTarget.findMany({
    where: { status: "posted", providerPostId: { not: null }, postedAt: { gte: since }, post: { workspaceId } },
    select: { id: true, providerPostId: true, accountId: true, provider: true },
  });
  if (targets.length === 0) {
    return {
      ok: true, skipped: false, targetsPolled: 0, rowsWritten: 0, failures: 0,
      message: `No posts sent in the last ${lookbackDays} days, so there's nothing to measure yet.`,
    };
  }
  const byKey = new Map(targets.map((t) => [`${t.providerPostId}|${t.accountId}`, t]));
  // Fallback key for a reply that omits accountId on a single-account post.
  const byPost = new Map<string, typeof targets>();
  for (const t of targets) byPost.set(t.providerPostId!, [...(byPost.get(t.providerPostId!) ?? []), t]);

  const capturedAt = dayStart(new Date());
  let rowsWritten = 0;
  let matched = 0;
  let failures = 0;
  let lastError = "";

  for (let page = 1; page <= MAX_PAGES; page++) {
    let rows;
    try {
      rows = await getZernioAnalytics({ profileId: ws.zernioProfileId, fromDate: since, limit: 100, page, workspaceId });
    } catch (e) {
      failures++;
      lastError = e instanceof Error ? e.message : String(e);
      break;
    }
    if (rows.length === 0) break;

    for (const row of rows) {
      for (const leg of row.perPlatform) {
        const target =
          byKey.get(`${row.postId}|${leg.accountId ?? ""}`) ??
          // Single target on that post → unambiguous even without accountId.
          (byPost.get(row.postId)?.length === 1 ? byPost.get(row.postId)![0] : undefined);
        if (!target) continue;
        matched++;

        const stats: SocialStats = fromZernioMetrics(leg.metrics);
        // Nothing reported → write nothing. A row of nulls is indistinguishable
        // from a post that genuinely earned zero, and they are different facts.
        if (!hasAnyStat(stats)) continue;

        await db.socialSnapshot.upsert({
          where: { targetId_capturedAt: { targetId: target.id, capturedAt } },
          // Same-day re-run refreshes; it never appends a second reading, which
          // is what keeps latest-per-target unambiguous.
          update: { ...stats, source: "zernio" },
          create: { targetId: target.id, capturedAt, ...stats, source: "zernio" },
        });
        rowsWritten++;

        // Backfill the public URL if we didn't capture it at publish time.
        if (leg.platformPostUrl) {
          await db.socialPostTarget.updateMany({
            where: { id: target.id, platformPostUrl: null },
            data: { platformPostUrl: leg.platformPostUrl },
          });
        }
      }
    }
    if (rows.length < 100) break;
  }

  if (rowsWritten) {
    await writeAudit({
      workspaceId,
      action: "social.performance_synced",
      entityType: "social_snapshot",
      meta: { rowsWritten, targetsPolled: targets.length, matched, lookbackDays, source: "zernio" },
    });
  }

  const message = rowsWritten
    ? `Pulled engagement for ${rowsWritten} of ${targets.length} sent post${targets.length === 1 ? "" : "s"}.`
    : failures
      ? `Couldn't reach Zernio analytics: ${lastError}`
      : matched
        ? `Zernio knows these ${matched} post${matched === 1 ? "" : "s"} but hasn't reported any metrics yet — platforms lag (about a day on Instagram). Try again tomorrow.`
        : `Zernio returned no analytics rows matching the ${targets.length} post${targets.length === 1 ? "" : "s"} sent from here. If they were posted outside this app, they won't match.`;

  return { ok: failures === 0, skipped: false, targetsPolled: targets.length, rowsWritten, failures, message };
}

/** Every workspace, for the scheduler. Per-workspace keys mean a missing
 *  platform key no longer short-circuits the loop — each workspace's own
 *  config check (inside syncWorkspaceSocialPerformance) decides. */
export async function syncAllWorkspacesSocialPerformance(): Promise<{ workspaces: number; rowsWritten: number }> {
  const workspaces = await db.workspace.findMany({
    where: { zernioProfileId: { not: null } },
    select: { id: true },
  });
  let rowsWritten = 0;
  let touched = 0;
  for (const w of workspaces) {
    try {
      const out = await syncWorkspaceSocialPerformance(w.id);
      if (out.rowsWritten > 0) touched++;
      rowsWritten += out.rowsWritten;
    } catch (e) {
      console.error(`[social-perf] sync failed for ${w.id}:`, e instanceof Error ? e.message : e);
    }
  }
  return { workspaces: touched, rowsWritten };
}

// ── Reading it back ──────────────────────────────────────────────────────────

export type TargetReading = {
  targetId: string;
  provider: string;
  postId: string;
  stats: SocialStats;
  engagement: number | null;
  capturedAt: Date;
};

type SnapshotRow = {
  targetId: string;
  capturedAt: Date;
  impressions: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
  views: number | null;
  target: { provider: string; postId: string };
};

/**
 * Collapse raw snapshot rows to ONE reading per target — the most recent.
 *
 * This is the function that keeps cumulative storage honest. Exported so it can
 * be tested directly against a hand-built series, because getting it wrong
 * inflates every social number on Insights.
 */
export function latestPerTarget(rows: SnapshotRow[]): TargetReading[] {
  const best = new Map<string, SnapshotRow>();
  for (const r of rows) {
    const cur = best.get(r.targetId);
    if (!cur || r.capturedAt.getTime() > cur.capturedAt.getTime()) best.set(r.targetId, r);
  }
  return [...best.values()].map((r) => {
    const stats: SocialStats = {
      impressions: r.impressions, reach: r.reach, likes: r.likes, comments: r.comments,
      shares: r.shares, saves: r.saves, clicks: r.clicks, views: r.views,
    };
    return {
      targetId: r.targetId,
      // Lowercase: Zernio slugs are lowercase, and pre-migration rows are not.
      provider: r.target.provider.toLowerCase(),
      postId: r.target.postId,
      stats,
      engagement: engagementOf(stats),
      capturedAt: r.capturedAt,
    };
  });
}

/**
 * The latest reading for every target whose post was SENT since `since`.
 * Scoped by send date, not snapshot date — see the header note.
 */
export async function readingsForWorkspace(workspaceId: string, since: Date): Promise<TargetReading[]> {
  const rows = await db.socialSnapshot.findMany({
    where: { target: { status: "posted", postedAt: { gte: since }, post: { workspaceId } } },
    select: {
      targetId: true, capturedAt: true, impressions: true, reach: true, likes: true, comments: true,
      shares: true, saves: true, clicks: true, views: true,
      target: { select: { provider: true, postId: true } },
    },
  });
  return latestPerTarget(rows);
}

export type NetworkPerformance = {
  provider: string;
  posts: number;
  impressions: number | null;
  engagement: number | null;
  clicks: number | null;
  /** engagement ÷ impressions, as a percentage. Null without both. */
  engagementRate: number | null;
};

/** Sum a field across readings, returning null when NOBODY reported it. */
function sumOrNull(readings: TargetReading[], pick: (r: TargetReading) => number | null): number | null {
  const vals = readings.map(pick).filter((v): v is number => v !== null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}

/** Per-network rollup, computed from already-collapsed readings. */
export function byNetwork(readings: TargetReading[]): NetworkPerformance[] {
  const groups = new Map<string, TargetReading[]>();
  for (const r of readings) groups.set(r.provider, [...(groups.get(r.provider) ?? []), r]);
  return [...groups.entries()]
    .map(([provider, rs]) => {
      // Impressions is the comparable denominator across networks; reach fills
      // in for the ones that only report that.
      const impressions = sumOrNull(rs, (r) => r.stats.impressions ?? r.stats.reach);
      const engagement = sumOrNull(rs, (r) => r.engagement);
      return {
        provider,
        posts: rs.length,
        impressions,
        engagement,
        clicks: sumOrNull(rs, (r) => r.stats.clicks),
        engagementRate:
          impressions !== null && impressions > 0 && engagement !== null
            ? Math.round((engagement / impressions) * 1000) / 10
            : null,
      };
    })
    .sort((a, b) => (b.engagement ?? -1) - (a.engagement ?? -1) || a.provider.localeCompare(b.provider));
}

export { EMPTY_STATS };
