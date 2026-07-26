import { db } from "@/lib/db";

/**
 * The metrics spine.
 *
 * Everything here is computed from data the app ALREADY owns — no external
 * credentials, so it works today. External sources (Search Console, GA4,
 * YouTube, social) plug into the same `Metric` shape later via `source`, which
 * is why this exists as a spine rather than a one-off dashboard query.
 *
 * The honesty contract, which the whole intelligence layer depends on:
 *   - `value: null` means NO DATA. It never means zero.
 *   - every metric carries the `sample` it was computed from, and a
 *     `confidence` derived from it — a 100% conversion rate off two posts is
 *     reported as low confidence, not as a fact.
 *   - `evidence` states in words where the number came from, so a
 *     recommendation built on it can cite its basis instead of asserting.
 * Nothing in this file may invent, extrapolate or round away a missing input.
 */

export type MetricSource = "owned" | "gsc" | "ga4" | "youtube" | "social";
export type MetricUnit = "count" | "percent" | "days";
export type Confidence = "none" | "low" | "medium" | "high";

export type Metric = {
  key: string;
  label: string;
  /** null = no data. Never coerce this to 0. */
  value: number | null;
  unit: MetricUnit;
  /** How many underlying items produced this number. */
  sample: number;
  confidence: Confidence;
  /** Human-readable provenance — shown in the UI and cited by recommendations. */
  evidence: string;
  source: MetricSource;
};

/**
 * Confidence purely from sample size. Deliberately conservative: rates computed
 * from a handful of items are the single easiest way to mislead someone.
 */
export function confidenceFor(sample: number): Confidence {
  if (sample <= 0) return "none";
  if (sample < 5) return "low";
  if (sample < 20) return "medium";
  return "high";
}

function metric(
  key: string,
  label: string,
  value: number | null,
  unit: MetricUnit,
  sample: number,
  evidence: string,
  source: MetricSource = "owned",
): Metric {
  // Confidence depends on what KIND of number this is:
  //  - a count is the result of counting every row, so it is exact — including
  //    a true zero. Deriving its confidence from sample size would mark "0 posts
  //    in progress" as unreliable when it is a certain fact.
  //  - a rate or a median is only as trustworthy as the n behind it, so those
  //    take confidence from the sample.
  const confidence: Confidence =
    value === null ? "none" : unit === "count" ? "high" : confidenceFor(sample);
  return { key, label, value, unit, sample, confidence, evidence, source };
}

/** A rate that refuses to exist without a denominator. */
function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function medianDays(spans: number[]): number | null {
  if (!spans.length) return null;
  const sorted = [...spans].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(value * 10) / 10;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type MetricsRange = { since: Date; label: string };

export function rangeForDays(days: number): MetricsRange {
  return { since: new Date(Date.now() - days * DAY_MS), label: `last ${days} days` };
}

// ── Pipeline funnel ──────────────────────────────────────────────────────────

export type FunnelStage = { key: string; label: string; count: number };

/**
 * The content value chain, as counts of things CREATED in the window. Ideas and
 * posts are counted where they entered, so the stages are comparable.
 */
export async function collectFunnel(workspaceId: string, range: MetricsRange): Promise<{ stages: FunnelStage[]; metrics: Metric[] }> {
  const since = range.since;
  const [ideasDiscovered, ideasApproved, ideasDrafted, postsCreated, postsPublished] = await Promise.all([
    db.blogIdea.count({ where: { workspaceId, createdAt: { gte: since } } }),
    db.blogIdea.count({ where: { workspaceId, createdAt: { gte: since }, status: { in: ["approved", "drafted"] } } }),
    db.blogIdea.count({ where: { workspaceId, createdAt: { gte: since }, postId: { not: null } } }),
    db.blogPost.count({ where: { workspaceId, createdAt: { gte: since } } }),
    db.blogPost.count({ where: { workspaceId, publishedAt: { gte: since } } }),
  ]);

  const stages: FunnelStage[] = [
    { key: "ideas", label: "Ideas captured", count: ideasDiscovered },
    { key: "approved", label: "Ideas approved", count: ideasApproved },
    { key: "drafted", label: "Turned into drafts", count: ideasDrafted },
    { key: "published", label: "Published", count: postsPublished },
  ];

  const metrics: Metric[] = [
    metric(
      "idea_approval_rate",
      "Ideas approved",
      rate(ideasApproved, ideasDiscovered),
      "percent",
      ideasDiscovered,
      `${ideasApproved} of ${ideasDiscovered} ideas captured in the ${range.label} reached approved or drafted.`,
    ),
    metric(
      "idea_to_draft_rate",
      "Ideas that became drafts",
      rate(ideasDrafted, ideasDiscovered),
      "percent",
      ideasDiscovered,
      `${ideasDrafted} of ${ideasDiscovered} ideas have a post attached.`,
    ),
    metric(
      "posts_published",
      "Posts published",
      postsPublished || (postsCreated ? 0 : null),
      "count",
      postsPublished,
      postsPublished
        ? `${postsPublished} post${postsPublished === 1 ? "" : "s"} published in the ${range.label}.`
        : postsCreated
          ? `No posts published in the ${range.label} (${postsCreated} created).`
          : "No blog activity in this window.",
    ),
  ];

  return { stages, metrics };
}

// ── Cycle time ───────────────────────────────────────────────────────────────

/** Median days from a post being created to being published. */
export async function collectCycleTime(workspaceId: string, range: MetricsRange): Promise<Metric[]> {
  const published = await db.blogPost.findMany({
    where: { workspaceId, publishedAt: { gte: range.since } },
    select: { createdAt: true, publishedAt: true },
  });
  const spans = published
    .filter((p) => p.publishedAt)
    .map((p) => (p.publishedAt!.getTime() - p.createdAt.getTime()) / DAY_MS)
    .filter((d) => d >= 0);

  return [
    metric(
      "cycle_time_days",
      "Draft → published",
      medianDays(spans),
      "days",
      spans.length,
      spans.length
        ? `Median across ${spans.length} post${spans.length === 1 ? "" : "s"} published in the ${range.label}.`
        : "No posts published in this window yet.",
    ),
  ];
}

// ── Cadence ──────────────────────────────────────────────────────────────────

export type CadencePoint = { weekStart: string; published: number };

/** Publishes per week for the last `weeks` weeks — the trend line. */
export async function collectCadence(workspaceId: string, weeks = 12): Promise<{ points: CadencePoint[]; metrics: Metric[] }> {
  const since = new Date(Date.now() - weeks * 7 * DAY_MS);
  const published = await db.blogPost.findMany({
    where: { workspaceId, publishedAt: { gte: since } },
    select: { publishedAt: true },
  });

  const buckets = new Map<string, number>();
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 7 * DAY_MS);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    buckets.set(d.toISOString().slice(0, 10), 0);
  }
  for (const p of published) {
    if (!p.publishedAt) continue;
    const d = new Date(p.publishedAt);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    const key = d.toISOString().slice(0, 10);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const points = [...buckets.entries()].map(([weekStart, count]) => ({ weekStart, published: count }));

  const total = points.reduce((a, p) => a + p.published, 0);
  const half = Math.floor(points.length / 2);
  const firstHalf = points.slice(0, half).reduce((a, p) => a + p.published, 0);
  const secondHalf = points.slice(half).reduce((a, p) => a + p.published, 0);

  const metrics: Metric[] = [
    metric(
      "weekly_cadence",
      "Posts per week",
      total ? Math.round((total / weeks) * 10) / 10 : null,
      "count",
      total,
      total ? `${total} published across ${weeks} weeks.` : `Nothing published in the last ${weeks} weeks.`,
    ),
    // Only claim a trend when there is enough on both sides to compare.
    metric(
      "cadence_trend",
      "Cadence change",
      total >= 4 ? rate(secondHalf - firstHalf, Math.max(firstHalf, 1)) : null,
      "percent",
      total,
      total >= 4
        ? `Recent ${points.length - half} weeks: ${secondHalf} published vs ${firstHalf} in the prior ${half}.`
        : "Not enough published posts to call a trend.",
    ),
  ];

  return { points, metrics };
}

// ── Distribution follow-through ──────────────────────────────────────────────

/**
 * Of the posts that were published, how many actually got distributed? This is
 * the app's own value chain, so it is fully knowable without any external API.
 */
export async function collectFollowThrough(workspaceId: string, range: MetricsRange): Promise<Metric[]> {
  const published = await db.blogPost.findMany({
    where: { workspaceId, publishedAt: { gte: range.since } },
    select: { id: true },
  });
  const ids = published.map((p) => p.id);
  if (!ids.length) {
    return [
      metric("social_follow_through", "Published posts with social", null, "percent", 0, "No published posts in this window.", "owned"),
      metric("video_follow_through", "Published posts with video", null, "percent", 0, "No published posts in this window.", "owned"),
    ];
  }

  const [withSocial, withVideo] = await Promise.all([
    db.blogPost.count({ where: { id: { in: ids }, variants: { some: { status: "posted" } } } }),
    db.videoRender.findMany({ where: { workspaceId, blogPostId: { in: ids } }, select: { blogPostId: true }, distinct: ["blogPostId"] }),
  ]);
  const videoCount = withVideo.length;

  return [
    metric(
      "social_follow_through",
      "Published posts with social",
      rate(withSocial, ids.length),
      "percent",
      ids.length,
      `${withSocial} of ${ids.length} published posts have at least one posted social variant.`,
    ),
    metric(
      "video_follow_through",
      "Published posts with video",
      rate(videoCount, ids.length),
      "percent",
      ids.length,
      `${videoCount} of ${ids.length} published posts have a video render.`,
    ),
  ];
}

// ── Work in progress / stalls ────────────────────────────────────────────────

export type WipBucket = { status: string; count: number; oldestDays: number | null };

/**
 * Point-in-time WIP. This is the one thing that genuinely cannot be
 * reconstructed later, which is why the daily rollup stores it.
 */
export async function collectWip(workspaceId: string, stallDays = 14): Promise<{ buckets: WipBucket[]; metrics: Metric[] }> {
  const open = await db.blogPost.findMany({
    where: { workspaceId, status: { not: "published" } },
    select: { status: true, updatedAt: true },
  });

  const byStatus = new Map<string, { count: number; oldest: number }>();
  for (const p of open) {
    const ageDays = (Date.now() - p.updatedAt.getTime()) / DAY_MS;
    const cur = byStatus.get(p.status) ?? { count: 0, oldest: 0 };
    byStatus.set(p.status, { count: cur.count + 1, oldest: Math.max(cur.oldest, ageDays) });
  }
  const buckets: WipBucket[] = [...byStatus.entries()]
    .map(([status, v]) => ({ status, count: v.count, oldestDays: Math.round(v.oldest * 10) / 10 }))
    .sort((a, b) => b.count - a.count);

  const stalled = open.filter((p) => (Date.now() - p.updatedAt.getTime()) / DAY_MS > stallDays).length;

  return {
    buckets,
    metrics: [
      metric("wip_open", "Posts in progress", open.length, "count", open.length, `${open.length} post${open.length === 1 ? "" : "s"} not yet published.`),
      metric(
        "wip_stalled",
        `Untouched > ${stallDays}d`,
        open.length ? stalled : null,
        "count",
        open.length,
        open.length
          ? `${stalled} of ${open.length} open posts haven't changed in over ${stallDays} days.`
          : "Nothing in progress.",
      ),
    ],
  };
}

// ── AI assist volume ─────────────────────────────────────────────────────────

const GENERATION_ACTIONS = [
  "blog.draft_generated",
  "blog.outline_generated",
  "blog.section_regenerated",
  "blog.meta_generated",
  "ideas.ai_discovery",
  "social.variants_generated",
  "video.packaged",
];

/**
 * How much the AI produced vs how much shipped. NOT a quality score — it is a
 * ratio of two counts and is labelled as such; attributing quality would need
 * per-artifact acceptance tracking the app doesn't record yet.
 */
export async function collectAiVolume(workspaceId: string, range: MetricsRange): Promise<Metric[]> {
  const [generations, published] = await Promise.all([
    db.auditLog.count({ where: { workspaceId, action: { in: GENERATION_ACTIONS }, createdAt: { gte: range.since } } }),
    db.blogPost.count({ where: { workspaceId, publishedAt: { gte: range.since } } }),
  ]);
  return [
    metric(
      "ai_generations",
      "AI generations",
      generations || null,
      "count",
      generations,
      generations ? `${generations} generation actions in the ${range.label}.` : "No AI generations recorded in this window.",
    ),
    metric(
      "generations_per_publish",
      "Generations per published post",
      published > 0 && generations > 0 ? Math.round((generations / published) * 10) / 10 : null,
      "count",
      published,
      published > 0 && generations > 0
        ? `${generations} generations across ${published} published post${published === 1 ? "" : "s"}. A volume ratio, not a quality score.`
        : "Needs both generations and published posts in the window.",
    ),
  ];
}

// ── Performance (external data lands here) ───────────────────────────────────

/**
 * Search/traffic performance from BlogSnapshot rows. Operator-entered today;
 * the Search Console and GA4 connectors write the same shape, so this collector
 * does not change when they are switched on — only `source` and the volume do.
 */
export async function collectPerformance(workspaceId: string, range: MetricsRange): Promise<Metric[]> {
  const snapshots = await db.blogSnapshot.findMany({
    where: { post: { workspaceId }, capturedAt: { gte: range.since } },
    select: { impressions: true, clicks: true, sessions: true, position: true },
  });

  if (!snapshots.length) {
    const note = "No performance snapshots in this window — connect Search Console or GA4 under Admin → Analytics, or enter snapshots manually.";
    return [
      metric("search_clicks", "Search clicks", null, "count", 0, note, "gsc"),
      metric("search_impressions", "Impressions", null, "count", 0, note, "gsc"),
      metric("avg_position", "Average position", null, "count", 0, note, "gsc"),
      metric("sessions", "Sessions", null, "count", 0, note, "ga4"),
    ];
  }

  const sum = (pick: (s: (typeof snapshots)[number]) => number | null) =>
    snapshots.reduce((a, s) => a + (pick(s) ?? 0), 0);
  const positions = snapshots.map((s) => s.position).filter((p): p is number => typeof p === "number");
  const evidence = `From ${snapshots.length} snapshot${snapshots.length === 1 ? "" : "s"} in the ${range.label}.`;

  return [
    metric("search_clicks", "Search clicks", sum((s) => s.clicks), "count", snapshots.length, evidence, "gsc"),
    metric("search_impressions", "Impressions", sum((s) => s.impressions), "count", snapshots.length, evidence, "gsc"),
    metric(
      "avg_position",
      "Average position",
      positions.length ? Math.round((positions.reduce((a, p) => a + p, 0) / positions.length) * 10) / 10 : null,
      "count",
      positions.length,
      positions.length ? evidence : "Snapshots exist but none recorded a position.",
      "gsc",
    ),
    metric("sessions", "Sessions", sum((s) => s.sessions), "count", snapshots.length, evidence, "ga4"),
  ];
}

/**
 * Social engagement, from the pullback.
 *
 * Reads through `readingsForWorkspace`, which collapses each target's
 * cumulative snapshots to its LATEST reading before summing — see the header of
 * src/lib/social/performance.ts. Never sum SocialSnapshot rows directly here.
 *
 * The window means "posts SENT in this window", not "engagement earned in this
 * window": a lifetime counter can't answer the latter. Every evidence string
 * below says so, because the same figure under the blog's per-day heading would
 * mean something different.
 */
export async function collectSocialPerformance(workspaceId: string, range: MetricsRange): Promise<Metric[]> {
  const { readingsForWorkspace } = await import("@/lib/social/performance");
  const readings = await readingsForWorkspace(workspaceId, range.since);

  if (!readings.length) {
    // Distinguish "nothing was sent" from "sent, but nothing measured" — they
    // call for completely different actions from the operator.
    const sent = await db.socialPostTarget.count({
      where: { status: "posted", postedAt: { gte: range.since }, post: { workspaceId } },
    });
    const note = sent
      ? `${sent} post${sent === 1 ? " was" : "s were"} sent in the ${range.label} but no engagement has been pulled back yet — check Unipile under Admin → Connections.`
      : `Nothing was posted to social in the ${range.label}.`;
    return [
      metric("social_impressions", "Social impressions", null, "count", 0, note, "social"),
      metric("social_engagement", "Social engagements", null, "count", 0, note, "social"),
      metric("social_engagement_rate", "Engagement rate", null, "percent", 0, note, "social"),
      metric("social_clicks", "Social link clicks", null, "count", 0, note, "social"),
    ];
  }

  const sum = (pick: (r: (typeof readings)[number]) => number | null) => {
    const vals = readings.map(pick).filter((v): v is number => v !== null);
    return vals.length ? { total: vals.reduce((a, b) => a + b, 0), n: vals.length } : null;
  };
  const impressions = sum((r) => r.stats.impressions);
  const engagement = sum((r) => r.engagement);
  const clicks = sum((r) => r.stats.clicks);
  const basis = (n: number) =>
    `Lifetime totals for ${n} of ${readings.length} sent post${readings.length === 1 ? "" : "s"} from the ${range.label}, as last pulled from the network.`;
  const missing = "The networks connected here didn't report this figure.";

  // The rate is computed only over targets reporting BOTH halves — mixing a
  // network that reports impressions with one that doesn't would understate it.
  const bothReported = readings.filter((r) => r.stats.impressions !== null && r.engagement !== null);
  const rateImpressions = bothReported.reduce((a, r) => a + (r.stats.impressions ?? 0), 0);
  const rateEngagement = bothReported.reduce((a, r) => a + (r.engagement ?? 0), 0);

  return [
    metric("social_impressions", "Social impressions", impressions?.total ?? null, "count",
      impressions?.n ?? 0, impressions ? basis(impressions.n) : missing, "social"),
    metric("social_engagement", "Social engagements", engagement?.total ?? null, "count",
      engagement?.n ?? 0, engagement ? `${basis(engagement.n)} Likes, comments and shares combined.` : missing, "social"),
    metric("social_engagement_rate", "Engagement rate",
      rateImpressions > 0 ? Math.round((rateEngagement / rateImpressions) * 1000) / 10 : null,
      "percent", bothReported.length,
      rateImpressions > 0
        ? `${rateEngagement} engagements against ${rateImpressions} impressions, over the ${bothReported.length} post${bothReported.length === 1 ? "" : "s"} reporting both.`
        : "No connected network reported impressions, so a rate can't be computed.",
      "social"),
    metric("social_clicks", "Social link clicks", clicks?.total ?? null, "count",
      clicks?.n ?? 0, clicks ? basis(clicks.n) : missing, "social"),
  ];
}

// ── Per-topic breakdown ──────────────────────────────────────────────────────

export type TopicPerformance = {
  topicId: string;
  name: string;
  ideas: number;
  posts: number;
  published: number;
  publishRate: number | null;
  confidence: Confidence;
};

/**
 * Which topics actually produce finished work. The question the whole
 * intelligence layer starts from, and it needs no external data at all.
 */
export async function collectTopicPerformance(workspaceId: string, range: MetricsRange): Promise<TopicPerformance[]> {
  const topics = await db.topic.findMany({
    where: { workspaceId, status: "active" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  if (!topics.length) return [];
  const ids = topics.map((t) => t.id);

  const [ideaGroups, postGroups, publishedGroups] = await Promise.all([
    db.blogIdea.groupBy({ by: ["topicId"], where: { workspaceId, topicId: { in: ids }, createdAt: { gte: range.since } }, _count: { _all: true } }),
    db.blogPost.groupBy({ by: ["topicId"], where: { workspaceId, topicId: { in: ids }, createdAt: { gte: range.since } }, _count: { _all: true } }),
    db.blogPost.groupBy({ by: ["topicId"], where: { workspaceId, topicId: { in: ids }, publishedAt: { gte: range.since } }, _count: { _all: true } }),
  ]);
  const countOf = (groups: Array<{ topicId: string | null; _count: { _all: number } }>, id: string) =>
    groups.find((g) => g.topicId === id)?._count._all ?? 0;

  return topics
    .map((t) => {
      const ideas = countOf(ideaGroups, t.id);
      const posts = countOf(postGroups, t.id);
      const published = countOf(publishedGroups, t.id);
      return {
        topicId: t.id,
        name: t.name,
        ideas,
        posts,
        published,
        publishRate: rate(published, posts),
        confidence: posts > 0 ? confidenceFor(posts) : ("none" as Confidence),
      };
    })
    .sort((a, b) => b.published - a.published || b.posts - a.posts);
}

// ── Everything, in one call ──────────────────────────────────────────────────

export type WorkspaceMetrics = {
  range: MetricsRange;
  funnel: FunnelStage[];
  cadence: CadencePoint[];
  wip: WipBucket[];
  topics: TopicPerformance[];
  metrics: Metric[];
  /** True when the workspace has essentially nothing to analyse yet. */
  empty: boolean;
};

export async function collectWorkspaceMetrics(workspaceId: string, days = 90): Promise<WorkspaceMetrics> {
  const range = rangeForDays(days);
  const [funnel, cycle, cadence, follow, wip, ai, perf, social, topics] = await Promise.all([
    collectFunnel(workspaceId, range),
    collectCycleTime(workspaceId, range),
    collectCadence(workspaceId),
    collectFollowThrough(workspaceId, range),
    collectWip(workspaceId),
    collectAiVolume(workspaceId, range),
    collectPerformance(workspaceId, range),
    collectSocialPerformance(workspaceId, range),
    collectTopicPerformance(workspaceId, range),
  ]);

  const metrics = [...funnel.metrics, ...cycle, ...cadence.metrics, ...follow, ...wip.metrics, ...ai, ...perf, ...social];
  const empty = metrics.every((m) => m.value === null || m.value === 0) && !funnel.stages.some((s) => s.count > 0);

  return { range, funnel: funnel.stages, cadence: cadence.points, wip: wip.buckets, topics, metrics, empty };
}
