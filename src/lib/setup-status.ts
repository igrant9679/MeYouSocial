import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { getApiKey, KEY_PROVIDERS } from "@/lib/llm/keys";
import { resolveImageProviderName } from "@/lib/images";
import { getVideoProviderSetting } from "@/lib/video";
import { autonomyStatus } from "@/lib/autonomy";
import { isGloballyPaused } from "@/lib/governance";
import { getQueue, formatInZone } from "@/lib/social/slots";

/**
 * One Settings (One-Loop step 5): the read side. Every dial the loop reads is
 * summarised here under the question it answers, so the Settings overview can
 * say in one sentence what is true, and the Connections tab can list what is
 * connected and what is missing — with the page that fixes it. Read-only;
 * the writes stay with the actions that own them.
 */

export type ConnState = "ok" | "missing" | "partial";
export type ConnRow = { key: string; label: string; state: ConnState; detail: string; href: string; note?: string };

const hasValue = (v: string | null | undefined) => !!(v && v.trim());

export async function connectionRows(workspaceId: string): Promise<ConnRow[]> {
  const [
    llmKeys, tavily, serper, dataforseo, keywordsEverywhere, elevenlabs, heygen, youtube, imageProvider, videoProvider, ttsProvider, storageRow,
    social, socialConnected, mailboxes, wp, gscSite, gaToken, channels, ytChannels,
  ] = await Promise.all([
    Promise.all(KEY_PROVIDERS.map(async (p) => ({ p, ok: hasValue(await getApiKey(p, workspaceId).catch(() => "")) }))),
    getSetting("api_key:tavily", workspaceId).catch(() => ""),
    getSetting("api_key:serper", workspaceId).catch(() => ""),
    getSetting("api_key:dataforseo", workspaceId).catch(() => ""),
    getSetting("api_key:keywordseverywhere", workspaceId).catch(() => ""),
    getSetting("api_key:elevenlabs", workspaceId).catch(() => ""),
    getSetting("api_key:heygen", workspaceId).catch(() => ""),
    getSetting("api_key:youtube", workspaceId).catch(() => ""),
    resolveImageProviderName(workspaceId).catch(() => "mock"),
    getVideoProviderSetting(workspaceId).catch(() => "auto" as const),
    getSetting("tts:provider", workspaceId).catch(() => ""),
    db.setting.findUnique({ where: { key: "storage:backend" }, select: { value: true } }).catch(() => null),
    db.zernioAccount.count({ where: { workspaceId } }),
    db.zernioAccount.count({ where: { workspaceId, status: "connected" } }),
    db.unipileAccount.count({ where: { workspaceId } }),
    db.wordPressConnection.findUnique({ where: { workspaceId }, select: { baseUrl: true } }),
    getSetting("gsc:site_url", workspaceId).catch(() => ""),
    getSetting("ganalytics_oauth:refresh_token", workspaceId).catch(() => ""),
    db.channel.count({ where: { workspaceId } }),
    db.channel.count({ where: { workspaceId, linkedYoutubeHandle: { not: null } } }),
  ]);

  const llmOn = llmKeys.filter((k) => k.ok).map((k) => k.p);
  const googleKey = llmKeys.some((k) => k.p === "google" && k.ok);
  const rows: ConnRow[] = [
    {
      key: "llm", label: "Writing (LLM keys)", href: "/admin/api-keys",
      state: llmOn.length ? "ok" : "missing",
      detail: llmOn.length ? llmOn.join(" · ") : "no key — every generation falls to the mock and is refused for unattended work",
    },
    {
      key: "search", label: "Live web search (citations)", href: "/admin/api-keys",
      state: hasValue(tavily) || hasValue(serper) ? "ok" : "missing",
      detail: [hasValue(tavily) && "Tavily", hasValue(serper) && "Serper"].filter(Boolean).join(" · ") || "no search key — [NEEDS SOURCE] claims cannot be auto-sourced",
    },
    {
      key: "search-data", label: "Keyword volume (search data)", href: "/admin/api-keys",
      state: hasValue(dataforseo) || hasValue(keywordsEverywhere) ? "ok" : "missing",
      detail: [hasValue(dataforseo) && "DataForSEO", hasValue(keywordsEverywhere) && "Keywords Everywhere"].filter(Boolean).join(" · ") || "no search-data key — the keyword strategy shows no volume or competition (optional)",
    },
    {
      key: "images", label: "Images", href: "/admin/api-keys",
      state: imageProvider === "mock" ? "missing" : "ok",
      detail: imageProvider === "mock" ? "resolving to the mock — drafts arrive without real images" : `resolving to ${imageProvider}`,
    },
    {
      key: "video", label: "Video (Veo)", href: "/admin/api-keys",
      state: videoProvider === "mock" || (videoProvider === "auto" && !googleKey) ? "missing" : "ok",
      detail: videoProvider === "mock" ? "set to mock" : googleKey ? `${videoProvider} on the Google key` : "auto, but no Google key — renders would be placeholders",
    },
    {
      key: "voice", label: "Voice (ElevenLabs)", href: "/admin/api-keys",
      state: hasValue(elevenlabs) && ttsProvider !== "mock" ? "ok" : "missing",
      detail: hasValue(elevenlabs) ? (ttsProvider === "mock" ? "key present, provider set to mock" : "key present") : "no key — voiceovers are silent placeholders",
    },
    {
      key: "shorts", label: "Branded shorts (HeyGen)", href: "/admin/api-keys",
      state: hasValue(heygen) ? "ok" : "missing",
      detail: hasValue(heygen) ? "key present" : "no key — the Render branded short button stays off",
    },
    {
      key: "youtube", label: "YouTube Data API", href: "/admin/api-keys",
      state: hasValue(youtube) ? "ok" : "missing",
      detail: hasValue(youtube) ? "platform key present" : "no key — Intel lookups are mocked",
    },
    {
      key: "channels", label: "YouTube channels", href: "/channels",
      state: channels === 0 ? "missing" : ytChannels === channels ? "ok" : "partial",
      detail: channels === 0 ? "no channel — the video studio has nothing to write for" : `${ytChannels} of ${channels} linked to a YouTube handle`,
    },
    {
      key: "social", label: "Social accounts (Zernio)", href: "/admin/connections",
      state: socialConnected > 0 ? (socialConnected === social ? "ok" : "partial") : "missing",
      detail: social === 0 ? "none connected — nothing can be distributed" : `${socialConnected} of ${social} connected`,
    },
    {
      key: "mail", label: "Mailbox (Unipile)", href: "/admin/connections",
      state: mailboxes > 0 ? "ok" : "missing",
      detail: mailboxes > 0 ? `${mailboxes} connected — invitations and digests send for real` : "none — invitations are logged, not delivered (SMTP is blocked on this host)",
    },
    {
      key: "wordpress", label: "Website (WordPress)", href: "/website",
      state: wp ? "ok" : "missing",
      detail: wp ? wp.baseUrl : "not connected — articles park at final approval",
    },
    {
      key: "analytics", label: "Analytics (Search Console + GA4)", href: "/admin/analytics",
      state: hasValue(gscSite) && hasValue(gaToken) ? "ok" : hasValue(gscSite) || hasValue(gaToken) ? "partial" : "missing",
      detail: [hasValue(gscSite) && `Search Console ${gscSite}`, hasValue(gaToken) && "GA4 authorised"].filter(Boolean).join(" · ") || "nothing connected — Measure shows dashes",
    },
    {
      key: "storage", label: "Storage", href: "/admin/api-keys",
      state: "ok",
      detail: storageRow?.value === "drive" ? "Google Drive" : "local disk",
      note: "platform-wide",
    },
  ];
  return rows;
}

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export async function setupOverview(workspaceId: string) {
  const now = new Date();
  const [autonomy, paused, roles, invitations, queue, campaigns, conns, publishDayRaw] = await Promise.all([
    autonomyStatus(workspaceId),
    isGloballyPaused(workspaceId),
    db.membership.groupBy({ by: ["role"], where: { workspaceId, status: "active" }, _count: { _all: true } }),
    db.invitation.count({ where: { workspaceId, acceptedAt: null, expiresAt: { gt: now } } }),
    getQueue(workspaceId),
    db.campaign.count({ where: { workspaceId, status: "active" } }),
    connectionRows(workspaceId),
    getSetting("autopilot:publish_day", workspaceId).catch(() => ""),
  ]);
  const count = (r: string) => roles.find((x) => x.role === r)?._count._all ?? 0;
  const members = { admins: count("ADMIN"), editors: count("EDITOR"), viewers: count("VIEWER") };
  const slotsPerWeek = queue.slots.length;
  const nextFree = queue.free[0] ? formatInZone(queue.free[0].at, queue.timeZone) : null;
  // The raw setting is a Date#getDay digit or "" (any day); the full name, or
  // null, so callers can write "on Wednesdays" / "any day" without guessing.
  const publishDayLabel = /^[0-6]$/.test(publishDayRaw) ? DAY[Number(publishDayRaw)] : null;
  return {
    autonomy, paused, members, invitations,
    schedule: { slotsPerWeek, timeZone: queue.timeZone, timeZoneConfigured: queue.timeZoneConfigured, nextFree, campaigns },
    connections: conns,
    missing: conns.filter((c) => c.state === "missing"),
    publishDayLabel,
  };
}
