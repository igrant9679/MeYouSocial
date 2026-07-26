import { db } from "@/lib/db";
import { getPostViaUnipile, getUnipileConfig } from "@/lib/unipile";
import { writeAudit } from "@/lib/governance";
import { engagementOf, hasAnyStat, parseSocialStats, type SocialStats } from "@/lib/social/stats";

/**
 * Social performance pullback — the social half of what the analytics sync does
 * for the blog. Without it, `/social` can say a post went out but never what it
 * did, and the metrics spine measures a distribution channel it cannot see.
 *
 * ── The aggregation rule, which is NOT the blog's ───────────────────────────
 * BlogSnapshot rows are PER-DAY (GSC/GA4 are queried with a date dimension), so
 * `collectPerformance` SUMS them. SocialSnapshot rows are CUMULATIVE LIFETIME
 * totals, because that is what a social API reports — "this post has 412 likes"
 * as of the moment you ask. Summing those across days would multiply-count by
 * roughly the number of times we polled.
 *
 * The correct aggregation is therefore: **latest snapshot per target, then sum
 * across targets.** `latestPerTarget()` below is the single place that does it,
 * and everything else goes through it.
 *
 * ── What the window means ───────────────────────────────────────────────────
 * A consequence of cumulative storage: you cannot ask "engagement earned in the
 * last 30 days" from it, only "engagement to date on posts published in the last
 * 30 days". The metrics are scoped by the POST's send date for exactly that
 * reason, and every evidence string says so. Pretending otherwise would be the
 * kind of quiet misattribution the spine exists to prevent.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back to keep re-polling. Engagement is mostly earned early; after
 *  this the numbers barely move and polling just spends rate limit. */
const DEFAULT_LOOKBACK_DAYS = 30;
/** Ceiling on API calls per workspace per run, so one big backlog can't stall the sweep. */
const MAX_TARGETS_PER_RUN = 120;

/** UTC midnight of `d` — the day key a snapshot is filed under. */
export function dayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export type SocialSyncOutcome = {
  ok: boolean;
  message: string;
  /** Targets we attempted to read. */
  targetsPolled: number;
  rowsWritten: number;
  failures: number;
  /** Payload keys that looked numeric but matched no alias — the map's to-do
   *  list, surfaced so the first real pull can correct src/lib/social/stats.ts. */
  unrecognisedKeys: string[];
  /** True when Unipile isn't configured at all — a no-op, not a failure. */
  skipped: boolean;
};

/**
 * Pull fresh engagement for one workspace's recently-posted targets.
 *
 * Safe to call when nothing is connected: it reports `skipped` rather than
 * erroring, which is what lets the scheduler run it unconditionally.
 */
export async function syncWorkspaceSocialPerformance(
  workspaceId: string,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
): Promise<SocialSyncOutcome> {
  const cfg = await getUnipileConfig();
  if (!cfg) {
    return {
      ok: true, skipped: true, targetsPolled: 0, rowsWritten: 0, failures: 0, unrecognisedKeys: [],
      message: "Unipile isn't configured, so there's nothing to pull. Set the DSN + API key under Admin → Connections.",
    };
  }

  const since = new Date(Date.now() - lookbackDays * DAY_MS);
  const targets = await db.socialPostTarget.findMany({
    where: {
      status: "posted",
      providerPostId: { not: null },
      postedAt: { gte: since },
      post: { workspaceId },
    },
    orderBy: { postedAt: "desc" },
    take: MAX_TARGETS_PER_RUN,
    select: { id: true, providerPostId: true, unipileAccountId: true, provider: true },
  });

  if (targets.length === 0) {
    return {
      ok: true, skipped: false, targetsPolled: 0, rowsWritten: 0, failures: 0, unrecognisedKeys: [],
      message: `No posts sent in the last ${lookbackDays} days, so there's nothing to measure yet.`,
    };
  }

  const capturedAt = dayStart(new Date());
  const unrecognised = new Set<string>();
  let rowsWritten = 0;
  let failures = 0;
  const failureDetails: string[] = [];

  // Sequential on purpose: this runs on a background sweep with no deadline,
  // and a burst of parallel calls is the fastest way to get rate-limited.
  for (const t of targets) {
    const res = await getPostViaUnipile({ postId: t.providerPostId!, accountId: t.unipileAccountId });
    if (!res.ok) {
      failures++;
      if (failureDetails.length < 3) failureDetails.push(`${t.provider}: HTTP ${res.status} ${res.detail}`.trim());
      continue;
    }
    const parsed = parseSocialStats(res.payload);
    for (const k of parsed.unrecognisedNumericKeys) unrecognised.add(k);
    // Nothing understood → write nothing. A row of nulls would be
    // indistinguishable from a post that genuinely earned nothing.
    if (!hasAnyStat(parsed.stats)) {
      failures++;
      continue;
    }
    await db.socialSnapshot.upsert({
      where: { targetId_capturedAt: { targetId: t.id, capturedAt } },
      // Re-running the same day refreshes; it never appends a second reading,
      // which is what keeps latest-per-target unambiguous.
      update: { ...parsed.stats, source: "unipile" },
      create: { targetId: t.id, capturedAt, ...parsed.stats, source: "unipile" },
    });
    rowsWritten++;
  }

  if (rowsWritten) {
    await writeAudit({
      workspaceId,
      action: "social.performance_synced",
      entityType: "social_snapshot",
      meta: { rowsWritten, targetsPolled: targets.length, failures, lookbackDays },
    });
  }

  const message = rowsWritten
    ? `Pulled engagement for ${rowsWritten} of ${targets.length} sent post${targets.length === 1 ? "" : "s"}.` +
      (failures ? ` ${failures} couldn't be read${failureDetails.length ? ` (${failureDetails[0]})` : ""}.` : "")
    : `Polled ${targets.length} sent post${targets.length === 1 ? "" : "s"} but read no usable numbers back` +
      `${failureDetails.length ? ` — ${failureDetails[0]}` : ""}.` +
      (unrecognised.size
        ? ` The reply did contain numeric fields (${[...unrecognised].slice(0, 6).join(", ")}); add them to ALIASES in src/lib/social/stats.ts.`
        : "");

  return {
    ok: rowsWritten > 0 || failures === 0,
    skipped: false,
    targetsPolled: targets.length,
    rowsWritten,
    failures,
    unrecognisedKeys: [...unrecognised].sort(),
    message,
  };
}

/** Every workspace, for the scheduler. */
export async function syncAllWorkspacesSocialPerformance(): Promise<{ workspaces: number; rowsWritten: number }> {
  if (!(await getUnipileConfig())) return { workspaces: 0, rowsWritten: 0 };
  const workspaces = await db.workspace.findMany({ select: { id: true } });
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
  likes: number | null;
  comments: number | null;
  shares: number | null;
  clicks: number | null;
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
      impressions: r.impressions, likes: r.likes, comments: r.comments, shares: r.shares, clicks: r.clicks,
    };
    return {
      targetId: r.targetId,
      provider: r.target.provider.toUpperCase(),
      postId: r.target.postId,
      stats,
      engagement: engagementOf(stats),
      capturedAt: r.capturedAt,
    };
  });
}

/**
 * The latest reading for every target whose post was SENT since `since`.
 *
 * Scoped by send date, not snapshot date — see the header note on what the
 * window can honestly mean for cumulative counters.
 */
export async function readingsForWorkspace(workspaceId: string, since: Date): Promise<TargetReading[]> {
  const rows = await db.socialSnapshot.findMany({
    where: { target: { status: "posted", postedAt: { gte: since }, post: { workspaceId } } },
    select: {
      targetId: true, capturedAt: true, impressions: true, likes: true, comments: true, shares: true, clicks: true,
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
      const impressions = sumOrNull(rs, (r) => r.stats.impressions);
      const engagement = sumOrNull(rs, (r) => r.engagement);
      return {
        provider,
        posts: rs.length,
        impressions,
        engagement,
        clicks: sumOrNull(rs, (r) => r.stats.clicks),
        // A rate needs both halves and a non-zero denominator, or it's a lie.
        engagementRate:
          impressions !== null && impressions > 0 && engagement !== null
            ? Math.round((engagement / impressions) * 1000) / 10
            : null,
      };
    })
    .sort((a, b) => (b.engagement ?? -1) - (a.engagement ?? -1) || a.provider.localeCompare(b.provider));
}
