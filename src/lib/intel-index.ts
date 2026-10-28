import { OUTLIER_MIN_VIEWS } from "@/lib/intel";
import { db } from "@/lib/db";
import { youtubeFor } from "@/lib/youtube";

// Lives outside the "use server" actions file on purpose: every export there
// is callable from a browser, and this takes a workspace id as an argument.
/**
 * Index one channel (and a handful of its videos) into the Intel corpus.
 *
 * Shared by the handle path and the keyword path so they can't drift — the
 * outlier maths in particular has to stay identical, since a video's score is
 * only comparable to others computed the same way.
 */
export async function indexIntelChannel(
  workspaceId: string,
  source: { id: string; handle?: string; name: string; subscribers: number; videoCount: number; totalViews: number; language?: string; category?: string; thumbnailUrl?: string },
  videoLimit = 8,
) {
  // Re-indexing re-reads the channel, so its counts replace the stored ones;
  // they used to stay at the first index while only lastIndexedAt moved —
  // still spending the quota (audit IDE-11).
  const upserted = await db.intelChannel.upsert({
    where: { workspaceId_youtubeId: { workspaceId, youtubeId: source.id } },
    update: {
      lastIndexedAt: new Date(),
      thumbnailUrl: source.thumbnailUrl ?? undefined,
      name: source.name,
      handle: source.handle ?? undefined,
      subscribers: source.subscribers,
      totalViews: BigInt(source.totalViews),
      videoCount: source.videoCount,
    },
    create: {
      workspaceId,
      youtubeId: source.id,
      handle: source.handle ?? null,
      name: source.name,
      subscribers: source.subscribers,
      totalViews: BigInt(source.totalViews),
      videoCount: source.videoCount,
      language: source.language ?? null,
      category: source.category ?? null,
      thumbnailUrl: source.thumbnailUrl ?? null,
      lastIndexedAt: new Date(),
    },
  });
  // ⚠ A channel with zero (or hidden) uploads 404s its uploads playlist —
  // YouTube's way of saying "no videos", not an error worth dying for. One
  // such channel in a keyword batch used to kill the WHOLE indexing loop
  // (guard per item over external resources; the channel row above is still
  // worth keeping — it's real, it just has nothing to score).
  const videos = await youtubeFor(workspaceId).listVideos(source.id, videoLimit).catch((e) => {
    console.warn(`[intel] listVideos failed for ${source.name} (${source.id}) — indexing channel without videos:`, e instanceof Error ? e.message : e);
    return [];
  });
  // Outlier score is views over THIS channel's own average — the same
  // definition used for idea seeds. Never a fabricated figure.
  // ⚠ IDE-10: averaged PER FORMAT — Shorts and long-form draw on different
  // scales, and one average across 8 mixed uploads labelled noise "strong".
  // No score when the video has too few views or its format has too few
  // uploads (or too small an average) for a ratio to mean anything.
  const isShort = (v: { durationSeconds?: number | null }) => v.durationSeconds != null && v.durationSeconds <= 180;
  const formatAvg = (short: boolean) => {
    const same = videos.filter((v) => isShort(v) === short);
    return same.length >= 3 ? same.reduce((a, v) => a + v.views, 0) / same.length : null;
  };
  const avgShort = formatAvg(true), avgLong = formatAvg(false);
  const scoreOf = (v: { views: number; durationSeconds?: number | null }) => {
    const avg = isShort(v) ? avgShort : avgLong;
    if (avg == null || avg < 100 || v.views < OUTLIER_MIN_VIEWS) return null;
    return Math.round((v.views / avg) * 10) / 10;
  };
  const now = Date.now();
  const measuredAt = new Date(now);
  // Uploads per week, measured from the uploads just listed: (n − 1) gaps over
  // the span between the newest and oldest. Null with fewer than two dated
  // uploads — it was never computed at all and showed "0.0" (IDE-12).
  const dates = videos.map((v) => Date.parse(v.publishedAt)).filter(Number.isFinite).sort((a, b) => b - a);
  const spanWeeks = dates.length >= 2 ? (dates[0] - dates[dates.length - 1]) / (7 * 86_400_000) : 0;
  const uploadFrequency = spanWeeks > 0 ? Math.round(((dates.length - 1) / spanWeeks) * 10) / 10 : null;
  if (videos.length) {
    await db.intelChannel.update({ where: { id: upserted.id }, data: { uploadFrequency } });
  }
  for (const v of videos) {
    // Views per hour = views ÷ hours since publish, measured NOW (this is the
    // moment the views were read). Null when the maths can't be done. ⚠ Stored
    // at full precision: a ten-view video from two years ago is 0.0006/hr,
    // and rounding to two decimals turned that measured rate into a stored
    // zero (found on the first real index, 2026-09-16). Display rounds.
    const hours = v.publishedAt ? (now - Date.parse(v.publishedAt)) / 3_600_000 : NaN;
    const viewsPerHour = Number.isFinite(hours) && hours > 0 ? v.views / Math.max(1, hours) : null;
    // Everything measured is re-read on every index, with when (IDE-11).
    const measured = {
      views: BigInt(v.views),
      likes: v.likes ?? null,
      comments: v.comments ?? null,
      outlierScore: scoreOf(v),
      viewsPerSub: Math.round((v.views / Math.max(1, source.subscribers)) * 100) / 100,
      viewsPerHour,
      measuredAt,
    };
    await db.intelVideo.upsert({
      where: { intelChannelId_youtubeId: { intelChannelId: upserted.id, youtubeId: v.id } },
      update: { thumbnailUrl: v.thumbnailUrl ?? undefined, title: v.title, ...measured },
      create: {
        intelChannelId: upserted.id,
        youtubeId: v.id,
        title: v.title,
        publishedAt: new Date(v.publishedAt),
        durationSeconds: v.durationSeconds,
        format: v.format,
        thumbnailUrl: v.thumbnailUrl ?? null,
        ...measured,
      },
    });
  }
  return upserted;
}
