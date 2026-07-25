import { db } from "@/lib/db";
import { gscQuery, getGscConfig } from "@/lib/analytics/gsc";
import { ga4RunReport, getGa4Config } from "@/lib/analytics/ga4";
import { writeAudit } from "@/lib/governance";

/**
 * The join between the analytics connectors and the metrics spine.
 *
 * Without this, connecting Search Console verifies green and Insights still
 * shows nothing: `gscQuery`/`ga4RunReport` had no callers, and BlogSnapshot was
 * only ever written by the manual entry form. This closes that chain.
 *
 * Two decisions that matter for correctness:
 *
 * 1. ONE ROW PER POST PER DAY. `collectPerformance` SUMS snapshots across the
 *    window, so every row must describe a single day. Storing a rolling
 *    "last 28 days" total per capture would multiply-count wildly. Both APIs are
 *    therefore queried with a date dimension.
 * 2. THE SYNC ONLY TOUCHES ITS OWN ROWS (`source` in gsc/ga4/sync). Search
 *    Console revises recent days, so a refresh must be able to overwrite — but
 *    it must never delete an operator's hand-entered snapshot.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** GSC data lags ~2 days and is revised for a while after; re-pull a week. */
const DEFAULT_LOOKBACK_DAYS = 10;

export type SyncOutcome = {
  ok: boolean;
  message: string;
  postsMatched: number;
  rowsWritten: number;
  /** Pages the APIs returned that matched no post — usually non-blog URLs. */
  unmatchedPages: number;
  sources: string[];
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Reduce a URL or path to a comparable key: path only, lowercased, no query,
 * no trailing slash. `https://x.com/blog/Post/?utm=1` and `/blog/post` both
 * become `/blog/post`.
 */
export function urlKey(input: string): string {
  if (!input) return "";
  let path = input.trim();
  try {
    if (/^https?:\/\//i.test(path)) path = new URL(path).pathname;
  } catch {
    // not a parseable URL — treat the raw string as a path
  }
  path = path.split("?")[0].split("#")[0].toLowerCase();
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path;
}

/**
 * Index published posts by every key they could be known by. `publishedUrl` is
 * authoritative; `slug` is a fallback, because a post published outside the app
 * (or before WordPress wiring) often has a slug and no stored URL — without it
 * a freshly-connected property would match nothing at all.
 */
async function buildPostIndex(workspaceId: string): Promise<Map<string, string>> {
  const posts = await db.blogPost.findMany({
    where: { workspaceId, status: "published" },
    select: { id: true, publishedUrl: true, slug: true },
  });
  const index = new Map<string, string>();
  for (const p of posts) {
    if (p.publishedUrl) index.set(urlKey(p.publishedUrl), p.id);
    if (p.slug) {
      const s = p.slug.trim().toLowerCase().replace(/^\/+|\/+$/g, "");
      if (s) index.set(`/${s}`, p.id);
    }
  }
  return index;
}

type DailyRow = { impressions?: number; clicks?: number; position?: number; sessions?: number };

/** Sync one workspace. Safe to call when nothing is configured — reports so. */
export async function syncWorkspaceAnalytics(
  workspaceId: string,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
): Promise<SyncOutcome> {
  const [gsc, ga4] = await Promise.all([getGscConfig(workspaceId), getGa4Config(workspaceId)]);
  const sources: string[] = [];
  if (gsc) sources.push("gsc");
  if (ga4) sources.push("ga4");
  if (!sources.length) {
    return {
      ok: false,
      message: "Neither Search Console nor GA4 is connected for this workspace.",
      postsMatched: 0,
      rowsWritten: 0,
      unmatchedPages: 0,
      sources,
    };
  }

  const index = await buildPostIndex(workspaceId);
  if (index.size === 0) {
    return {
      ok: false,
      message:
        "No published posts have a URL or slug to match against yet — publish a post (or set its slug) and the sync can attach data to it.",
      postsMatched: 0,
      rowsWritten: 0,
      unmatchedPages: 0,
      sources,
    };
  }

  // GSC lags ~2 days; asking for today just returns nothing.
  const endDate = ymd(new Date(Date.now() - 2 * DAY_MS));
  const startDate = ymd(new Date(Date.now() - lookbackDays * DAY_MS));

  // Accumulate per (postId, day) so both providers merge into one row.
  const byPostDay = new Map<string, DailyRow>();
  const unmatched = new Set<string>();
  const key = (postId: string, day: string) => `${postId}|${day}`;

  if (gsc) {
    // page + date → one row per URL per day, which is exactly our grain.
    const rows = await gscQuery(workspaceId, { startDate, endDate, dimensions: ["page", "date"], rowLimit: 500 });
    for (const r of rows) {
      const [page, date] = r.keys ?? [];
      if (!page || !date) continue;
      const postId = index.get(urlKey(page));
      if (!postId) {
        unmatched.add(urlKey(page));
        continue;
      }
      const k = key(postId, date);
      const cur = byPostDay.get(k) ?? {};
      // A page can appear once per day here, so assignment is right (not +=).
      cur.clicks = r.clicks ?? 0;
      cur.impressions = r.impressions ?? 0;
      cur.position = typeof r.position === "number" ? Math.round(r.position * 10) / 10 : undefined;
      byPostDay.set(k, cur);
    }
  }

  if (ga4) {
    const rows = await ga4RunReport(workspaceId, {
      startDate,
      endDate,
      dimensions: ["pagePath", "date"],
      metrics: ["sessions"],
      limit: 500,
    });
    for (const r of rows) {
      const [path, rawDate] = r.dimensions;
      if (!path || !rawDate) continue;
      const postId = index.get(urlKey(path));
      if (!postId) {
        unmatched.add(urlKey(path));
        continue;
      }
      // GA4 returns YYYYMMDD; normalize to match GSC's YYYY-MM-DD.
      const date = /^\d{8}$/.test(rawDate) ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6)}` : rawDate;
      const k = key(postId, date);
      const cur = byPostDay.get(k) ?? {};
      cur.sessions = Number(r.metrics[0] ?? 0);
      byPostDay.set(k, cur);
    }
  }

  // Replace this sync's own rows for the window, then insert fresh — GSC
  // revises recent days, and manual rows are protected by the source filter.
  const windowStart = new Date(`${startDate}T00:00:00.000Z`);
  const postIds = [...new Set([...byPostDay.keys()].map((k) => k.split("|")[0]))];
  if (postIds.length) {
    await db.blogSnapshot.deleteMany({
      where: { postId: { in: postIds }, source: { in: ["gsc", "ga4", "sync"] }, capturedAt: { gte: windowStart } },
    });
  }

  let rowsWritten = 0;
  for (const [k, v] of byPostDay) {
    const [postId, day] = k.split("|");
    // Skip empty days rather than storing a row of nulls.
    if (v.clicks === undefined && v.impressions === undefined && v.sessions === undefined) continue;
    await db.blogSnapshot.create({
      data: {
        postId,
        capturedAt: new Date(`${day}T00:00:00.000Z`),
        clicks: v.clicks ?? null,
        impressions: v.impressions ?? null,
        position: v.position ?? null,
        sessions: v.sessions ?? null,
        source: sources.length === 2 ? "sync" : sources[0],
      },
    });
    rowsWritten++;
  }

  const postsMatched = postIds.length;
  if (rowsWritten) {
    await writeAudit({
      workspaceId,
      action: "analytics.synced",
      entityType: "blog_snapshot",
      meta: { rowsWritten, postsMatched, sources, startDate, endDate },
    });
  }

  return {
    ok: true,
    message: rowsWritten
      ? `Synced ${rowsWritten} day-row${rowsWritten === 1 ? "" : "s"} across ${postsMatched} post${postsMatched === 1 ? "" : "s"} (${startDate} → ${endDate}).`
      : `Connected, but ${sources.join(" + ")} returned no data for any known post URL in ${startDate} → ${endDate}.${unmatched.size ? ` ${unmatched.size} other page(s) had traffic but match no post.` : ""}`,
    postsMatched,
    rowsWritten,
    unmatchedPages: unmatched.size,
    sources,
  };
}

/** Sync every workspace that has a connector configured. For the scheduler. */
export async function syncAllWorkspaces(): Promise<{ workspaces: number; rowsWritten: number }> {
  const workspaces = await db.workspace.findMany({ select: { id: true } });
  let rowsWritten = 0;
  let touched = 0;
  for (const w of workspaces) {
    try {
      const out = await syncWorkspaceAnalytics(w.id);
      if (out.sources.length) touched++;
      rowsWritten += out.rowsWritten;
    } catch (e) {
      console.error(`[analytics] sync failed for ${w.id}:`, e instanceof Error ? e.message : e);
    }
  }
  return { workspaces: touched, rowsWritten };
}
