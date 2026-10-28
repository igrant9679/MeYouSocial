import { TEXT_PROVIDERS } from "@/lib/llm/models";
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
    // Resolved the way the providers resolve them — the workspace's, the
    // platform's, then the environment (SET-04: env-set keys read "missing").
    getSetting("api_key:tavily", workspaceId).then((v) => v || process.env.TAVILY_API_KEY || "", () => ""),
    getSetting("api_key:serper", workspaceId).then((v) => v || process.env.SERPER_API_KEY || "", () => ""),
    getSetting("api_key:dataforseo", workspaceId).then((v) => v || process.env.DATAFORSEO_AUTH || "", () => ""),
    getSetting("api_key:keywordseverywhere", workspaceId).then((v) => v || process.env.KEYWORDS_EVERYWHERE_API_KEY || "", () => ""),
    getApiKey("elevenlabs", workspaceId).catch(() => ""),
    getApiKey("heygen", workspaceId).catch(() => ""),
    getApiKey("youtube", workspaceId).catch(() => ""),
    resolveImageProviderName(workspaceId).catch(() => "mock"),
    getVideoProviderSetting(workspaceId).catch(() => "auto" as const),
    getSetting("tts:provider", workspaceId).catch(() => ""),
    import("@/lib/storage").then((m) => m.getStorageBackendSetting()).catch(() => "local"),
    db.zernioAccount.count({ where: { workspaceId } }),
    db.zernioAccount.count({ where: { workspaceId, status: "connected" } }),
    db.unipileAccount.count({ where: { workspaceId, status: "connected" } }),
    db.wordPressConnection.findUnique({ where: { workspaceId }, select: { baseUrl: true } }),
    import("@/lib/analytics/gsc").then((m) => m.gscConfigured(workspaceId)).catch(() => false),
    import("@/lib/analytics/ga4").then((m) => m.ga4Configured(workspaceId)).catch(() => false),
    db.channel.count({ where: { workspaceId } }),
    db.channel.count({ where: { workspaceId, linkedYoutubeHandle: { not: null } } }),
  ]);

  // Only the providers the router can write with (SET-04: a stored GPT or
  // DeepSeek key read as "Writing ok" while every call went to the mock).
  const llmOn = llmKeys.filter((k) => k.ok && TEXT_PROVIDERS.includes(k.p)).map((k) => k.p);
  const { providerRefusals } = await import("@/lib/llm/provider-health");
  const refusals = await providerRefusals(workspaceId).catch(() => []);
  const googleKey = llmKeys.some((k) => k.p === "google" && k.ok);
  const rows: ConnRow[] = [
    {
      key: "llm", label: "Writing (LLM keys)", href: "/admin/api-keys",
      state: !llmOn.length ? "missing" : refusals.length ? "partial" : "ok",
      detail: !llmOn.length
        ? "no Claude or Gemini key — every generation falls to the mock and is refused for unattended work"
        : refusals.length
          ? `${llmOn.join(" · ")} — but ${refusals.map((r) => `${r.provider} is refusing calls (${r.kind === "credits" ? "out of credits" : r.kind === "quota" ? "over quota" : "key rejected"})`).join("; ")}`
          : llmOn.join(" · "),
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
      state: gscSite && gaToken ? "ok" : gscSite || gaToken ? "partial" : "missing",
      detail: [gscSite && "Search Console connected", gaToken && "GA4 connected"].filter(Boolean).join(" · ") || "nothing connected — Measure shows dashes",
    },
    {
      key: "storage", label: "Storage", href: "/admin/api-keys",
      // The real backend (it compared the stored value with "drive"; it's "gdrive").
      state: storageRow === "gdrive" ? "ok" : "partial",
      detail: storageRow === "gdrive" ? "Google Drive" : "local disk — files are lost when the server is redeployed",
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
