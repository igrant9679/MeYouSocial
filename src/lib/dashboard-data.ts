import { db } from "@/lib/db";

/**
 * Aggregations shared by the Home dashboard and the Report page. Everything
 * here reads real rows — where the workspace has no analytics snapshots yet,
 * the callers render an honest empty state instead of an invented curve.
 */

export type WeekPoint = { label: string; impressions: number; clicks: number };

/** Sum snapshots into ISO-week buckets over the trailing `weeks`. */
export async function weeklySeries(workspaceId: string, weeks = 8): Promise<WeekPoint[]> {
  const start = new Date();
  start.setDate(start.getDate() - weeks * 7);
  const snaps = await db.blogSnapshot.findMany({
    where: { post: { workspaceId }, capturedAt: { gte: start } },
    select: { capturedAt: true, impressions: true, clicks: true },
    orderBy: { capturedAt: "asc" },
  });

  const buckets: WeekPoint[] = [];
  const now = new Date();
  for (let i = weeks - 1; i >= 0; i--) {
    const from = new Date(now);
    from.setDate(from.getDate() - (i + 1) * 7);
    const to = new Date(now);
    to.setDate(to.getDate() - i * 7);
    const inBucket = snaps.filter((s) => s.capturedAt >= from && s.capturedAt < to);
    buckets.push({
      label: `W${weeks - i}`,
      impressions: inBucket.reduce((a, s) => a + (s.impressions ?? 0), 0),
      clicks: inBucket.reduce((a, s) => a + (s.clicks ?? 0), 0),
    });
  }
  return buckets;
}

export function hasSeriesData(series: WeekPoint[]): boolean {
  return series.some((p) => p.impressions > 0 || p.clicks > 0);
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
export async function postPerformance(workspaceId: string, take = 24): Promise<PostPerf[]> {
  const posts = await db.blogPost.findMany({
    where: { workspaceId },
    orderBy: { updatedAt: "desc" },
    take,
    select: {
      id: true,
      title: true,
      status: true,
      focusKeyword: true,
      publishedUrl: true,
      snapshots: { orderBy: { capturedAt: "desc" }, take: 2, select: { position: true, clicks: true } },
    },
  });
  return posts.map((p) => ({
    id: p.id,
    title: p.title,
    status: p.status,
    focusKeyword: p.focusKeyword,
    publishedUrl: p.publishedUrl,
    position: p.snapshots[0]?.position ?? null,
    prevPosition: p.snapshots[1]?.position ?? null,
    clicks: p.snapshots[0]?.clicks ?? null,
  }));
}

export type HomeStats = {
  publishedThisMonth: number;
  publishedLastMonth: number;
  avgPosition: number | null;
  clicksThisWeek: number;
  unverifiedCitations: number;
  postsMissingAssets: number;
  aiBudgetUsedToday: number;
};

export async function homeStats(workspaceId: string): Promise<HomeStats> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  const [publishedThisMonth, publishedLastMonth, unverifiedCitations, reviewPosts, weekSnaps, aiBudgetUsedToday] =
    await Promise.all([
      db.blogPost.count({ where: { workspaceId, status: "published", publishedAt: { gte: monthStart } } }),
      db.blogPost.count({
        where: { workspaceId, status: "published", publishedAt: { gte: prevMonthStart, lt: monthStart } },
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
      db.auditLog.count({
        where: {
          workspaceId,
          action: { in: ["blog.draft_generated", "ideas.ai_discovery", "social.variants_generated"] },
          createdAt: { gte: dayStart },
        },
      }),
    ]);

  const postsMissingAssets = reviewPosts.filter((p) => {
    const ok = (role: string) => p.images.some((i) => i.role === role && i.status === "approved");
    return !ok("featured") || !ok("og");
  }).length;

  // Average of each published post's latest position.
  const latest = await db.blogPost.findMany({
    where: { workspaceId, status: "published" },
    select: { snapshots: { orderBy: { capturedAt: "desc" }, take: 1, select: { position: true } } },
  });
  const positions = latest.map((p) => p.snapshots[0]?.position).filter((x): x is number => x != null);
  const avgPosition = positions.length
    ? Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 10) / 10
    : null;

  return {
    publishedThisMonth,
    publishedLastMonth,
    avgPosition,
    clicksThisWeek: weekSnaps.reduce((a, s) => a + (s.clicks ?? 0), 0),
    unverifiedCitations,
    postsMissingAssets,
    aiBudgetUsedToday,
  };
}

export type FeedEvent = { at: Date; label: string; tone: "ok" | "warn" | "info" };

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
  }));
}
