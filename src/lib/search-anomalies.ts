import { db } from "@/lib/db";
import { weightedPosition } from "@/lib/dashboard-data";

/**
 * Measured anomalies (E-MEA-19) for the Inbox and the morning digest: the
 * workspace's search clicks falling week on week, and articles that slipped
 * off page one. The two weeks end at the latest reading (Search Console lags),
 * each needs readings on most of its days, and thin traffic stays silent —
 * an alarm that fires on noise teaches people to ignore it. Failing syncs are
 * already their own Inbox item (MEA-06).
 */

const DAY = 86_400_000;
export const WEEK_DAYS = 7;
/** Clicks down at least this share, week on week. */
export const DROP_SHARE = 0.3;
/** The earlier week had at least this many clicks across the workspace. */
export const DROP_MIN_CLICKS = 50;
/** Each week has readings on at least this many of its days. */
export const MIN_DAYS = 5;
/** An article needs this many impressions in each week to judge its position. */
export const FELL_MIN_IMPRESSIONS = 30;
/** A latest reading older than this is a stopped sync, not news. */
export const MAX_STALE_DAYS = 10;

export type ClicksDrop = { recent: number; prior: number; drop: number; end: Date };
export type FellOff = { postId: string; title: string; before: number; after: number; impressions: number };

type Row = { postId: string; capturedAt: Date; clicks: number | null; impressions: number | null; position: number | null };
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export async function searchAnomalies(workspaceId: string, now = Date.now()): Promise<{ drop: ClicksDrop | null; fellOff: FellOff[] }> {
  const rows: Row[] = await db.blogSnapshot.findMany({
    where: { post: { workspaceId, status: "published" }, capturedAt: { gte: new Date(now - (2 * WEEK_DAYS + MAX_STALE_DAYS) * DAY) } },
    select: { postId: true, capturedAt: true, clicks: true, impressions: true, position: true },
  });
  if (!rows.length) return { drop: null, fellOff: [] };
  const anchor = Math.max(...rows.map((r) => r.capturedAt.getTime()));
  if (now - anchor > MAX_STALE_DAYS * DAY) return { drop: null, fellOff: [] };
  const cut = anchor - WEEK_DAYS * DAY;
  const recent = rows.filter((r) => r.capturedAt.getTime() > cut);
  const prior = rows.filter((r) => r.capturedAt.getTime() <= cut && r.capturedAt.getTime() > cut - WEEK_DAYS * DAY);
  const days = (rs: Row[]) => new Set(rs.filter((r) => r.clicks != null).map((r) => dayKey(r.capturedAt))).size;

  let drop: ClicksDrop | null = null;
  if (days(recent) >= MIN_DAYS && days(prior) >= MIN_DAYS) {
    const r = recent.reduce((a, x) => a + (x.clicks ?? 0), 0);
    const p = prior.reduce((a, x) => a + (x.clicks ?? 0), 0);
    if (p >= DROP_MIN_CLICKS && 1 - r / p >= DROP_SHARE) drop = { recent: r, prior: p, drop: 1 - r / p, end: new Date(anchor) };
  }

  const byPost = new Map<string, { recent: Row[]; prior: Row[] }>();
  for (const r of recent) (byPost.get(r.postId) ?? byPost.set(r.postId, { recent: [], prior: [] }).get(r.postId)!).recent.push(r);
  for (const r of prior) (byPost.get(r.postId) ?? byPost.set(r.postId, { recent: [], prior: [] }).get(r.postId)!).prior.push(r);
  const slipped: Array<Omit<FellOff, "title">> = [];
  for (const [postId, w] of byPost) {
    const imp = (rs: Row[]) => rs.reduce((a, x) => a + (x.impressions ?? 0), 0);
    if (imp(w.recent) < FELL_MIN_IMPRESSIONS || imp(w.prior) < FELL_MIN_IMPRESSIONS) continue;
    const before = weightedPosition(w.prior), after = weightedPosition(w.recent);
    if (before == null || after == null) continue;
    if (before <= 10 && after > 10) slipped.push({ postId, before, after, impressions: imp(w.recent) });
  }
  slipped.sort((a, b) => b.impressions - a.impressions);
  const titles = slipped.length
    ? new Map((await db.blogPost.findMany({ where: { id: { in: slipped.map((s) => s.postId) }, workspaceId }, select: { id: true, title: true } })).map((p) => [p.id, p.title]))
    : new Map<string, string>();
  return { drop, fellOff: slipped.map((s) => ({ ...s, title: titles.get(s.postId) ?? "An article" })) };
}
