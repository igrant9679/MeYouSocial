import { db } from "@/lib/db";
import { rangeForDays, type MetricsRange } from "@/lib/metrics";
import { topicLedgers } from "@/lib/topics";
import { matchTopic, prepareTopics } from "@/lib/topic-match";

/**
 * What each Topic EARNED, per format — Measure → Topics, the far end of the
 * spine (2026-09-21). The per-Topic page under Ideas and this table are the
 * same data from two ends: one asks "what should we make about this?", the
 * other "was it worth it?".
 *
 * Every cell is measured or a dash, and the page says which:
 *   articles — positions and clicks from BlogSnapshot rows joined to posts
 *              tagged with the Topic (Search Console, or entered by hand);
 *   video    — the YouTube audit's per-video numbers, MATCHED BY KEYWORD to
 *              the Topic because the app has no link from a render to the
 *              uploaded video. Labelled as a match wherever shown; never
 *              stored; a dash with a reason when YouTube isn't connected;
 *   social   — the latest engagement reading per sent target (lib/social/
 *              performance) summed over posts tagged with the Topic.
 * Counts (made, out, ideas waiting) come from lib/topics — facts, not
 * measurements — and sit beside the numbers so a dash is never mistaken
 * for "nothing happened".
 */

export type TopicMeasureRow = {
  id: string;
  name: string;
  status: string;
  priority: number;
  ideasWaiting: number;
  articles: {
    made: number;
    published: number;
    /** Mean latest position over published posts that have one; null = none measured. */
    position: number | null;
    positionN: number;
    /** Clicks over the range, summed over posts with snapshots in it; null = none measured. */
    clicks: number | null;
    clicksN: number;
  };
  video: {
    renders: number;
    /** Audit videos whose title matched this Topic by keyword. */
    matched: number;
    views: number | null;
    /** Mean average-view percentage over matched videos reporting one. */
    avgViewPct: number | null;
  };
  social: {
    posts: number;
    posted: number;
    /** Targets with a reading. */
    n: number;
    engagement: number | null;
    impressions: number | null;
  };
};

export type TopicMeasure = {
  range: MetricsRange;
  rows: TopicMeasureRow[];
  /** Why a whole column is dashes, when it is. */
  notes: { articles: string | null; video: string | null; social: string | null };
};

export async function topicMeasure(workspaceId: string, days = 90): Promise<TopicMeasure> {
  const range = rangeForDays(days);
  const ledgers = await topicLedgers(workspaceId);
  const notes: TopicMeasure["notes"] = { articles: null, video: null, social: null };
  if (ledgers.length === 0) return { range, rows: [], notes };
  const ids = ledgers.map((t) => t.id);

  const [{ readingsForWorkspace }, { youtubeAuditFor }] = await Promise.all([import("@/lib/social/performance"), import("@/lib/youtube/analytics")]);

  const [posts, snapshots, socialPosts, readings, audit] = await Promise.all([
    db.blogPost.findMany({ where: { workspaceId, topicId: { in: ids }, status: "published" }, select: { id: true, topicId: true } }),
    db.blogSnapshot.findMany({
      where: { post: { workspaceId, topicId: { in: ids }, status: "published" } },
      select: { postId: true, capturedAt: true, position: true, clicks: true },
      orderBy: { capturedAt: "desc" },
    }),
    db.socialPost.findMany({ where: { workspaceId, topicId: { in: ids } }, select: { id: true, topicId: true } }),
    readingsForWorkspace(workspaceId, range.since),
    youtubeAuditFor(workspaceId, 90).catch((e: unknown) => ({ state: "error" as const, message: e instanceof Error ? e.message : String(e) })),
  ]);

  // Articles: latest position per published post; clicks summed in range.
  const postTopic = new Map(posts.map((p) => [p.id, p.topicId!]));
  const latestPos = new Map<string, number>();
  const clicksByPost = new Map<string, number>();
  for (const s of snapshots) {
    if (s.position != null && !latestPos.has(s.postId)) latestPos.set(s.postId, s.position);
    if (s.clicks != null && s.capturedAt >= range.since) clicksByPost.set(s.postId, (clicksByPost.get(s.postId) ?? 0) + s.clicks);
  }
  if (posts.length > 0 && snapshots.length === 0) notes.articles = "Published articles carry these Topics, but no positions or clicks have been recorded for them — connect Search Console under Settings → Analytics, or enter numbers on Blog analytics.";

  // Social: readings → post → topic.
  const socialTopic = new Map(socialPosts.map((p) => [p.id, p.topicId!]));
  const sentTagged = await db.socialPostTarget.count({ where: { status: "posted", postedAt: { gte: range.since }, post: { workspaceId, topicId: { in: ids } } } });
  if (sentTagged > 0 && readings.length === 0) notes.social = `${sentTagged} tagged post${sentTagged === 1 ? " was" : "s were"} sent in the ${range.label} but no engagement has been pulled back yet — check the Zernio connection under Settings → Connections.`;

  // Video: audit videos matched to Topics by keyword.
  const prepared = prepareTopics(await db.topic.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, keywords: true } }));
  const videoByTopic = new Map<string, { matched: number; views: number; pct: number[] }>();
  if (audit.state === "ok") {
    for (const v of audit.audit.videos) {
      const m = matchTopic(v.title, prepared);
      if (!m) continue;
      const cur = videoByTopic.get(m.id) ?? { matched: 0, views: 0, pct: [] };
      cur.matched += 1;
      cur.views += v.views;
      if (v.avgViewPct != null) cur.pct.push(v.avgViewPct);
      videoByTopic.set(m.id, cur);
    }
    if (audit.audit.videos.length > 0 && videoByTopic.size === 0) notes.video = "YouTube is connected, but none of its video titles matches a Topic's name or phrases by keyword — add phrases on Topics so titles match.";
  } else if (audit.state === "not_connected") {
    notes.video = "YouTube isn't connected, so no video views or retention can be shown — connect it under Settings → Analytics.";
  } else {
    notes.video = `The YouTube audit could not be read: ${audit.message}`;
  }

  const rows: TopicMeasureRow[] = ledgers.map((t) => {
    const myPosts = posts.filter((p) => postTopic.get(p.id) === t.id);
    const positions = myPosts.map((p) => latestPos.get(p.id)).filter((v): v is number => v != null);
    const clicks = myPosts.map((p) => clicksByPost.get(p.id)).filter((v): v is number => v != null);
    const myReadings = readings.filter((r) => socialTopic.get(r.postId) === t.id);
    const eng = myReadings.map((r) => r.engagement).filter((v): v is number => v != null);
    const imp = myReadings.map((r) => r.stats.impressions).filter((v): v is number => v != null);
    const vid = videoByTopic.get(t.id);
    return {
      id: t.id,
      name: t.name,
      status: t.status,
      priority: t.priority,
      ideasWaiting: t.ideas.discovered,
      articles: {
        made: t.made.articles,
        published: t.out.articles,
        position: positions.length ? Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 10) / 10 : null,
        positionN: positions.length,
        clicks: clicks.length ? clicks.reduce((a, b) => a + b, 0) : null,
        clicksN: clicks.length,
      },
      video: {
        renders: t.made.scripts, // scripts + renders are counted together in the ledger; renders alone below
        matched: vid?.matched ?? 0,
        views: vid ? vid.views : null,
        avgViewPct: vid && vid.pct.length ? Math.round(vid.pct.reduce((a, b) => a + b, 0) / vid.pct.length) : null,
      },
      social: {
        posts: t.made.posts,
        posted: t.out.posts,
        n: myReadings.length,
        engagement: eng.length ? eng.reduce((a, b) => a + b, 0) : null,
        impressions: imp.length ? imp.reduce((a, b) => a + b, 0) : null,
      },
    };
  });

  // Renders alone, for the video column's "made" figure.
  const renders = await db.videoRender.groupBy({ by: ["topicId"], where: { workspaceId, topicId: { in: ids }, status: "done" }, _count: { _all: true } });
  for (const r of rows) r.video.renders = renders.find((g) => g.topicId === r.id)?._count._all ?? 0;

  return { range, rows: rows.filter((r) => r.status === "active" || r.articles.made + r.video.renders + r.social.posts > 0), notes };
}
