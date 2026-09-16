import { db } from "@/lib/db";
import { googleApi, explainGoogleError } from "@/lib/google/service-account";
import { youtubeAccessToken, youtubeOauthConnected } from "@/lib/youtube/oauth";

// The channel audit: what the workspace's OWN YouTube channel did over a
// window, from the YouTube Analytics API (yt-analytics.readonly — already in
// YOUTUBE_SCOPES) plus the Data API for titles, durations and upload dates.
//
// Every number here is measured or absent. The Analytics API omits rows for
// zero-view days and videos; a video uploaded inside the window with no
// analytics row genuinely had no views, so it is shown as 0 — the one place a
// blank IS a zero. Impressions and impressions click-through rate are NOT
// exposed by the Analytics API (only card/annotation impressions are), so the
// page says so instead of showing a dash that looks like a missing grant.
//
// Fetches are cached per workspace + window in WorkspaceSetting
// `youtube:audit:<days>` (JSON, read directly — not through the 30s settings
// cache) and refreshed on demand or when older than AUDIT_STALE_MS.

export const AUDIT_WINDOWS = [7, 28, 90, 365] as const;
export type AuditWindow = (typeof AUDIT_WINDOWS)[number];
export const AUDIT_STALE_MS = 24 * 60 * 60 * 1000;

export type AuditTotals = {
  views: number;
  minutesWatched: number;
  /** Seconds. Null when there were no views to average over. */
  avgViewSec: number | null;
  /** Retention: average percentage of a video watched, 0..100. Null without views. */
  avgViewPct: number | null;
  subsGained: number;
  subsLost: number;
  likes: number;
  comments: number;
  shares: number;
};

export type AuditVideo = {
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
  durationSec: number | null;
  /** ≤ 180s — YouTube's Shorts ceiling since Oct 2024. Null when the duration is unknown. */
  isShort: boolean | null;
  /** Published inside the audit window. */
  inWindow: boolean;
  /** All-time views from the Data API (the window figure is `views`). */
  lifetimeViews: number | null;
  /** Lifetime views ÷ hours since publish — how fast the video moves on average. Null without a publish date. */
  viewsPerHour: number | null;
  views: number;
  minutesWatched: number;
  avgViewSec: number | null;
  /** 0..100. Null when the API gave none (no views). */
  avgViewPct: number | null;
  likes: number;
  comments: number;
  shares: number;
  subsGained: number;
};

export type YoutubeAudit = {
  fetchedAt: string;
  days: AuditWindow;
  start: string;
  end: string;
  prevStart: string;
  channel: { id: string; title: string; url: string; subscribers: number | null; totalViews: number | null; videoCount: number | null };
  totals: AuditTotals;
  prev: AuditTotals;
  daily: Array<{ date: string; views: number; minutesWatched: number; subsNet: number }>;
  /** Every video with a view in the window (≤200, views desc) plus in-window uploads with none. */
  videos: AuditVideo[];
  uploadsInWindow: number;
  uploadsPrev: number;
  /** ISO date of the most recent upload seen, if any. */
  lastUploadAt: string | null;
};

export type AuditResult =
  | { state: "ok"; audit: YoutubeAudit; fromCache: boolean }
  | { state: "not_connected" }
  | { state: "error"; message: string };

const ANALYTICS = "https://youtubeanalytics.googleapis.com/v2/reports";
const DATA = "https://www.googleapis.com/youtube/v3";
const GRANT_HINT =
  "Reconnect YouTube under Publish Admin → Analytics — whoever connects must be able to act as the channel (its owner or a Brand Account manager), and the consent must include YouTube Analytics.";

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const n0 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const nOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** ISO 8601 duration (PT1H2M3S) → seconds. */
export function parseIsoDuration(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  return (+(m[1] ?? 0)) * 86_400 + (+(m[2] ?? 0)) * 3600 + (+(m[3] ?? 0)) * 60 + (+(m[4] ?? 0));
}

type ResultTable = { columnHeaders?: Array<{ name: string }>; rows?: Array<Array<string | number>> };

/** One reports.query call, returned as objects keyed by column name. */
async function query(token: string, params: Record<string, string>): Promise<Array<Record<string, string | number>>> {
  const qs = new URLSearchParams({ ids: "channel==MINE", ...params });
  const res = await googleApi<ResultTable>(`${ANALYTICS}?${qs}`, token);
  const cols = (res.columnHeaders ?? []).map((c) => c.name);
  return (res.rows ?? []).map((row) => Object.fromEntries(row.map((v, i) => [cols[i], v])));
}

const TOTAL_METRICS = "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,comments,shares";

function totalsFrom(row: Record<string, string | number> | undefined): AuditTotals {
  const views = n0(row?.views);
  return {
    views,
    minutesWatched: n0(row?.estimatedMinutesWatched),
    avgViewSec: views > 0 ? nOrNull(row?.averageViewDuration) : null,
    avgViewPct: views > 0 ? nOrNull(row?.averageViewPercentage) : null,
    subsGained: n0(row?.subscribersGained),
    subsLost: n0(row?.subscribersLost),
    likes: n0(row?.likes),
    comments: n0(row?.comments),
    shares: n0(row?.shares),
  };
}

/**
 * Live fetch — five or six calls. Throws with a Google-explained message.
 * Exported for probes; the page goes through `youtubeAuditFor`.
 */
export async function fetchYoutubeAudit(workspaceId: string, days: AuditWindow): Promise<YoutubeAudit | { notConnected: true }> {
  const token = await youtubeAccessToken(workspaceId);
  if (!token) return { notConnected: true };

  // Analytics data lags ~2 days; end the window at "yesterday" so the last
  // point isn't a permanent dip.
  const end = addDays(new Date(), -1);
  const start = addDays(end, -(days - 1));
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(days - 1));
  const S = isoDay(start), E = isoDay(end), PS = isoDay(prevStart), PE = isoDay(prevEnd);

  type ChannelList = { items?: Array<{ id: string; snippet?: { title?: string }; statistics?: { subscriberCount?: string; viewCount?: string; videoCount?: string; hiddenSubscriberCount?: boolean }; contentDetails?: { relatedPlaylists?: { uploads?: string } } }> };
  const [chan, totalRows, prevRows, dayRows, videoRows] = await Promise.all([
    googleApi<ChannelList>(`${DATA}/channels?part=snippet,statistics,contentDetails&mine=true`, token),
    query(token, { startDate: S, endDate: E, metrics: TOTAL_METRICS }),
    query(token, { startDate: PS, endDate: PE, metrics: TOTAL_METRICS }),
    query(token, { startDate: S, endDate: E, metrics: "views,estimatedMinutesWatched,subscribersGained,subscribersLost", dimensions: "day", sort: "day" }),
    query(token, {
      startDate: S, endDate: E, dimensions: "video", sort: "-views", maxResults: "200",
      metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained",
    }),
  ]);
  const item = chan.items?.[0];
  if (!item) throw new Error("The connected Google account has no YouTube channel of its own — reconnect as the channel's owner or a Brand Account manager.");
  const uploadsPlaylist = item.contentDetails?.relatedPlaylists?.uploads;

  // Uploads since the previous window began — cadence, and the in-window
  // uploads the analytics rows omitted because nobody watched them.
  type PlaylistItems = { items?: Array<{ contentDetails?: { videoId?: string; videoPublishedAt?: string } }>; nextPageToken?: string };
  const uploads: Array<{ id: string; publishedAt: string }> = [];
  if (uploadsPlaylist) {
    let pageToken = "";
    for (let page = 0; page < 4; page++) {
      const qs = new URLSearchParams({ part: "contentDetails", playlistId: uploadsPlaylist, maxResults: "50", ...(pageToken ? { pageToken } : {}) });
      const res = await googleApi<PlaylistItems>(`${DATA}/playlistItems?${qs}`, token);
      let older = false;
      for (const it of res.items ?? []) {
        const id = it.contentDetails?.videoId;
        const at = it.contentDetails?.videoPublishedAt;
        if (!id || !at) continue;
        if (at < PS) { older = true; break; }
        uploads.push({ id, publishedAt: at });
      }
      pageToken = res.nextPageToken ?? "";
      if (older || !pageToken) break;
    }
  }

  // Titles, durations, dates for everything we'll show.
  const ids = [...new Set([...videoRows.map((r) => String(r.video)), ...uploads.filter((u) => u.publishedAt >= S).map((u) => u.id)])];
  type VideoList = { items?: Array<{ id: string; snippet?: { title?: string; publishedAt?: string }; contentDetails?: { duration?: string }; statistics?: { viewCount?: string } }> };
  const meta = new Map<string, { title: string; publishedAt: string | null; durationSec: number | null; lifetimeViews: number | null }>();
  for (let i = 0; i < ids.length; i += 50) {
    const res = await googleApi<VideoList>(`${DATA}/videos?part=snippet,contentDetails,statistics&id=${ids.slice(i, i + 50).join(",")}`, token);
    for (const v of res.items ?? []) {
      const lifetime = v.statistics?.viewCount != null ? Number(v.statistics.viewCount) : NaN;
      meta.set(v.id, { title: v.snippet?.title ?? v.id, publishedAt: v.snippet?.publishedAt ?? null, durationSec: parseIsoDuration(v.contentDetails?.duration), lifetimeViews: Number.isFinite(lifetime) ? lifetime : null });
    }
  }

  const seen = new Set<string>();
  const videos: AuditVideo[] = [];
  const toVideo = (id: string, r: Record<string, string | number> | null): AuditVideo => {
    const m = meta.get(id);
    const publishedAt = m?.publishedAt ?? uploads.find((u) => u.id === id)?.publishedAt ?? null;
    const durationSec = m?.durationSec ?? null;
    const views = n0(r?.views);
    const lifetimeViews = m?.lifetimeViews ?? null;
    const hoursLive = publishedAt ? (Date.now() - Date.parse(publishedAt)) / 3_600_000 : null;
    return {
      id,
      title: m?.title ?? id,
      url: `https://www.youtube.com/watch?v=${id}`,
      publishedAt,
      durationSec,
      isShort: durationSec == null ? null : durationSec <= 180,
      inWindow: publishedAt != null && publishedAt.slice(0, 10) >= S,
      lifetimeViews,
      viewsPerHour: lifetimeViews != null && hoursLive != null && hoursLive >= 1 ? lifetimeViews / hoursLive : null,
      views,
      minutesWatched: n0(r?.estimatedMinutesWatched),
      avgViewSec: views > 0 ? nOrNull(r?.averageViewDuration) : null,
      avgViewPct: views > 0 ? nOrNull(r?.averageViewPercentage) : null,
      likes: n0(r?.likes),
      comments: n0(r?.comments),
      shares: n0(r?.shares),
      subsGained: n0(r?.subscribersGained),
    };
  };
  for (const r of videoRows) { const id = String(r.video); seen.add(id); videos.push(toVideo(id, r)); }
  for (const u of uploads) if (u.publishedAt >= S && !seen.has(u.id)) { seen.add(u.id); videos.push(toVideo(u.id, null)); }
  videos.sort((a, b) => b.views - a.views || (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));

  const hidden = item.statistics?.hiddenSubscriberCount;
  return {
    fetchedAt: new Date().toISOString(),
    days,
    start: S,
    end: E,
    prevStart: PS,
    channel: {
      id: item.id,
      title: item.snippet?.title ?? "channel",
      url: `https://www.youtube.com/channel/${item.id}`,
      subscribers: hidden ? null : nOrNull(Number(item.statistics?.subscriberCount)),
      totalViews: nOrNull(Number(item.statistics?.viewCount)),
      videoCount: nOrNull(Number(item.statistics?.videoCount)),
    },
    totals: totalsFrom(totalRows[0]),
    prev: totalsFrom(prevRows[0]),
    daily: dayRows.map((r) => ({ date: String(r.day), views: n0(r.views), minutesWatched: n0(r.estimatedMinutesWatched), subsNet: n0(r.subscribersGained) - n0(r.subscribersLost) })),
    videos,
    uploadsInWindow: uploads.filter((u) => u.publishedAt >= S).length,
    uploadsPrev: uploads.filter((u) => u.publishedAt < S).length,
    lastUploadAt: uploads[0]?.publishedAt ?? null,
  };
}

const cacheKey = (days: number) => `youtube:audit:${days}`;

/** Cached audit for the page; `refresh` forces a live fetch. */
export async function youtubeAuditFor(workspaceId: string, days: AuditWindow, opts: { refresh?: boolean } = {}): Promise<AuditResult> {
  const { connected } = await youtubeOauthConnected(workspaceId);
  if (!connected) return { state: "not_connected" };
  if (!opts.refresh) {
    const row = await db.workspaceSetting.findUnique({ where: { workspaceId_key: { workspaceId, key: cacheKey(days) } } }).catch(() => null);
    if (row) {
      try {
        const audit = JSON.parse(row.value) as YoutubeAudit;
        if (Date.now() - Date.parse(audit.fetchedAt) < AUDIT_STALE_MS) return { state: "ok", audit, fromCache: true };
      } catch {
        // unreadable cache — refetch below
      }
    }
  }
  try {
    const audit = await fetchYoutubeAudit(workspaceId, days);
    if ("notConnected" in audit) return { state: "not_connected" };
    const value = JSON.stringify(audit);
    await db.workspaceSetting.upsert({
      where: { workspaceId_key: { workspaceId, key: cacheKey(days) } },
      update: { value },
      create: { workspaceId, key: cacheKey(days), value },
    });
    return { state: "ok", audit, fromCache: false };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    return { state: "error", message: explainGoogleError(raw, { grantHint: GRANT_HINT }) };
  }
}

// ── The audit itself: findings a person can act on, each with its evidence ──

export type AuditFinding = {
  kind: "win" | "fix" | "info";
  title: string;
  detail: string;
  videos?: Array<{ id: string; title: string; url: string; note: string }>;
};

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const pct = (now: number, before: number): number | null => (before > 0 ? Math.round(((now - before) / before) * 100) : null);
const fmtN = (n: number) => n.toLocaleString("en-US");
const signed = (p: number) => `${p > 0 ? "+" : ""}${p}%`;

/** Deterministic, explained. Small samples are named rather than trusted. */
export function youtubeAuditFindings(a: YoutubeAudit): AuditFinding[] {
  const out: AuditFinding[] = [];
  const t = a.totals, p = a.prev;
  const vids = a.videos;

  // Momentum vs the previous window.
  const dv = pct(t.views, p.views);
  const dw = pct(t.minutesWatched, p.minutesWatched);
  const subsNet = t.subsGained - t.subsLost;
  const prevNet = p.subsGained - p.subsLost;
  if (dv != null) {
    const kind = dv >= 10 ? "win" : dv <= -10 ? "fix" : "info";
    out.push({
      kind,
      title: `Views ${dv >= 0 ? "up" : "down"} ${Math.abs(dv)}% vs the previous ${a.days} days`,
      detail: `${fmtN(t.views)} views (was ${fmtN(p.views)}); watch time ${dw == null ? fmtN(Math.round(t.minutesWatched)) + " min" : signed(dw)}; subscribers net ${subsNet >= 0 ? "+" : ""}${fmtN(subsNet)} (was ${prevNet >= 0 ? "+" : ""}${fmtN(prevNet)}).`,
    });
  } else if (t.views > 0) {
    out.push({ kind: "info", title: `${fmtN(t.views)} views in the last ${a.days} days`, detail: "No views in the window before it, so there is no trend to compare against yet." });
  }

  // Top performers and their share.
  const top = vids.filter((v) => v.views > 0).slice(0, 3);
  if (top.length && t.views > 0) {
    const share = Math.round((top.reduce((s, v) => s + v.views, 0) / t.views) * 100);
    out.push({
      kind: "win",
      title: `Top ${top.length} video${top.length > 1 ? "s" : ""} = ${share}% of all views`,
      detail: share >= 60 ? "A few videos carry the channel — worth asking what they share (topic, format, hook) and making more of it." : "Views are spread across the catalogue rather than riding one hit.",
      videos: top.map((v) => ({ id: v.id, title: v.title, url: v.url, note: `${fmtN(v.views)} views${v.avgViewPct != null ? ` · ${Math.round(v.avgViewPct)}% watched` : ""}` })),
    });
  }

  // Fastest movers: lifetime views per hour among this window's uploads.
  const fresh = vids.filter((v) => v.inWindow);
  const movers = fresh.filter((v) => v.viewsPerHour != null && v.viewsPerHour > 0).sort((x, y) => (y.viewsPerHour as number) - (x.viewsPerHour as number));
  if (movers.length >= 2) {
    const lead = movers[0].viewsPerHour as number;
    const medVph = median(movers.map((v) => v.viewsPerHour as number)) as number;
    out.push({
      kind: lead >= medVph * 2 ? "win" : "info",
      title: `Fastest mover: ${movers[0].title.length > 60 ? movers[0].title.slice(0, 57) + "…" : movers[0].title} at ${lead >= 10 ? Math.round(lead) : lead.toFixed(1)} views/hour`,
      detail: `Lifetime views divided by hours since publish, across ${movers.length} uploads in the window (median ${medVph >= 10 ? Math.round(medVph) : medVph.toFixed(1)}/hour). The pace a video sets in its first days is the clearest read on its packaging.`,
      videos: movers.slice(0, 3).map((v) => ({ id: v.id, title: v.title, url: v.url, note: `${(v.viewsPerHour as number) >= 10 ? Math.round(v.viewsPerHour as number) : (v.viewsPerHour as number).toFixed(1)}/hr · ${fmtN(v.lifetimeViews ?? v.views)} views` })),
    });
  }

  // Uploads inside the window that did worse than the window's own median.
  const med = median(fresh.map((v) => v.views));
  if (med != null && fresh.length >= 4) {
    const weak = fresh.filter((v) => v.views < med * 0.5).sort((x, y) => x.views - y.views).slice(0, 5);
    if (weak.length) {
      out.push({
        kind: "fix",
        title: `${weak.length} of ${fresh.length} new uploads got under half the median (${fmtN(Math.round(med))} views)`,
        detail: "Compare their titles and thumbnails with the winners above — the packaging is the usual difference on a channel whose retention is steady.",
        videos: weak.map((v) => ({ id: v.id, title: v.title, url: v.url, note: `${fmtN(v.views)} views` })),
      });
    } else {
      out.push({ kind: "win", title: `Every new upload cleared half the median (${fmtN(Math.round(med))} views)`, detail: `${fresh.length} uploads in the window, none fell flat.` });
    }
  } else if (fresh.length > 0 && fresh.length < 4) {
    out.push({ kind: "info", title: `${fresh.length} upload${fresh.length > 1 ? "s" : ""} in the window — too few to judge against each other`, detail: "Under-performers are only named once there are four or more new uploads to compare." });
  }

  // Retention: who holds attention, who loses it — on videos with a real sample.
  const withRet = vids.filter((v) => v.avgViewPct != null && v.views >= 100);
  const retMed = median(withRet.map((v) => v.avgViewPct as number));
  if (retMed != null && withRet.length >= 3) {
    const losing = withRet.filter((v) => (v.avgViewPct as number) < retMed - 10).sort((x, y) => (x.avgViewPct as number) - (y.avgViewPct as number)).slice(0, 5);
    const holding = [...withRet].sort((x, y) => (y.avgViewPct as number) - (x.avgViewPct as number)).slice(0, 3);
    out.push({
      kind: "info",
      title: `Typical viewer watches ${Math.round(retMed)}% of a video`,
      detail: `Median across ${withRet.length} videos with 100+ views. The best holders are worth studying for pacing and openings.`,
      videos: holding.map((v) => ({ id: v.id, title: v.title, url: v.url, note: `${Math.round(v.avgViewPct as number)}% watched · ${fmtN(v.views)} views` })),
    });
    if (losing.length) {
      out.push({
        kind: "fix",
        title: `${losing.length} video${losing.length > 1 ? "s" : ""} lose viewers well before the median`,
        detail: `More than 10 points under the ${Math.round(retMed)}% median — usually a slow first 30 seconds or a title that promised something else.`,
        videos: losing.map((v) => ({ id: v.id, title: v.title, url: v.url, note: `${Math.round(v.avgViewPct as number)}% watched · ${fmtN(v.views)} views` })),
      });
    }
  }

  // Subscriber conversion.
  if (t.views >= 500) {
    const rate = (t.subsGained / t.views) * 1000;
    const conv = vids.filter((v) => v.views >= 500 && v.subsGained > 0).map((v) => ({ v, r: (v.subsGained / v.views) * 1000 })).sort((x, y) => y.r - x.r).slice(0, 3);
    out.push({
      kind: "info",
      title: `${rate.toFixed(1)} new subscribers per 1,000 views`,
      detail: conv.length ? "The strongest converters are the topics people want more of — end screens and pinned comments on those pull their weight." : "No single video with 500+ views converted a subscriber in the window.",
      videos: conv.map(({ v, r }) => ({ id: v.id, title: v.title, url: v.url, note: `${r.toFixed(1)} per 1,000 · ${fmtN(v.subsGained)} gained` })),
    });
  }

  // Shorts vs long-form, when both have a sample.
  const shorts = vids.filter((v) => v.isShort === true && v.views > 0);
  const longs = vids.filter((v) => v.isShort === false && v.views > 0);
  const sMed = median(shorts.map((v) => v.views));
  const lMed = median(longs.map((v) => v.views));
  if (sMed != null && lMed != null && shorts.length >= 3 && longs.length >= 3) {
    const shortsWin = sMed > lMed;
    out.push({
      kind: "info",
      title: `${shortsWin ? "Shorts" : "Long-form"} draw more views per video (median ${fmtN(Math.round(shortsWin ? sMed : lMed))} vs ${fmtN(Math.round(shortsWin ? lMed : sMed))})`,
      detail: `${shorts.length} Shorts and ${longs.length} long-form videos had views in the window. Watch time tells the other half: long-form carried ${fmtN(Math.round(longs.reduce((s, v) => s + v.minutesWatched, 0)))} of ${fmtN(Math.round(t.minutesWatched))} minutes.`,
    });
  }

  // Cadence.
  const perWeek = (a.uploadsInWindow / a.days) * 7;
  const prevPerWeek = (a.uploadsPrev / a.days) * 7;
  const daysSince = a.lastUploadAt ? Math.floor((Date.now() - Date.parse(a.lastUploadAt)) / 86_400_000) : null;
  if (daysSince != null && daysSince > 21) {
    out.push({ kind: "fix", title: `Nothing uploaded for ${daysSince} days`, detail: `The window averaged ${perWeek.toFixed(1)} uploads a week${prevPerWeek > 0 ? ` (${prevPerWeek.toFixed(1)} the window before)` : ""}. Gaps this long cost the channel its place in subscribers' feeds.` });
  } else if (a.uploadsInWindow > 0) {
    const dc = pct(a.uploadsInWindow, a.uploadsPrev);
    out.push({ kind: dc != null && dc <= -30 ? "fix" : "info", title: `${a.uploadsInWindow} upload${a.uploadsInWindow > 1 ? "s" : ""} in ${a.days} days — ${perWeek.toFixed(1)} a week`, detail: dc == null ? "No uploads in the window before, so cadence has no comparison yet." : `${signed(dc)} against the previous window's ${a.uploadsPrev}.` });
  } else {
    out.push({ kind: "fix", title: `No uploads in the last ${a.days} days`, detail: a.uploadsPrev > 0 ? `${a.uploadsPrev} went out in the window before.` : "Views in the window came entirely from the back catalogue." });
  }

  return out;
}
