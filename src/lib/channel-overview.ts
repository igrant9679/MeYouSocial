import { db } from "@/lib/db";
import { collectPerformance, collectSocialPerformance, within, type MetricsRange } from "@/lib/metrics";
import { AUDIT_WINDOWS, cachedYoutubeAudit, type AuditWindow } from "@/lib/youtube/analytics";

/**
 * Measure's first screen (E-MEA-18): one headline per channel — search,
 * social, YouTube, production — over the picker's range, against the period
 * before it. Every number comes from the collectors the tabs already use, so the
 * overview and the tab underneath can't disagree; a source that reported nothing
 * is a dash with the reason, never a zero.
 *
 * YouTube reports trailing windows only and costs quota per read, so its card
 * shows the stored audit for the window nearest the range, dated — it never
 * fetches. Reading it fresh is the YouTube audit page's job.
 */

export type ChannelKey = "search" | "social" | "youtube" | "production";

export type ChannelFigure = { label: string; value: number | null; previous: number | null; unit?: "count" | "percent" };

export type ChannelCard = {
  key: ChannelKey;
  title: string;
  href: string;
  headline: ChannelFigure;
  more: ChannelFigure[];
  /** Why the headline is a dash, or what the figures rest on. */
  note: string | null;
};

const val = (ms: Awaited<ReturnType<typeof collectPerformance>>, key: string) => ms.find((m) => m.key === key)?.value ?? null;

async function postsSent(workspaceId: string, range: MetricsRange): Promise<number> {
  return db.socialPost.count({ where: { workspaceId, targets: { some: { status: "posted", postedAt: within(range) } } } });
}

async function production(workspaceId: string, range: MetricsRange) {
  const [articles, social, videos] = await Promise.all([
    db.blogPost.count({ where: { workspaceId, status: "published", publishedAt: within(range) } }),
    db.socialPost.count({ where: { workspaceId, createdAt: within(range) } }),
    db.videoRender.count({ where: { workspaceId, status: "done", updatedAt: within(range) } }),
  ]);
  return { articles, social, videos };
}

/** The YouTube window nearest a range's length. */
export function nearestAuditWindow(days: number): AuditWindow {
  return AUDIT_WINDOWS.reduce((best, w) => (Math.abs(w - days) < Math.abs(best - days) ? w : best), AUDIT_WINDOWS[0]);
}

export async function channelOverview(workspaceId: string, range: MetricsRange & { days: number; previous: MetricsRange }): Promise<ChannelCard[]> {
  const ytDays = nearestAuditWindow(range.days);
  const [search, searchPrev, social, socialPrev, sent, sentPrev, made, madePrev, yt] = await Promise.all([
    collectPerformance(workspaceId, range),
    collectPerformance(workspaceId, range.previous),
    collectSocialPerformance(workspaceId, range),
    collectSocialPerformance(workspaceId, range.previous),
    postsSent(workspaceId, range),
    postsSent(workspaceId, range.previous),
    production(workspaceId, range),
    production(workspaceId, range.previous),
    cachedYoutubeAudit(workspaceId, ytDays).catch(() => ({ state: "none" as const })),
  ]);

  const clicks = val(search, "search_clicks");
  const cards: ChannelCard[] = [
    {
      key: "search",
      title: "Search",
      href: "/blog/analytics",
      headline: { label: "clicks", value: clicks, previous: val(searchPrev, "search_clicks") },
      more: [
        { label: "impressions", value: val(search, "search_impressions"), previous: val(searchPrev, "search_impressions") },
        { label: "click-through", value: val(search, "search_ctr"), previous: val(searchPrev, "search_ctr"), unit: "percent" },
      ],
      note: clicks === null ? "No Search Console readings in this range — connect it under Settings → Analytics, or enter numbers by hand." : null,
    },
    {
      key: "social",
      title: "Social",
      href: "/social/performance",
      headline: { label: "posts sent", value: sent, previous: sentPrev },
      more: [
        { label: "engagements", value: val(social, "social_engagement"), previous: val(socialPrev, "social_engagement") },
        { label: "link clicks", value: val(social, "social_clicks"), previous: val(socialPrev, "social_clicks") },
      ],
      note: sent > 0 && val(social, "social_engagement") === null ? "Sent, but no engagement pulled back from the networks yet." : "Engagement is the lifetime total of the posts sent in the range.",
    },
  ];

  if (yt.state === "ok") {
    const a = yt.audit;
    cards.push({
      key: "youtube",
      title: "YouTube",
      href: `/youtube?days=${ytDays}`,
      headline: { label: "views", value: a.totals.views, previous: a.prev.views },
      more: [
        { label: "subscribers net", value: a.totals.subsGained - a.totals.subsLost, previous: a.prev.subsGained - a.prev.subsLost },
        { label: "minutes watched", value: a.totals.minutesWatched, previous: a.prev.minutesWatched },
      ],
      note: `The last ${a.days} days as read on ${a.fetchedAt.slice(0, 10)} — YouTube reports trailing windows only.`,
    });
  } else {
    cards.push({
      key: "youtube",
      title: "YouTube",
      href: `/youtube?days=${ytDays}`,
      headline: { label: "views", value: null, previous: null },
      more: [],
      note: yt.state === "not_connected" ? "No YouTube channel connected." : `Not read yet for ${ytDays} days — open the YouTube audit to read it.`,
    });
  }

  cards.push({
    key: "production",
    title: "Production",
    href: "/reports",
    headline: { label: "articles published", value: made.articles, previous: madePrev.articles },
    more: [
      { label: "social posts made", value: made.social, previous: madePrev.social },
      { label: "video boards finished", value: made.videos, previous: madePrev.videos },
    ],
    note: null,
  });
  return cards;
}

/** "+12%" / "−3" style change, or null when either side is unmeasured or the base is zero. */
export function change(value: number | null, previous: number | null, unit: "count" | "percent" = "count"): { text: string; up: boolean } | null {
  if (value === null || previous === null) return null;
  if (unit === "percent") {
    const d = Math.round((value - previous) * 10) / 10;
    if (d === 0) return { text: "no change", up: true };
    return { text: `${d >= 0 ? "+" : "−"}${Math.abs(d)} pts`, up: d >= 0 };
  }
  if (previous === 0) return value === 0 ? { text: "no change", up: true } : null;
  const pct = Math.round(((value - previous) / previous) * 100);
  if (pct === 0) return { text: "no change", up: true };
  return { text: `${pct >= 0 ? "+" : "−"}${Math.abs(pct)}%`, up: pct >= 0 };
}
