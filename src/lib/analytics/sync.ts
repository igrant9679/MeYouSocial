import { db } from "@/lib/db";
import { gscQueryAll, getGscConfig } from "@/lib/analytics/gsc";
import { ga4RunReportAll, getGa4Config } from "@/lib/analytics/ga4";
import { explainGoogleError } from "@/lib/google/service-account";
import { setWorkspaceSetting } from "@/lib/settings";
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
  const fresh = new Map<string, DailyRow & { posWeight?: number }>();
  const unmatched = new Set<string>();
  const key = (postId: string, day: string) => `${postId}|${day}`;
  // Each source on its own (MEA-05): a GA4 403 used to throw away the Search
  // Console rows already collected, so nothing was written at all.
  const outcome: Partial<Record<Source, SourceOutcome>> = {};

  if (gsc) {
    try {
      // page + date → one row per URL per day, every page of them (MEA-07).
      const rows = await gscQueryAll(workspaceId, { startDate, endDate, dimensions: ["page", "date"] });
      let matched = 0;
      for (const r of rows) {
        const [page, date] = r.keys ?? [];
        if (!page || !date) continue;
        const postId = index.get(urlKey(page));
        if (!postId) {
          unmatched.add(urlKey(page));
          continue;
        }
        matched++;
        const k = key(postId, date);
        const cur = fresh.get(k) ?? {};
        // ⚠ ADD, don't assign: http/https, www, a trailing slash or a query
        // string are separate Search Console pages that all mean this post.
        const imp = r.impressions ?? 0;
        cur.clicks = (cur.clicks ?? 0) + (r.clicks ?? 0);
        cur.impressions = (cur.impressions ?? 0) + imp;
        if (typeof r.position === "number" && imp > 0) {
          // Impression-weighted, which is how Search Console averages it.
          const w = (cur.posWeight ?? 0) + imp;
          cur.position = ((cur.position ?? 0) * (cur.posWeight ?? 0) + r.position * imp) / w;
          cur.posWeight = w;
        }
        fresh.set(k, cur);
      }
      outcome.gsc = { ok: true, message: `${rows.length} page-day row${rows.length === 1 ? "" : "s"}, ${matched} matched a post`, rows: matched };
    } catch (e) {
      outcome.gsc = { ok: false, message: sourceError(e, gsc.cred.kind === "oauth" ? `The connected Google account (${gsc.identity}) needs access to this property in Search Console.` : `Add ${gsc.identity} as a user on this property in Search Console → Settings → Users and permissions.`), rows: 0 };
    }
  }

  if (ga4) {
    try {
      const rows = await ga4RunReportAll(workspaceId, { startDate, endDate, dimensions: ["pagePath", "date"], metrics: ["sessions"] });
      let matched = 0;
      for (const r of rows) {
        const [path, rawDate] = r.dimensions;
        if (!path || !rawDate) continue;
        const postId = index.get(urlKey(path));
        if (!postId) {
          unmatched.add(urlKey(path));
          continue;
        }
        matched++;
        // GA4 returns YYYYMMDD; normalize to match GSC's YYYY-MM-DD.
        const date = /^\d{8}$/.test(rawDate) ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6)}` : rawDate;
        const k = key(postId, date);
        const cur = fresh.get(k) ?? {};
        cur.sessions = (cur.sessions ?? 0) + Number(r.metrics[0] ?? 0);
        fresh.set(k, cur);
      }
      outcome.ga4 = { ok: true, message: `${rows.length} path-day row${rows.length === 1 ? "" : "s"}, ${matched} matched a post`, rows: matched };
    } catch (e) {
      outcome.ga4 = { ok: false, message: sourceError(e, ga4.cred.kind === "oauth" ? `The connected Google account (${ga4.identity}) needs at least Viewer access to this GA4 property.` : `Grant ${ga4.identity} the Viewer role on this property (GA4 → Admin → Property access management).`), rows: 0 };
    }
  }

  const gscOk = outcome.gsc?.ok === true;
  const ga4Ok = outcome.ga4?.ok === true;
  let rowsWritten = 0;
  let postsMatched = 0;
  if (gscOk || ga4Ok) {
    // Merge with this sync's own rows for the window: a source that FAILED
    // keeps the numbers it had (still the best known), a source that
    // succeeded replaces them — Search Console revises recent days. Manual
    // rows are protected by the source filter, as before.
    const windowStart = new Date(`${startDate}T00:00:00.000Z`);
    const existing = await db.blogSnapshot.findMany({
      where: { post: { workspaceId }, source: { in: ["gsc", "ga4", "sync"] }, capturedAt: { gte: windowStart } },
      select: { id: true, postId: true, capturedAt: true, clicks: true, impressions: true, position: true, sessions: true },
    });
    const merged = new Map<string, DailyRow>();
    for (const row of existing) {
      merged.set(key(row.postId, ymd(row.capturedAt)), {
        ...(gscOk ? {} : { clicks: row.clicks ?? undefined, impressions: row.impressions ?? undefined, position: row.position ?? undefined }),
        ...(ga4Ok ? {} : { sessions: row.sessions ?? undefined }),
      });
    }
    for (const [k, v] of fresh) {
      const cur = merged.get(k) ?? {};
      if (gscOk) {
        cur.clicks = v.clicks;
        cur.impressions = v.impressions;
        cur.position = v.position === undefined ? undefined : Math.round(v.position * 10) / 10;
      }
      if (ga4Ok) cur.sessions = v.sessions;
      merged.set(k, cur);
    }
    const data = [...merged]
      // Skip empty days rather than storing a row of nulls.
      .filter(([, v]) => v.clicks !== undefined || v.impressions !== undefined || v.sessions !== undefined)
      .map(([k, v]) => {
        const [postId, day] = k.split("|");
        const hasSearch = v.clicks !== undefined || v.impressions !== undefined;
        return {
          postId,
          capturedAt: new Date(`${day}T00:00:00.000Z`),
          clicks: v.clicks ?? null,
          impressions: v.impressions ?? null,
          position: v.position ?? null,
          sessions: v.sessions ?? null,
          source: hasSearch && v.sessions !== undefined ? "sync" : hasSearch ? "gsc" : "ga4",
        };
      });
    // One transaction, so a crash mid-write can't leave the window half empty.
    await db.$transaction([
      db.blogSnapshot.deleteMany({ where: { id: { in: existing.map((r) => r.id) } } }),
      db.blogSnapshot.createMany({ data }),
    ]);
    rowsWritten = data.length;
    postsMatched = new Set(data.map((d) => d.postId)).size;
  }

  await recordSyncStatus(workspaceId, outcome);
  const failed = (Object.entries(outcome) as Array<[Source, SourceOutcome]>).filter(([, o]) => !o.ok);
  if (rowsWritten) {
    await writeAudit({
      workspaceId,
      action: "analytics.synced",
      entityType: "blog_snapshot",
      meta: { rowsWritten, postsMatched, sources, startDate, endDate, failed: failed.map(([src]) => src) },
    });
  }

  const failNote = failed.map(([src, o]) => `${SOURCE_LABEL[src]} failed: ${o.message}`).join(" ");
  const anyOk = gscOk || ga4Ok;
  const okNote = rowsWritten
    ? `Synced ${rowsWritten} day-row${rowsWritten === 1 ? "" : "s"} across ${postsMatched} post${postsMatched === 1 ? "" : "s"} (${startDate} → ${endDate}).`
    : `Connected, but ${sources.filter((x) => outcome[x as Source]?.ok).join(" + ")} returned no data for any known post URL in ${startDate} → ${endDate}.${unmatched.size ? ` ${unmatched.size} other page(s) had traffic but match no post.` : ""}`;
  return {
    ok: anyOk && failed.length === 0,
    message: !anyOk ? failNote : failNote ? `${okNote} ${failNote} Its earlier numbers were kept.` : okNote,
    postsMatched,
    rowsWritten,
    unmatchedPages: unmatched.size,
    sources,
  };
}

// ── Per-source status (MEA-06) ───────────────────────────────────────────────
// Sync failures only reached the console, so a connected workspace whose GA4
// 403'd every six hours looked the same as one with no traffic. The last
// outcome per source is kept on the workspace and read by the Analytics tab,
// Insights and the Inbox.

type Source = "gsc" | "ga4";
export type SourceOutcome = { ok: boolean; message: string; rows: number };
export type SourceStatus = SourceOutcome & { at: string; failures: number; lastOkAt: string | null };
export type SyncStatus = Partial<Record<Source, SourceStatus>>;

export const SOURCE_LABEL: Record<Source, string> = { gsc: "Search Console", ga4: "GA4" };
const STATUS_KEY = "analytics:sync_status";

/** What Google said, with the fix the Verify buttons name (same wording). */
function sourceError(e: unknown, grantHint: string): string {
  return explainGoogleError(e instanceof Error ? e.message : String(e), { grantHint }).slice(0, 400);
}

export async function readSyncStatus(workspaceId: string): Promise<SyncStatus> {
  const row = await db.workspaceSetting.findUnique({ where: { workspaceId_key: { workspaceId, key: STATUS_KEY } } });
  if (!row) return {};
  try {
    return JSON.parse(row.value) as SyncStatus;
  } catch {
    return {};
  }
}

async function recordSyncStatus(workspaceId: string, outcome: Partial<Record<Source, SourceOutcome>>): Promise<void> {
  const prev = await readSyncStatus(workspaceId);
  const at = new Date().toISOString();
  const next: SyncStatus = {};
  for (const src of ["gsc", "ga4"] as const) {
    const o = outcome[src];
    if (!o) continue; // not connected this run — its old status no longer applies
    next[src] = {
      ...o,
      at,
      failures: o.ok ? 0 : (prev[src]?.failures ?? 0) + 1,
      lastOkAt: o.ok ? at : prev[src]?.lastOkAt ?? null,
    };
  }
  await setWorkspaceSetting(workspaceId, STATUS_KEY, Object.keys(next).length ? JSON.stringify(next) : "");
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
