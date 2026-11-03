import { db } from "@/lib/db";

/**
 * Social → article attribution (E-MEA-07). Links the app sends are tagged per
 * network (utm_source = the network, utm_medium = social, utm_campaign = the
 * campaign's own code), but nothing read those tags back: an article said how
 * many sessions it had, never how many came from the posts that pointed at it,
 * and a campaign's page counted likes, not visits.
 *
 * Each normal analytics sync reads GA4 sessions by landing page × source ×
 * medium × campaign over the last VISIT_WINDOW_DAYS and REPLACES the
 * workspace's rows — a rolling snapshot like the search queries (E-MEA-08),
 * never summed across syncs. Kept: social sessions only — medium "social", a
 * known network as the source, or a campaign code one of the workspace's
 * campaigns uses.
 */

export const VISIT_WINDOW_DAYS = 28;
export const MAX_VISIT_ROWS = 20_000;

/** Sources that are social networks however GA4 spells them (it reports referrers too: lnkd.in, t.co, l.facebook.com…). */
const NETWORK_SOURCES: [RegExp, string][] = [
  [/^(linkedin|lnkd\.in|linkedin\.com)/, "linkedin"],
  [/^(facebook|fb|m\.facebook\.com|l\.facebook\.com|lm\.facebook\.com|facebook\.com)/, "facebook"],
  [/^(instagram|l\.instagram\.com|instagram\.com)/, "instagram"],
  [/^(x|twitter|t\.co|x\.com|twitter\.com)$/, "x"],
  [/^(threads|threads\.net)/, "threads"],
  [/^(pinterest|pin\.it|pinterest\.com)/, "pinterest"],
  [/^(tiktok|tiktok\.com)/, "tiktok"],
  [/^(youtube|youtube\.com|m\.youtube\.com)/, "youtube"],
  [/^(bluesky|bsky|bsky\.app)/, "bluesky"],
  [/^(reddit|reddit\.com|old\.reddit\.com)/, "reddit"],
  [/^(googlebusiness|google_business)/, "googlebusiness"],
];

/** A source as one network name, or null when it isn't a social network. */
export function networkOfSource(source: string): string | null {
  const s = source.trim().toLowerCase().replace(/^www\./, "");
  for (const [re, name] of NETWORK_SOURCES) if (re.test(s)) return name;
  return null;
}

export type Ga4VisitRow = { dimensions: string[]; metrics: string[] };
export type VisitRow = { page: string; network: string; campaign: string | null; sessions: number; engaged: number };

/**
 * Keep the social rows and merge page spellings (`pageKey`, the sync's urlKey)
 * and source spellings (lnkd.in and linkedin are one network). Pure, for the
 * sync and its check. Dimensions: landingPage, sessionSource, sessionMedium,
 * sessionCampaignName; metrics: sessions, engagedSessions.
 */
export function pickVisitRows(rows: Ga4VisitRow[], pageKey: (raw: string) => string, campaignCodes: ReadonlySet<string>): VisitRow[] {
  const merged = new Map<string, VisitRow>();
  for (const r of rows) {
    const [rawPage, rawSource = "", rawMedium = "", rawCampaign = ""] = r.dimensions;
    if (!rawPage) continue;
    const medium = rawMedium.trim().toLowerCase();
    const code = rawCampaign.trim();
    const campaign = code && code !== "(not set)" && code !== "(direct)" && code !== "(organic)" && code !== "(referral)" ? code : null;
    const network = networkOfSource(rawSource) ?? (medium === "social" ? rawSource.trim().toLowerCase() || "social" : null);
    const ours = campaign != null && campaignCodes.has(campaign.toLowerCase());
    if (!network && !ours) continue;
    const page = pageKey(rawPage);
    const net = network ?? (rawSource.trim().toLowerCase() || "social");
    const k = `${page}\u0000${net}\u0000${campaign?.toLowerCase() ?? ""}`;
    const cur = merged.get(k) ?? { page, network: net, campaign, sessions: 0, engaged: 0 };
    cur.sessions += Number(r.metrics[0] ?? 0) || 0;
    cur.engaged += Number(r.metrics[1] ?? 0) || 0;
    merged.set(k, cur);
  }
  return [...merged.values()].filter((r) => r.sessions > 0);
}

/**
 * Read the window from GA4 and replace the workspace's rows. Called by the
 * analytics sync after its page × date pass; `index` is its urlKey → post.
 */
export async function syncSocialVisits(
  workspaceId: string,
  index: Map<string, string>,
  pageKey: (raw: string) => string,
  fetchRows: (startDate: string, endDate: string) => Promise<Ga4VisitRow[]>,
): Promise<number> {
  const day = 86_400_000;
  // GA4 settles within a day or two; the window ends yesterday.
  const end = new Date(Date.now() - day);
  const start = new Date(end.getTime() - (VISIT_WINDOW_DAYS - 1) * day);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const rows = await fetchRows(ymd(start), ymd(end));
  const campaigns = await db.campaign.findMany({ where: { workspaceId, utmCampaign: { not: null } }, select: { id: true, utmCampaign: true } });
  const byCode = new Map(campaigns.filter((c) => c.utmCampaign?.trim()).map((c) => [c.utmCampaign!.trim().toLowerCase(), c.id]));
  const picked = pickVisitRows(rows, pageKey, new Set(byCode.keys()));
  const windowStart = new Date(`${ymd(start)}T00:00:00Z`);
  const windowEnd = new Date(`${ymd(end)}T00:00:00Z`);
  await db.$transaction([
    db.socialVisit.deleteMany({ where: { workspaceId } }),
    db.socialVisit.createMany({
      data: picked.map((r) => ({
        workspaceId, ...r,
        postId: index.get(r.page) ?? null,
        campaignId: r.campaign ? byCode.get(r.campaign.toLowerCase()) ?? null : null,
        windowStart, windowEnd,
      })),
    }),
  ]);
  return picked.length;
}

export type VisitGroup = { key: string; network: string; campaign: string | null; campaignId: string | null; sessions: number; engaged: number };

/** An article's social visits by network and campaign, most first, with the window. */
export async function visitsForPost(postId: string) {
  const rows = await db.socialVisit.findMany({
    where: { postId },
    orderBy: { sessions: "desc" },
    select: { network: true, campaign: true, campaignId: true, sessions: true, engaged: true, windowStart: true, windowEnd: true, campaignRef: { select: { name: true } } },
  });
  return rows.map((r) => ({ ...r, campaignName: r.campaignRef?.name ?? null }));
}

/** A campaign's visits by landing page (the article when it is one), most first. */
export async function visitsForCampaign(campaignId: string) {
  const rows = await db.socialVisit.findMany({
    where: { campaignId },
    select: { page: true, postId: true, network: true, sessions: true, engaged: true, windowStart: true, windowEnd: true, post: { select: { title: true } } },
  });
  const byPage = new Map<string, { page: string; postId: string | null; title: string | null; sessions: number; engaged: number; networks: Set<string> }>();
  for (const r of rows) {
    const cur = byPage.get(r.page) ?? { page: r.page, postId: r.postId, title: r.post?.title ?? null, sessions: 0, engaged: 0, networks: new Set<string>() };
    cur.sessions += r.sessions;
    cur.engaged += r.engaged;
    cur.networks.add(r.network);
    byPage.set(r.page, cur);
  }
  return {
    window: rows[0] ? { start: rows[0].windowStart, end: rows[0].windowEnd } : null,
    pages: [...byPage.values()].sort((a, b) => b.sessions - a.sessions).map((p) => ({ ...p, networks: [...p.networks].sort() })),
  };
}

/** When the stored window was read, if it ever was. */
export async function visitWindow(workspaceId: string): Promise<{ start: Date; end: Date } | null> {
  const r = await db.socialVisit.findFirst({ where: { workspaceId }, select: { windowStart: true, windowEnd: true } });
  return r ? { start: r.windowStart, end: r.windowEnd } : null;
}
