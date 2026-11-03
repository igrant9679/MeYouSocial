import { db } from "@/lib/db";
import type { MetricsRange } from "@/lib/metrics";

/**
 * Topics side by side (E-MEA-12): two to four Topics over the same weeks, with
 * what each of their articles and posts earned. Measure → Topics totals a Topic;
 * this asks which of them is working, week by week and item by item.
 *
 * Same bases as Measure → Topics: search clicks from BlogSnapshot rows of the
 * Topic's published articles, summed per day they cover; social engagement as
 * the latest reading of each target sent in the week (lifetime counters — so a
 * week's figure is "what the posts sent that week have earned so far"). Nothing
 * measured is a dash, never a zero.
 */

export const MAX_COMPARE = 4;

export type Week = { from: Date; to: Date };

/**
 * Whole weeks from `since` to `end`, the last one cut at `end`; at most `max`,
 * keeping the latest. A remainder under a day joins the week before it — a
 * range's start and "now" are read milliseconds apart, which would otherwise
 * add a week a few milliseconds long.
 */
export function weekBuckets(since: Date, end: Date, max = 26): Week[] {
  const out: Week[] = [];
  for (let t = since.getTime(); t < end.getTime(); t += 7 * 86_400_000) {
    if (out.length && end.getTime() - t < 86_400_000) {
      out[out.length - 1] = { from: out[out.length - 1].from, to: end };
      break;
    }
    out.push({ from: new Date(t), to: new Date(Math.min(t + 7 * 86_400_000, end.getTime())) });
  }
  return out.slice(-max);
}

export function bucketOf(at: Date, weeks: Week[]): number {
  return weeks.findIndex((w) => at >= w.from && at < w.to);
}

export type CompareItem = { id: string; title: string; href: string; value: number | null; extra?: string | null };

export type TopicColumn = {
  id: string;
  name: string;
  /** Per week: summed clicks (null = no reading that week). */
  clicks: Array<number | null>;
  /** Per week: posts sent. */
  sent: number[];
  /** Per week: engagement of the posts sent that week (null = none read). */
  engagement: Array<number | null>;
  totals: {
    clicks: number | null;
    articlesPublished: number;
    articlesMeasured: number;
    postsSent: number;
    postsMeasured: number;
    engagement: number | null;
    /** Clicks over the range ÷ articles with a reading in it. */
    clicksPerArticle: number | null;
    /** Engagement ÷ sent posts with a reading. */
    engagementPerPost: number | null;
  };
  articles: CompareItem[];
  posts: CompareItem[];
};

export type TopicComparison = { weeks: Week[]; topics: TopicColumn[] };

const sumOrNull = (vals: Array<number | null>) => {
  const v = vals.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
};
const round1 = (n: number) => Math.round(n * 10) / 10;

export async function topicComparison(workspaceId: string, topicIds: string[], range: MetricsRange): Promise<TopicComparison> {
  const end = range.until ?? new Date();
  const weeks = weekBuckets(range.since, end);
  const topics = await db.topic.findMany({ where: { workspaceId, id: { in: topicIds.slice(0, MAX_COMPARE) } }, select: { id: true, name: true } });
  // In the order they were asked for.
  topics.sort((a, b) => topicIds.indexOf(a.id) - topicIds.indexOf(b.id));
  if (!topics.length || !weeks.length) return { weeks, topics: [] };
  const ids = topics.map((t) => t.id);
  const since = weeks[0].from;

  const [articles, snapshots, targets] = await Promise.all([
    db.blogPost.findMany({ where: { workspaceId, topicId: { in: ids }, status: "published" }, select: { id: true, title: true, topicId: true, publishedAt: true } }),
    db.blogSnapshot.findMany({
      where: { post: { workspaceId, topicId: { in: ids }, status: "published" }, capturedAt: { gte: since, lt: end } },
      select: { postId: true, capturedAt: true, clicks: true, position: true },
      orderBy: { capturedAt: "asc" },
    }),
    db.socialPostTarget.findMany({
      where: { status: "posted", postedAt: { gte: since, lt: end }, post: { workspaceId, topicId: { in: ids } } },
      select: { id: true, postedAt: true, post: { select: { id: true, text: true, topicId: true } } },
    }),
  ]);
  const { readingsForWorkspace } = await import("@/lib/social/performance");
  const readings = await readingsForWorkspace(workspaceId, since, end);
  const readingByTarget = new Map(readings.map((r) => [r.targetId, r]));

  const columns: TopicColumn[] = topics.map((t) => {
    const mine = articles.filter((a) => a.topicId === t.id);
    const mineIds = new Set(mine.map((a) => a.id));
    const snaps = snapshots.filter((s) => mineIds.has(s.postId));
    const clicks: Array<number | null> = weeks.map(() => null);
    const perArticle = new Map<string, { clicks: number | null; position: number | null }>();
    for (const s of snaps) {
      const i = bucketOf(s.capturedAt, weeks);
      if (i < 0) continue;
      const cur = perArticle.get(s.postId) ?? { clicks: null, position: null };
      if (s.clicks !== null) {
        clicks[i] = (clicks[i] ?? 0) + s.clicks;
        cur.clicks = (cur.clicks ?? 0) + s.clicks;
      }
      if (s.position !== null) cur.position = s.position; // ascending, so the latest wins
      perArticle.set(s.postId, cur);
    }

    const sentTargets = targets.filter((x) => x.post.topicId === t.id);
    const sent = weeks.map(() => 0);
    const engagement: Array<number | null> = weeks.map(() => null);
    const perPost = new Map<string, { title: string; engagement: number | null; sentAt: Date }>();
    const countedPosts = new Set<string>();
    for (const x of sentTargets) {
      const i = bucketOf(x.postedAt!, weeks);
      if (i < 0) continue;
      // A post sent to three networks is one post sent.
      if (!countedPosts.has(x.post.id)) { sent[i] += 1; countedPosts.add(x.post.id); }
      const r = readingByTarget.get(x.id);
      const cur = perPost.get(x.post.id) ?? { title: x.post.text.replace(/\s+/g, " ").slice(0, 90), engagement: null, sentAt: x.postedAt! };
      if (r?.engagement != null) {
        engagement[i] = (engagement[i] ?? 0) + r.engagement;
        cur.engagement = (cur.engagement ?? 0) + r.engagement;
      }
      perPost.set(x.post.id, cur);
    }

    const totalClicks = sumOrNull(clicks);
    const measuredArticles = [...perArticle.values()].filter((v) => v.clicks !== null).length;
    const totalEng = sumOrNull(engagement);
    const measuredPosts = [...perPost.values()].filter((v) => v.engagement !== null).length;
    const publishedInRange = mine.filter((a) => a.publishedAt && a.publishedAt >= since && a.publishedAt < end).length;

    const articleItems: CompareItem[] = mine
      .map((a) => {
        const v = perArticle.get(a.id);
        return { id: a.id, title: a.title, href: `/blog/${a.id}?tab=performance`, value: v?.clicks ?? null, extra: v?.position != null ? `position ${v.position.toFixed(1)}` : null };
      })
      .sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
      .slice(0, 8);
    const postItems: CompareItem[] = [...perPost.entries()]
      .map(([id, v]) => ({ id, title: v.title || "(no text)", href: `/social/${id}`, value: v.engagement, extra: null }))
      .sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
      .slice(0, 8);

    return {
      id: t.id,
      name: t.name,
      clicks,
      sent,
      engagement,
      totals: {
        clicks: totalClicks,
        articlesPublished: publishedInRange,
        articlesMeasured: measuredArticles,
        postsSent: countedPosts.size,
        postsMeasured: measuredPosts,
        engagement: totalEng,
        clicksPerArticle: totalClicks !== null && measuredArticles ? round1(totalClicks / measuredArticles) : null,
        engagementPerPost: totalEng !== null && measuredPosts ? round1(totalEng / measuredPosts) : null,
      },
      articles: articleItems,
      posts: postItems,
    };
  });
  return { weeks, topics: columns };
}
