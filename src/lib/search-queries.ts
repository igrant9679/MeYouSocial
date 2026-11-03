import { db } from "@/lib/db";

/**
 * What people searched to find each page, and where the workspace's own
 * keywords rank (E-MEA-08). The analytics sync read Search Console by page ×
 * date only, so an article's numbers said how much traffic it had and never
 * what for, and the keyword table had volumes but no idea whether the site
 * ranked for any of them.
 *
 * Each sync reads page × query over the last QUERY_WINDOW_DAYS and REPLACES
 * the workspace's rows: a rolling snapshot of one window, never summed across
 * syncs. Kept per page: its top QUERIES_PER_PAGE by clicks, then impressions;
 * plus, on any page, every query that is one of the workspace's keywords, so a
 * keyword's position is there even when it isn't a page's best query.
 */

export const QUERY_WINDOW_DAYS = 28;
export const QUERIES_PER_PAGE = 20;
export const MAX_QUERY_ROWS = 25_000;

export type GscQueryRow = { keys?: string[]; clicks?: number; impressions?: number; position?: number };
export type QueryRow = { page: string; query: string; clicks: number; impressions: number; position: number };

/** A query as compared: lower case, single spaces. */
export const normQuery = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Merge Search Console's page variants into one page (`pageKey`, the sync's
 * urlKey) — clicks and impressions add, position is impression-weighted — and
 * keep what's worth keeping. Pure, for the sync and its check.
 */
export function pickQueryRows(rows: GscQueryRow[], pageKey: (raw: string) => string, keywords: ReadonlySet<string>): QueryRow[] {
  const merged = new Map<string, QueryRow & { w: number }>();
  for (const r of rows) {
    const [rawPage, rawQuery] = r.keys ?? [];
    if (!rawPage || !rawQuery) continue;
    const page = pageKey(rawPage);
    const query = normQuery(rawQuery);
    if (!query) continue;
    const k = `${page}\u0000${query}`;
    const cur = merged.get(k) ?? { page, query, clicks: 0, impressions: 0, position: 0, w: 0 };
    const imp = r.impressions ?? 0;
    cur.clicks += r.clicks ?? 0;
    cur.impressions += imp;
    if (typeof r.position === "number") {
      // Impression-weighted, as Search Console averages it (its rows always
      // have at least one impression; the floor only guards a malformed one).
      const w = Math.max(imp, 1);
      cur.position = (cur.position * cur.w + r.position * w) / (cur.w + w);
      cur.w += w;
    }
    merged.set(k, cur);
  }
  const byPage = new Map<string, (QueryRow & { w: number })[]>();
  for (const row of merged.values()) {
    if (row.w === 0) continue; // no position at all — nothing to rank
    byPage.set(row.page, [...(byPage.get(row.page) ?? []), row]);
  }
  const out: QueryRow[] = [];
  for (const list of byPage.values()) {
    list.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || a.position - b.position);
    list.forEach((row, i) => {
      if (i < QUERIES_PER_PAGE || keywords.has(row.query)) {
        out.push({ page: row.page, query: row.query, clicks: row.clicks, impressions: row.impressions, position: Math.round(row.position * 10) / 10 });
      }
    });
  }
  return out;
}

/**
 * Read page × query for the window and replace the workspace's rows. Called by
 * the analytics sync after its page × date pass; `index` is its urlKey → post.
 */
export async function syncSearchQueries(
  workspaceId: string,
  index: Map<string, string>,
  pageKey: (raw: string) => string,
  fetchRows: (startDate: string, endDate: string) => Promise<GscQueryRow[]>,
): Promise<number> {
  const day = 86_400_000;
  // Search Console lags about two days.
  const end = new Date(Date.now() - 2 * day);
  const start = new Date(end.getTime() - (QUERY_WINDOW_DAYS - 1) * day);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const rows = await fetchRows(ymd(start), ymd(end));
  const keywords = new Set(
    (await db.keyword.findMany({ where: { workspaceId, status: "active" }, select: { phrase: true } })).map((k) => normQuery(k.phrase)),
  );
  const picked = pickQueryRows(rows, pageKey, keywords);
  const windowStart = new Date(`${ymd(start)}T00:00:00Z`);
  const windowEnd = new Date(`${ymd(end)}T00:00:00Z`);
  await db.$transaction([
    db.searchQuery.deleteMany({ where: { workspaceId } }),
    db.searchQuery.createMany({
      data: picked.map((r) => ({ workspaceId, postId: index.get(r.page) ?? null, ...r, windowStart, windowEnd })),
    }),
  ]);
  return picked.length;
}

const QUERY_SELECT = { query: true, clicks: true, impressions: true, position: true, windowStart: true, windowEnd: true } as const;

/**
 * An article's top queries, best first — and its focus keyword's row after
 * them when that ranks below the top (it is kept whenever it's a keyword).
 */
export async function topQueriesForPost(postId: string, focus?: string | null, limit = QUERIES_PER_PAGE) {
  const top = await db.searchQuery.findMany({
    where: { postId },
    orderBy: [{ clicks: "desc" }, { impressions: "desc" }, { position: "asc" }],
    take: limit,
    select: QUERY_SELECT,
  });
  const want = focus ? normQuery(focus) : null;
  if (!want || top.some((q) => q.query === want)) return top;
  const own = await db.searchQuery.findFirst({ where: { postId, query: want }, select: QUERY_SELECT });
  return own ? [...top, own] : top;
}

export type KeywordRank = { position: number; clicks: number; impressions: number; page: string; postId: string | null; postTitle: string | null };

/**
 * Where each keyword ranks over the window: impression-weighted across every
 * page that showed for it, with the page that did best (clicks, then
 * impressions). Keyed by `normQuery(phrase)`. A keyword with no row isn't in
 * the map — not ranking in the window, or not synced.
 */
export async function keywordRanks(workspaceId: string, phrases: string[]): Promise<Map<string, KeywordRank>> {
  const wanted = [...new Set(phrases.map(normQuery))].filter(Boolean);
  if (!wanted.length) return new Map();
  const rows = await db.searchQuery.findMany({
    where: { workspaceId, query: { in: wanted } },
    select: { query: true, page: true, postId: true, clicks: true, impressions: true, position: true, post: { select: { title: true } } },
  });
  const out = new Map<string, KeywordRank & { w: number; best: number[] }>();
  for (const r of rows) {
    const w = Math.max(r.impressions, 1);
    const cur = out.get(r.query);
    if (!cur) {
      out.set(r.query, { position: r.position, clicks: r.clicks, impressions: r.impressions, page: r.page, postId: r.postId, postTitle: r.post?.title ?? null, w, best: [r.clicks, r.impressions] });
      continue;
    }
    cur.position = (cur.position * cur.w + r.position * w) / (cur.w + w);
    cur.w += w;
    cur.clicks += r.clicks;
    cur.impressions += r.impressions;
    if (r.clicks > cur.best[0] || (r.clicks === cur.best[0] && r.impressions > cur.best[1])) {
      cur.page = r.page;
      cur.postId = r.postId;
      cur.postTitle = r.post?.title ?? null;
      cur.best = [r.clicks, r.impressions];
    }
  }
  return new Map([...out].map(([k, v]) => [k, { position: Math.round(v.position * 10) / 10, clicks: v.clicks, impressions: v.impressions, page: v.page, postId: v.postId, postTitle: v.postTitle }]));
}

/** When the stored window was read, if it ever was. */
export async function queryWindow(workspaceId: string): Promise<{ start: Date; end: Date; syncedAt: Date } | null> {
  const r = await db.searchQuery.findFirst({ where: { workspaceId }, select: { windowStart: true, windowEnd: true, syncedAt: true } });
  return r ? { start: r.windowStart, end: r.windowEnd, syncedAt: r.syncedAt } : null;
}
