import { db } from "@/lib/db";

/**
 * Aggregations shared by the Home dashboard and the Report page. Everything
 * here reads real rows — where the workspace has no analytics snapshots yet,
 * the callers render an honest empty state instead of an invented curve.
 */

/**
 * ⚠ `measured` is separate from the value ON PURPOSE. A week where an operator
 * recorded 0 impressions is DATA; a week nobody measured is not, and the two
 * must never collapse into the same 0. `hasSeriesData` used to test
 * `impressions > 0 || clicks > 0`, so an honestly recorded zero week was
 * declared unmeasured and rendered under the words "not measured, never zero"
 * — the one promise this app makes about numbers, broken by the check meant
 * to keep it.
 *
 * Per metric, not per bucket: a snapshot can carry a position or a session
 * count and no impressions at all, and that week has genuinely not measured
 * impressions even though it has rows.
 */
export type WeekPoint = {
  label: string;
  impressions: number;
  clicks: number;
  impressionsMeasured: boolean;
  clicksMeasured: boolean;
};

/** Sum snapshots into ISO-week buckets over the trailing `weeks`. */
export async function weeklySeries(workspaceId: string, weeks = 8): Promise<WeekPoint[]> {
  // ⚠ MEA-11: windows end at the last day that HAS data. Search Console lags
  // ~2 days, so a series ending "now" always dipped in its last week.
  const latest = await db.blogSnapshot.findFirst({ where: { post: { workspaceId } }, orderBy: { capturedAt: "desc" }, select: { capturedAt: true } });
  const end = latest && Date.now() - latest.capturedAt.getTime() < weeks * 7 * 86_400_000
    ? new Date(latest.capturedAt.getTime() + 86_400_000)
    : new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - weeks * 7);
  const snaps = await db.blogSnapshot.findMany({
    where: { post: { workspaceId }, capturedAt: { gte: start } },
    select: { capturedAt: true, impressions: true, clicks: true },
    orderBy: { capturedAt: "asc" },
  });

  const buckets: WeekPoint[] = [];
  const now = end;
  for (let i = weeks - 1; i >= 0; i--) {
    const from = new Date(now);
    from.setDate(from.getDate() - (i + 1) * 7);
    const to = new Date(now);
    to.setDate(to.getDate() - i * 7);
    const inBucket = snaps.filter((s) => s.capturedAt >= from && s.capturedAt < to);
    buckets.push({
      // Dated (MEA-04): "W1…W8" said nothing about which weeks they were.
      label: from.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
      impressions: inBucket.reduce((a, s) => a + (s.impressions ?? 0), 0),
      clicks: inBucket.reduce((a, s) => a + (s.clicks ?? 0), 0),
      impressionsMeasured: inBucket.some((s) => s.impressions != null),
      clicksMeasured: inBucket.some((s) => s.clicks != null),
    });
  }
  return buckets;
}

/** True when ANY week actually measured impressions or clicks — a recorded zero counts. */
export function hasSeriesData(series: WeekPoint[]): boolean {
  return series.some((p) => p.impressionsMeasured || p.clicksMeasured);
}

/** How many of the weeks on a chart have no measurement at all, so a run of
 *  zeros can be captioned instead of read as real zeros. */
export function unmeasuredWeeks(series: WeekPoint[], metric: "impressions" | "clicks"): number {
  return series.filter((p) => !(metric === "impressions" ? p.impressionsMeasured : p.clicksMeasured)).length;
}

export type PostPerf = {
  id: string;
  title: string;
  status: string;
  focusKeyword: string | null;
  publishedUrl: string | null;
  position: number | null;
  prevPosition: number | null;
  clicks: number | null;
};

/** Latest (and previous) snapshot per post, for tables and deltas. */
/**
 * ⚠ `take` slices the most-recently-UPDATED posts of ANY status, so filtering
 * the result to `published` afterwards is a trap: a workspace with 40 drafts
 * touched this week and 15 published articles from last quarter gets 40 drafts
 * back and nothing published — and every panel built on that then declares
 * "nothing has been published yet", which is false. Pass `status` so the
 * filter happens in the QUERY, where the take can't eat the rows first.
 */
/**
 * ⚠ PUBLISHED unless asked otherwise (MEA-01, MEA-09, SHL-04). The status was
 * opt-in, and three callers forgot it: the client PDF said "Nothing published
 * yet" whenever recent edits were drafts, Measure listed drafts as "tracked
 * posts", and the Inbox's Results was all dashes. Pass `status: "any"` for
 * every status.
 */
export async function postPerformance(workspaceId: string, take = 24, opts?: { status?: string }): Promise<PostPerf[]> {
  const status = opts?.status ?? "published";
  const posts = await db.blogPost.findMany({
    where: { workspaceId, ...(status !== "any" ? { status } : {}) },
    orderBy: status === "published" ? [{ publishedAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }] : { updatedAt: "desc" },
    take,
    select: {
      id: true,
      title: true,
      status: true,
      focusKeyword: true,
      publishedUrl: true,
      snapshots: {
        where: { capturedAt: { gte: new Date(Date.now() - 2 * WINDOW_DAYS * 86_400_000 - 7 * 86_400_000) } },
        orderBy: { capturedAt: "desc" },
        select: { capturedAt: true, position: true, clicks: true, impressions: true },
      },
    },
  });
  return posts.map((p) => {
    // ⚠ MEA-14: position, change and clicks came from the last ONE or TWO days,
    // so "biggest movers" were the noisiest days. Now: the 28 days ending at the
    // post's latest reading vs the 28 before, position weighted by impressions.
    const anchor = p.snapshots[0]?.capturedAt.getTime() ?? 0;
    const cut = anchor - WINDOW_DAYS * 86_400_000;
    const recent = p.snapshots.filter((s) => s.capturedAt.getTime() > cut);
    const prior = p.snapshots.filter((s) => s.capturedAt.getTime() <= cut && s.capturedAt.getTime() > cut - WINDOW_DAYS * 86_400_000);
    return {
      id: p.id,
      title: p.title,
      status: p.status,
      focusKeyword: p.focusKeyword,
      publishedUrl: p.publishedUrl,
      position: weightedPosition(recent),
      prevPosition: weightedPosition(prior),
      clicks: recent.some((s) => s.clicks != null) ? recent.reduce((a, s) => a + (s.clicks ?? 0), 0) : null,
    };
  });
}

/** The window the per-post figures cover, in days (MEA-14). */
export const WINDOW_DAYS = 28;

/** Impression-weighted mean position; a plain mean when no row carries impressions. */
export function weightedPosition(rows: Array<{ position: number | null; impressions: number | null }>): number | null {
  const withPos = rows.filter((r): r is { position: number; impressions: number | null } => r.position != null);
  if (!withPos.length) return null;
  const weighted = withPos.filter((r) => (r.impressions ?? 0) > 0);
  const v = weighted.length
    ? weighted.reduce((a, r) => a + r.position * r.impressions!, 0) / weighted.reduce((a, r) => a + r.impressions!, 0)
    : withPos.reduce((a, r) => a + r.position, 0) / withPos.length;
  return Math.round(v * 10) / 10;
}

export type HomeStats = {
  publishedThisMonth: number;
  /** Published over the same days of last month — a fair comparison (MEA-11). */
  publishedLastMonth: number;
  avgPosition: number | null;
  /** Null when no snapshot this week recorded clicks — not measured, not zero (MEA-04). */
  clicksThisWeek: number | null;
  unverifiedCitations: number;
  postsMissingAssets: number;
  aiBudgetUsedToday: number;
};

export async function homeStats(workspaceId: string): Promise<HomeStats> {
  const now = new Date();
  // Months in the posting timezone (MEA-20), and last month over the SAME
  // number of days (MEA-11): month-to-date against a whole month read as a
  // drop every month until the 30th.
  const { getPostingTimeZone } = await import("@/lib/social/slots");
  const { zonedMonthStart } = await import("@/lib/zoned-dates");
  const tz = await getPostingTimeZone(workspaceId);
  const monthStart = zonedMonthStart(now, tz);
  const prevMonthStart = zonedMonthStart(now, tz, 1);
  const prevSameDay = new Date(Math.min(monthStart.getTime(), prevMonthStart.getTime() + (now.getTime() - monthStart.getTime())));
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);

  const [publishedThisMonth, publishedLastMonth, unverifiedCitations, reviewPosts, weekSnaps, aiBudgetUsedToday] =
    await Promise.all([
      db.blogPost.count({ where: { workspaceId, status: "published", publishedAt: { gte: monthStart } } }),
      db.blogPost.count({
        where: { workspaceId, status: "published", publishedAt: { gte: prevMonthStart, lt: prevSameDay } },
      }),
      db.blogCitation.count({
        where: { verified: false, post: { workspaceId, status: { not: "published" } } },
      }),
      db.blogPost.findMany({
        where: { workspaceId, status: { in: ["draft_review", "final_approval"] } },
        select: { id: true, images: { select: { role: true, status: true } } },
      }),
      db.blogSnapshot.findMany({
        where: { post: { workspaceId }, capturedAt: { gte: weekStart } },
        select: { clicks: true },
      }),
      // The autopilot's own count — unattended only, the posting timezone's day.
      import("@/lib/blog-autopilot").then((m) => m.generationsToday(workspaceId)),
    ]);

  const postsMissingAssets = reviewPosts.filter((p) => {
    const ok = (role: string) => p.images.some((i) => i.role === role && i.status === "approved");
    return !ok("featured") || !ok("og");
  }).length;

  // Impression-weighted position over the last 28 days of published posts'
  // readings (MEA-14) — not an unweighted mean of single days.
  const windowRows = await db.blogSnapshot.findMany({
    where: { post: { workspaceId, status: "published" }, capturedAt: { gte: new Date(now.getTime() - WINDOW_DAYS * 86_400_000) } },
    select: { position: true, impressions: true },
  });
  const avgPosition = weightedPosition(windowRows);

  return {
    publishedThisMonth,
    publishedLastMonth,
    avgPosition,
    clicksThisWeek: weekSnaps.some((s) => s.clicks != null) ? weekSnaps.reduce((a, s) => a + (s.clicks ?? 0), 0) : null,
    unverifiedCitations,
    postsMissingAssets,
    aiBudgetUsedToday,
  };
}

export type FeedEvent = { at: Date; label: string; tone: "ok" | "warn" | "info"; href: string | null };

const FEED_LABELS: Record<string, { label: string; tone: FeedEvent["tone"] }> = {
  "blog.draft_generated": { label: "Drafted a post", tone: "info" },
  "blog.published_wordpress": { label: "Published to WordPress", tone: "ok" },
  "blog.drafted_to_wordpress": { label: "Handed off as WP draft", tone: "info" },
  "blog.published": { label: "Published", tone: "ok" },
  "ideas.ai_discovery": { label: "Discovered ideas", tone: "info" },
  "social.variants_generated": { label: "Queued social variants", tone: "info" },
  "video.packaged": { label: "Packaged a video", tone: "info" },
  "video.rendered": { label: "Rendered a video", tone: "ok" },
  "video.render_failed": { label: "Video render failed", tone: "warn" },
  "autopilot.cycle": { label: "Autopilot cycle ran", tone: "info" },
};

export async function autopilotFeed(workspaceId: string, take = 5): Promise<FeedEvent[]> {
  const rows = await db.auditLog.findMany({
    where: { workspaceId, actorId: null, action: { in: Object.keys(FEED_LABELS) } },
    orderBy: { createdAt: "desc" },
    take,
  });
  return rows.map((r) => ({
    at: r.createdAt,
    label: FEED_LABELS[r.action]?.label ?? r.action,
    tone: FEED_LABELS[r.action]?.tone ?? "info",
    href: r.entityType === "blog_post" && r.entityId ? `/blog/${r.entityId}` : r.entityType === "video_render" ? "/videos" : null,
  }));
}

/**
 * The header ticker's feed: system activity plus the human publish/approval
 * moments, newest first. Titles are resolved so the ticker reads like news,
 * not like log lines.
 */
/** One thing the engine did, in words a person can read without a decoder. */
export type EngineEvent = {
  /** A plain sentence: "published an article". Never an all-caps token. */
  what: string;
  /** What it acted on, when there is one — shown in quotes, full length. */
  title: string | null;
  tone: FeedEvent["tone"];
  href: string | null;
  at: string;
};

export async function tickerEvents(workspaceId: string, take = 12): Promise<EngineEvent[]> {
  // ⚠ Sentences, not tokens. These used to be "RENDERED", "SOCIAL queued",
  // "AT APPROVAL" — scrolling past in a marquee, one of them truncated to
  // nonsense, in the most valuable strip on every page. Nobody could say what
  // "RENDERED 12:13" meant (audit A7). The verb is now what it sounds like.
  const ACTIONS: Record<string, { what: string; tone: FeedEvent["tone"] }> = {
    "blog.draft_generated": { what: "drafted an article", tone: "info" },
    "blog.published_wordpress": { what: "published an article", tone: "ok" },
    "blog.drafted_to_wordpress": { what: "sent a draft to the website", tone: "info" },
    "blog.published": { what: "published an article", tone: "ok" },
    "blog.status_final_approval": { what: "moved an article to final approval", tone: "info" },
    "ideas.ai_discovery": { what: "found new ideas", tone: "info" },
    "social.variants_generated": { what: "wrote social posts", tone: "info" },
    "video.rendered": { what: "finished a video render", tone: "ok" },
    "video.render_failed": { what: "couldn't finish a video render", tone: "warn" },
  };
  const rows = await db.auditLog.findMany({
    where: { workspaceId, action: { in: Object.keys(ACTIONS) } },
    orderBy: { createdAt: "desc" },
    take,
  });
  const postIds = [...new Set(rows.filter((r) => r.entityType === "blog_post" && r.entityId).map((r) => r.entityId!))];
  const posts = await db.blogPost.findMany({ where: { id: { in: postIds } }, select: { id: true, title: true } });
  const titleOf = new Map(posts.map((p) => [p.id, p.title]));
  return rows.map((r) => {
    const meta = ACTIONS[r.action]!;
    const title = r.entityType === "blog_post" && r.entityId ? titleOf.get(r.entityId) : undefined;
    return {
      what: meta.what,
      // Full title, not a 60-character stump. The pill shows one line and the
      // panel behind it has room for the whole thing.
      title: title ?? null,
      tone: meta.tone,
      href: r.entityType === "blog_post" && r.entityId ? `/blog/${r.entityId}` : r.entityType === "video_render" ? "/videos" : null,
      at: r.createdAt.toISOString(),
    };
  });
}
