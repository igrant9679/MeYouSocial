import { db } from "@/lib/db";
import { WINDOW_DAYS, weightedPosition } from "@/lib/dashboard-data";
import { formatDay } from "@/lib/zoned-dates";

/**
 * Content decay (E-MEA-15): a published article whose clicks over the 28 days
 * ending at its latest reading are down by DECAY_DROP or more on the 28 days
 * before. Measured or silent, like the recommendation rules — each window
 * needs readings on most of its days and the earlier one real traffic, so a
 * patchy sync or a post nobody visited never reads as a collapse. The windows
 * end where the data does (Search Console lags), never at "today".
 */

const DAY = 86_400_000;
/** Clicks down at least this share. */
export const DECAY_DROP = 0.3;
/** The earlier window had at least this many clicks — below it, a drop is noise. */
export const DECAY_MIN_PRIOR_CLICKS = 30;
/** Each window has a click reading on at least this many of its 28 days. */
export const DECAY_MIN_DAYS = 21;
/** A latest reading older than this is a stopped sync, not a current finding. */
export const DECAY_MAX_STALE_DAYS = 10;

export type Decay = {
  postId: string;
  title: string;
  focusKeyword: string | null;
  recentClicks: number;
  priorClicks: number;
  /** 0–1: the share of clicks lost. */
  drop: number;
  recentImpressions: number | null;
  priorImpressions: number | null;
  position: number | null;
  prevPosition: number | null;
  /** The day the recent window ends — the post's latest reading. */
  windowEnd: Date;
  /** Can the engine refresh it: live somewhere it knows, and not protected from rewrites. */
  refreshable: boolean;
  protectedFromRewrite: boolean;
  /** An idea already made to refresh it — any status, so a rejected one isn't made again. */
  refreshIdea: { id: string; status: string } | null;
};

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const sumOrNull = (rows: Array<number | null>) => (rows.some((v) => v != null) ? rows.reduce<number>((a, v) => a + (v ?? 0), 0) : null);

export async function decayingPosts(workspaceId: string, now = Date.now()): Promise<Decay[]> {
  const posts = await db.blogPost.findMany({
    // A retired article (E-IDE-04) points elsewhere now — its decline is expected, not a refresh idea.
    where: { workspaceId, status: "published", retiredAt: null },
    select: {
      id: true, title: true, focusKeyword: true, protectedFromRewrite: true, wpPostId: true, publishedUrl: true,
      snapshots: {
        where: { capturedAt: { gte: new Date(now - (2 * WINDOW_DAYS + DECAY_MAX_STALE_DAYS) * DAY) }, clicks: { not: null } },
        orderBy: { capturedAt: "desc" },
        select: { capturedAt: true, clicks: true, impressions: true, position: true },
      },
    },
  });
  const out: Omit<Decay, "refreshIdea">[] = [];
  for (const p of posts) {
    const anchor = p.snapshots[0]?.capturedAt.getTime();
    if (anchor == null || now - anchor > DECAY_MAX_STALE_DAYS * DAY) continue;
    const cut = anchor - WINDOW_DAYS * DAY;
    const recent = p.snapshots.filter((s) => s.capturedAt.getTime() > cut);
    const prior = p.snapshots.filter((s) => s.capturedAt.getTime() <= cut && s.capturedAt.getTime() > cut - WINDOW_DAYS * DAY);
    if (new Set(recent.map((s) => dayKey(s.capturedAt))).size < DECAY_MIN_DAYS) continue;
    if (new Set(prior.map((s) => dayKey(s.capturedAt))).size < DECAY_MIN_DAYS) continue;
    const recentClicks = recent.reduce((a, s) => a + (s.clicks ?? 0), 0);
    const priorClicks = prior.reduce((a, s) => a + (s.clicks ?? 0), 0);
    if (priorClicks < DECAY_MIN_PRIOR_CLICKS) continue;
    const drop = 1 - recentClicks / priorClicks;
    if (drop < DECAY_DROP) continue;
    out.push({
      postId: p.id, title: p.title, focusKeyword: p.focusKeyword,
      recentClicks, priorClicks, drop,
      recentImpressions: sumOrNull(recent.map((s) => s.impressions)),
      priorImpressions: sumOrNull(prior.map((s) => s.impressions)),
      position: weightedPosition(recent), prevPosition: weightedPosition(prior),
      windowEnd: new Date(anchor),
      refreshable: !p.protectedFromRewrite && (p.wpPostId != null || p.publishedUrl != null),
      protectedFromRewrite: p.protectedFromRewrite,
    });
  }
  // The most clicks lost first.
  out.sort((a, b) => (b.priorClicks - b.recentClicks) - (a.priorClicks - a.recentClicks));
  const ideas = out.length
    ? await db.blogIdea.findMany({
        where: { workspaceId, OR: [{ source: "refresh", refreshPostId: { in: out.map((d) => d.postId) } }, { title: { in: out.map((d) => refreshTitle(d.title)) } }] },
        select: { id: true, status: true, refreshPostId: true, title: true },
      })
    : [];
  return out.map((d) => {
    const idea = ideas.find((i) => i.refreshPostId === d.postId) ?? ideas.find((i) => i.title === refreshTitle(d.title));
    return { ...d, refreshIdea: idea ? { id: idea.id, status: idea.status } : null };
  });
}

export function refreshTitle(title: string): string {
  return `Refresh: ${title}`;
}

/** The evidence, as the idea's angle: the two windows' clicks, and impressions and position where measured. */
export function decayAngle(d: Pick<Decay, "recentClicks" | "priorClicks" | "drop" | "recentImpressions" | "priorImpressions" | "position" | "prevPosition" | "windowEnd">): string {
  const parts = [`Clicks fell ${Math.round(d.drop * 100)}% — ${d.recentClicks} in the 28 days to ${formatDay(d.windowEnd)} against ${d.priorClicks} in the 28 days before`];
  if (d.recentImpressions != null && d.priorImpressions != null) parts.push(`impressions ${d.priorImpressions} → ${d.recentImpressions}`);
  if (d.position != null && d.prevPosition != null) parts.push(`average position ${d.prevPosition.toFixed(1)} → ${d.position.toFixed(1)}`);
  return `${parts.join("; ")}. Update and expand it to win them back.`;
}

/**
 * A refresh idea for a live article — the one shape the engine's refresh loop
 * and the Measure button both write. Not when an idea to refresh it (by link
 * or by title) already exists in any status: a rejected one stays rejected.
 * Arrives as Discovered; approving it is a person's call.
 */
export async function createRefreshIdea(
  workspaceId: string,
  post: { postId: string; title: string; focusKeyword: string | null },
  angle: string,
): Promise<string | null> {
  const title = refreshTitle(post.title);
  const exists = await db.blogIdea.count({ where: { workspaceId, OR: [{ title }, { source: "refresh", refreshPostId: post.postId }] } });
  if (exists) return null;
  const idea = await db.blogIdea.create({
    data: { workspaceId, title, angle, keyword: post.focusKeyword, source: "refresh", postId: post.postId, refreshPostId: post.postId },
  });
  return idea.id;
}
