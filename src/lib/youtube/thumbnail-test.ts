import { db } from "@/lib/db";

/**
 * Thumbnail A/B on a published video, scored by YouTube's own numbers (E-VID-05).
 *
 * YouTube's "Test & compare" isn't in the API, so the test ROTATES: each
 * thumbnail is the video's thumbnail for `daysEach` days in turn (`thumbnails.set`,
 * within the `youtube.upload` scope the channel already granted), then each
 * window is scored from YouTube's reach reports — thumbnail impressions and
 * their click-through rate per video per day (Reporting API report type
 * `channel_reach_basic_a1`, `yt-analytics.readonly`, also already granted).
 * Reports arrive about two days late, so a test "measures" for a few days after
 * its last window before it says anything.
 *
 * ⚠ Titles aren't tested: changing one needs `videos.update`, which needs the
 * `youtube.force-ssl` scope the channel never granted — the card says so.
 * ⚠ One window after another isn't a randomised test: a news day or a burst of
 * recommendations can sway one window. So a winner is named only when the
 * difference is statistically clear (two-proportion z-test, p < 0.05) on at
 * least 1,000 impressions each; otherwise it says "no clear difference".
 *
 * `YOUTUBE_REPORTING_BASE_URL` points the reach calls at a stand-in for tests.
 */

export const REACH_REPORT_TYPE = "channel_reach_basic_a1";
const REPORTING = () => (process.env.YOUTUBE_REPORTING_BASE_URL || "https://youtubereporting.googleapis.com/v1").replace(/\/+$/, "");
export const REACH_JOB_KEY = "youtube:reach_job";
export const MIN_IMPRESSIONS = 1000;
const DAY = 86_400_000;
/** How long after the last window the reports are given to arrive. */
export const REPORT_LAG_DAYS = 3;

export type Variant = { key: string; label: string };
export type TestWindow = { variant: number; from: string; to: string | null; setOk: boolean; note?: string };
export type DayData = Record<string, { impressions: number; clicks: number }>;
export type VariantResult = { variant: number; label: string; impressions: number; clicks: number; ctr: number | null; days: number };
export type Verdict = { results: VariantResult[]; winner: number | null; sentence: string; p: number | null };

export const readJsonOr = <T,>(raw: string | null | undefined, fallback: T): T => {
  try { return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
};

/** Normal CDF via the Abramowitz–Stegun erf approximation (error < 1.5e-7). */
function phi(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Two-sided p-value that two click-through rates differ. */
export function twoProportionP(c1: number, n1: number, c2: number, n2: number): number | null {
  if (n1 <= 0 || n2 <= 0) return null;
  const p = (c1 + c2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (!se) return null;
  const z = (c1 / n1 - c2 / n2) / se;
  return 2 * (1 - phi(Math.abs(z)));
}

const pct = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);

/** Each variant's days, impressions and clicks, and whether one clearly won. Pure. */
export function scoreTest(variants: Variant[], windows: TestWindow[], days: DayData): Verdict {
  const results: VariantResult[] = variants.map((v, i) => ({ variant: i, label: v.label, impressions: 0, clicks: 0, ctr: null, days: 0 }));
  for (const [date, d] of Object.entries(days)) {
    const t = Date.parse(`${date}T12:00:00Z`);
    // A day counts for the window that held it for the whole day — the day a thumbnail changed is left out.
    const w = windows.find((x) => Date.parse(x.from) <= t - 12 * 3600_000 && (!x.to || t + 12 * 3600_000 <= Date.parse(x.to)) && x.setOk);
    if (!w) continue;
    const r = results[w.variant];
    r.impressions += d.impressions;
    r.clicks += d.clicks;
    r.days += 1;
  }
  for (const r of results) r.ctr = r.impressions ? r.clicks / r.impressions : null;
  const ranked = [...results].filter((r) => r.ctr != null).sort((a, b) => (b.ctr ?? 0) - (a.ctr ?? 0));
  if (ranked.length < 2) return { results, winner: null, p: null, sentence: "Not enough of YouTube's reach data yet to compare." };
  const [best, ...rest] = ranked;
  const thin = results.filter((r) => r.impressions < MIN_IMPRESSIONS);
  const ps = rest.map((r) => twoProportionP(best.clicks, best.impressions, r.clicks, r.impressions));
  const worstP = ps.reduce<number | null>((a, b) => (a == null || b == null ? null : Math.max(a, b)), 0);
  if (thin.length) {
    return { results, winner: null, p: worstP, sentence: `No verdict yet — ${thin.map((r) => r.label).join(" and ")} had fewer than ${MIN_IMPRESSIONS.toLocaleString("en-GB")} impressions. ${best.label} leads at ${pct(best.ctr)}.` };
  }
  if (worstP != null && worstP < 0.05) {
    return { results, winner: best.variant, p: worstP, sentence: `${best.label} won: ${pct(best.ctr)} click-through against ${rest.map((r) => `${r.label} ${pct(r.ctr)}`).join(", ")} (p = ${worstP.toFixed(3)}).` };
  }
  return { results, winner: null, p: worstP, sentence: `No clear difference: ${[best, ...rest].map((r) => `${r.label} ${pct(r.ctr)}`).join(", ")}${worstP != null ? ` (p = ${worstP.toFixed(2)})` : ""} — keep whichever you prefer.` };
}

async function reporting<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${REPORTING()}${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(res.status === 403 ? "YouTube's Reporting API refused — it may not be enabled in the Google Cloud project, or the channel's sign-in lacks the analytics permission." : `YouTube's Reporting API answered ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}.`);
  }
  return (await res.json()) as T;
}

/** The channel's reach-report job — made once, kept in a workspace setting. Reports start the day after it's made. */
export async function ensureReachJob(token: string, workspaceId: string): Promise<string> {
  const { getSetting, setWorkspaceSetting } = await import("@/lib/settings");
  const known = await getSetting(REACH_JOB_KEY, workspaceId).catch(() => "");
  if (known) return known;
  const list = await reporting<{ jobs?: Array<{ id: string; reportTypeId: string }> }>(token, "/jobs");
  let id = list.jobs?.find((j) => j.reportTypeId === REACH_REPORT_TYPE)?.id;
  if (!id) {
    const made = await reporting<{ id: string }>(token, "/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reportTypeId: REACH_REPORT_TYPE, name: "MeYouSocial thumbnail tests" }) });
    id = made.id;
  }
  await setWorkspaceSetting(workspaceId, REACH_JOB_KEY, id);
  return id;
}

/** One day's reach report as CSV → this video's impressions and clicks that day. */
export function reachFromCsv(csv: string, videoId: string): { impressions: number; clicks: number } | null {
  const lines = csv.trim().split(/\r?\n/);
  const head = (lines.shift() ?? "").split(",");
  const vi = head.indexOf("video_id"), ii = head.indexOf("video_thumbnail_impressions"), ci = head.indexOf("video_thumbnail_impressions_ctr");
  if (vi < 0 || ii < 0 || ci < 0) return null;
  let impressions = 0, clicks = 0, seen = false;
  for (const line of lines) {
    const cols = line.split(",");
    if (cols[vi] !== videoId) continue;
    const n = Number(cols[ii]) || 0;
    let ctr = Number(cols[ci]) || 0;
    // The documented value is a ratio; a percentage (over 1) is read as one too.
    if (ctr > 1) ctr /= 100;
    impressions += n;
    clicks += n * ctr;
    seen = true;
  }
  return seen ? { impressions, clicks: Math.round(clicks) } : { impressions: 0, clicks: 0 };
}

/** Fetch the reach reports for days not yet held, from `since`. At most 40 downloads a call. */
export async function refreshDays(token: string, jobId: string, videoId: string, since: Date, have: DayData): Promise<DayData> {
  const out: DayData = { ...have };
  let pageToken = "";
  const want: Array<{ date: string; url: string }> = [];
  for (let page = 0; page < 10; page++) {
    const r = await reporting<{ reports?: Array<{ startTime: string; downloadUrl: string }>; nextPageToken?: string }>(token, `/jobs/${encodeURIComponent(jobId)}/reports?startTimeAtOrAfter=${encodeURIComponent(since.toISOString())}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
    for (const rep of r.reports ?? []) {
      const date = rep.startTime.slice(0, 10);
      if (!(date in out)) want.push({ date, url: rep.downloadUrl });
    }
    if (!r.nextPageToken) break;
    pageToken = r.nextPageToken;
  }
  for (const w of want.slice(0, 40)) {
    const res = await fetch(w.url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) continue;
    const row = reachFromCsv(await res.text(), videoId);
    if (row) out[w.date] = row;
  }
  return out;
}

/**
 * The sweep (every few hours): rotate a running test to its next thumbnail when
 * its window is up, read new reach days, and score a test whose reports are in.
 * A clear winner is put back on the video; otherwise the last one stays.
 */
export async function advanceThumbnailTests(now = new Date(), onlyId?: string): Promise<{ rotated: number; scored: number }> {
  const tests = await db.thumbnailTest.findMany({ where: { state: { in: ["running", "measuring"] }, ...(onlyId ? { id: onlyId } : {}) }, take: 50 });
  let rotated = 0, scored = 0;
  const { youtubeAccessToken } = await import("@/lib/youtube/oauth");
  const { setYoutubeThumbnail } = await import("@/lib/youtube/upload");
  const { storage } = await import("@/lib/storage");
  const setThumb = async (token: string, videoId: string, v: Variant) => {
    const bytes = await storage.head(v.key, 2 * 1024 * 1024 + 1).catch(() => null);
    if (!bytes) return { ok: false, note: "The image couldn't be read from storage." };
    return setYoutubeThumbnail(token, videoId, bytes, v.key.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");
  };
  for (const t of tests) {
    const token = await youtubeAccessToken(t.workspaceId);
    if (!token) {
      await db.thumbnailTest.update({ where: { id: t.id }, data: { error: "The YouTube connection isn't working — reconnect it under Settings → Connections; the test resumes on its own." } });
      continue;
    }
    const variants = readJsonOr<Variant[]>(t.variants, []);
    const windows = readJsonOr<TestWindow[]>(t.windows, []);
    let days = readJsonOr<DayData>(t.dayData, {});
    const lastW = windows[windows.length - 1];
    const data: Record<string, unknown> = { error: null };
    try {
      if (t.state === "running" && lastW && now.getTime() - Date.parse(lastW.from) >= t.daysEach * DAY) {
        lastW.to = now.toISOString();
        if (t.current < variants.length - 1) {
          const next = t.current + 1;
          const r = await setThumb(token, t.videoId, variants[next]);
          windows.push({ variant: next, from: now.toISOString(), to: null, setOk: r.ok, ...(r.ok ? {} : { note: r.note }) });
          data.current = next;
          rotated++;
          if (!r.ok) { data.state = "failed"; data.error = r.note; }
        } else {
          data.state = "measuring";
        }
        data.windows = JSON.stringify(windows);
      }
      const jobId = await ensureReachJob(token, t.workspaceId);
      days = await refreshDays(token, jobId, t.videoId, new Date(Date.parse(windows[0]?.from ?? t.startedAt.toISOString()) - DAY), days);
      data.dayData = JSON.stringify(days);
      const verdict = scoreTest(variants, windows, days);
      data.result = JSON.stringify(verdict);
      const ended = (data.state ?? t.state) === "measuring" ? Date.parse(windows[windows.length - 1]?.to ?? now.toISOString()) : null;
      if (ended != null && now.getTime() - ended >= REPORT_LAG_DAYS * DAY) {
        data.state = "done";
        scored++;
        if (verdict.winner != null && verdict.winner !== (data.current ?? t.current)) {
          const r = await setThumb(token, t.videoId, variants[verdict.winner]);
          data.current = verdict.winner;
          if (!r.ok) data.error = `The winner couldn't be put back: ${r.note}`;
        }
      }
    } catch (e) {
      data.error = (e instanceof Error ? e.message : String(e)).slice(0, 400);
    }
    await db.thumbnailTest.update({ where: { id: t.id }, data });
  }
  return { rotated, scored };
}
