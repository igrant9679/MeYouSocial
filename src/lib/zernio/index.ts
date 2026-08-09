import { createHmac, timingSafeEqual } from "node:crypto";
import { getSetting } from "@/lib/settings";

/**
 * Zernio client — social publishing, account connection and analytics.
 *
 * Replaces Unipile for everything social (Unipile had dropped support for
 * networks this product needs, notably Facebook and Twitter/X). Unipile remains
 * wired up for EMAIL only: Zernio has no email channel, and Railway blocks
 * outbound SMTP, so the connected-mailbox path is still the only way real mail
 * leaves this host. See src/lib/email/index.ts.
 *
 * Dependency-free by choice, like `storage/gdrive.ts`, `branded-video/
 * heygen-cloud.ts` and `redis.ts`. There IS an official `@zernio/node` SDK; the
 * handful of endpoints used here are small and fully documented, and keeping
 * the surface hand-written avoids another package in the Next bundle graph.
 *
 * ── Multi-tenancy ───────────────────────────────────────────────────────────
 * Zernio's `profile` is a tenant boundary, which lines up exactly with a
 * workspace. One platform-level team API key serves every workspace; each
 * workspace gets its own profile, and accounts are connected into it. This is a
 * real improvement on the Unipile arrangement, where the workspace mapping was
 * smuggled through the hosted-auth `name` field and had no reconcile path —
 * here `account.connected` delivers `profileId` directly.
 */

const DEFAULT_BASE = "https://zernio.com/api/v1";
const TIMEOUT_MS = 30_000;

export type ZernioConfig = { baseUrl: string; apiKey: string };

/** `sk_` + 64 hex. Checked so an obviously-wrong paste fails with a clear reason. */
export function looksLikeApiKey(key: string): boolean {
  return /^sk_[0-9a-f]{64}$/i.test(key.trim());
}

export async function getZernioConfig(workspaceId?: string | null): Promise<ZernioConfig | null> {
  // ⚠ Was platform-level only ("one team key, many workspace profiles") —
  // Zernio broke that model on 2026-08-05: a key serves exactly ONE Zernio
  // user's accounts, and whichever tenant (re)connected last owned the key's
  // view while the other tenant's sends 403'd ("accounts do not belong to
  // this user"). Keys are per tenant now, like every other credential:
  // WorkspaceSetting → platform Setting → env, via getSetting's normal chain.
  const apiKey = (await getSetting("zernio:api_key", workspaceId)) || process.env.ZERNIO_API_KEY || "";
  if (!apiKey.trim()) return null;
  const baseUrl = (process.env.ZERNIO_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
  return { baseUrl, apiKey: apiKey.trim() };
}

export async function zernioConfigured(workspaceId?: string | null): Promise<boolean> {
  return (await getZernioConfig(workspaceId)) !== null;
}

export class ZernioError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) {
    super(message);
  }
}

type FetchInit = RequestInit & { cfg?: ZernioConfig; requestId?: string; workspaceId?: string | null };

async function zernioFetch(path: string, init: FetchInit = {}): Promise<Response> {
  const cfg = init.cfg ?? (await getZernioConfig(init.workspaceId));
  if (!cfg) {
    throw new ZernioError(
      "Zernio isn't configured — the platform operator must add the API key under Admin → Connections.",
      0,
    );
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${cfg.apiKey}`);
  headers.set("Accept", "application/json");
  // Request-level idempotency (5-minute window): an identical x-request-id
  // returns the ORIGINAL post with HTTP 200 instead of creating a second one.
  if (init.requestId) headers.set("x-request-id", init.requestId);
  return fetch(`${cfg.baseUrl}${path}`, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(TIMEOUT_MS),
  });
}

async function readJsonOrThrow(res: Response, what: string): Promise<unknown> {
  const text = await res.text().catch(() => "");
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* keep raw text below */ }
  if (!res.ok) {
    const detail =
      (body && typeof body === "object" && "message" in body && typeof (body as { message: unknown }).message === "string"
        ? (body as { message: string }).message
        : text.slice(0, 300)) || res.statusText;
    throw new ZernioError(`${what} failed (HTTP ${res.status}): ${detail}`, res.status, body);
  }
  return body;
}

// ── Platforms ────────────────────────────────────────────────────────────────

export type ZernioPlatform = {
  /** The exact slug the API uses, in the connect path and platforms[].platform. */
  slug: string;
  label: string;
  /** Post-text ceiling. These are the PLATFORMS' own published limits, not
   *  Zernio's — its docs don't state them, so treat as best-effort guidance for
   *  the composer's counter rather than something the API enforces. */
  charLimit: number;
  requiresMedia?: boolean;
  color: string;
};

export const ZERNIO_PLATFORMS: ZernioPlatform[] = [
  { slug: "linkedin", label: "LinkedIn", charLimit: 3000, color: "#0A66C2" },
  { slug: "twitter", label: "X (Twitter)", charLimit: 280, color: "#111111" },
  { slug: "facebook", label: "Facebook", charLimit: 63206, color: "#1877F2" },
  { slug: "instagram", label: "Instagram", charLimit: 2200, requiresMedia: true, color: "#E1306C" },
  { slug: "threads", label: "Threads", charLimit: 500, color: "#000000" },
  { slug: "bluesky", label: "Bluesky", charLimit: 300, color: "#0285FF" },
  { slug: "tiktok", label: "TikTok", charLimit: 2200, requiresMedia: true, color: "#010101" },
  { slug: "youtube", label: "YouTube", charLimit: 5000, requiresMedia: true, color: "#FF0000" },
  { slug: "pinterest", label: "Pinterest", charLimit: 500, requiresMedia: true, color: "#E60023" },
  { slug: "reddit", label: "Reddit", charLimit: 40000, color: "#FF4500" },
  { slug: "googlebusiness", label: "Google Business", charLimit: 1500, color: "#4285F4" },
  { slug: "telegram", label: "Telegram", charLimit: 4096, color: "#26A5E4" },
  { slug: "snapchat", label: "Snapchat", charLimit: 250, requiresMedia: true, color: "#FFFC00" },
  { slug: "whatsapp", label: "WhatsApp", charLimit: 4096, color: "#25D366" },
  { slug: "discord", label: "Discord", charLimit: 2000, color: "#5865F2" },
];

export function platformFor(slug: string): ZernioPlatform | undefined {
  return ZERNIO_PLATFORMS.find((p) => p.slug === slug.toLowerCase());
}

// ── Profiles (one per workspace) ─────────────────────────────────────────────

export type ZernioProfile = { id: string; name: string };

function profileOf(raw: Record<string, unknown>): ZernioProfile {
  return { id: String(raw._id ?? raw.id ?? ""), name: String(raw.name ?? "") };
}

export async function createZernioProfile(name: string, description?: string, workspaceId?: string | null): Promise<ZernioProfile> {
  const res = await zernioFetch("/profiles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, description }),
    workspaceId,
  });
  const body = (await readJsonOrThrow(res, "Creating a Zernio profile")) as Record<string, unknown>;
  // Documented as `profile._id`; accept a bare object too rather than break on
  // an envelope change.
  const raw = (body.profile ?? body) as Record<string, unknown>;
  return profileOf(raw);
}

export async function listZernioProfiles(workspaceId?: string | null): Promise<ZernioProfile[]> {
  const res = await zernioFetch("/profiles", { workspaceId });
  const body = (await readJsonOrThrow(res, "Listing Zernio profiles")) as Record<string, unknown>;
  const items = (body.profiles ?? body.items ?? body.data ?? []) as Record<string, unknown>[];
  return Array.isArray(items) ? items.map(profileOf) : [];
}

/**
 * GET a Zernio path and return parsed JSON — or null when the path isn't a
 * route at all.
 *
 * ⚠ Zernio serves its marketing site from the same origin, and its catch-all
 * answers **HTTP 200 with text/html** for any API path it doesn't recognise.
 * `/comments`, `/inbox`, `/mentions` and `/engagements` all "succeed" that way
 * and none of them exist. A status check would call every one of them working,
 * so the CONTENT-TYPE is the only reliable evidence a route is real. Callers
 * treat null as "unsupported", which is a different answer from "empty".
 */
export async function zernioJson(
  path: string,
  workspaceId?: string | null,
): Promise<Record<string, unknown> | null> {
  const res = await zernioFetch(path, { workspaceId });
  if (!(res.headers.get("content-type") ?? "").includes("json")) return null;
  return (await readJsonOrThrow(res, `Reading ${path.split("?")[0]}`)) as Record<string, unknown>;
}

/**
 * DELETE at Zernio.
 *
 * Throws on a non-JSON reply for the same reason `zernioSend` does — the
 * marketing-site catch-all answers 200 for any unrouted path, so a silent
 * "success" would let the UI report a comment removed that is still on the
 * page.
 */
export async function zernioDelete(
  path: string,
  workspaceId?: string | null,
): Promise<Record<string, unknown>> {
  const res = await zernioFetch(path, { method: "DELETE", workspaceId });
  if (!(res.headers.get("content-type") ?? "").includes("json")) {
    throw new ZernioError(
      `Zernio has no endpoint at ${path.split("?")[0]} (it answered with its website, not JSON).`,
      res.status,
    );
  }
  return (await readJsonOrThrow(res, `Deleting via ${path.split("?")[0]}`)) as Record<string, unknown>;
}

/**
 * POST JSON to Zernio and return the parsed reply.
 *
 * Unlike `zernioJson` this THROWS when the path isn't a route: a write that
 * quietly did nothing is far worse than one that fails loudly — the caller is
 * about to tell someone their message was sent.
 */
export async function zernioSend(
  path: string,
  body: Record<string, unknown>,
  workspaceId?: string | null,
): Promise<Record<string, unknown>> {
  const res = await zernioFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    workspaceId,
  });
  if (!(res.headers.get("content-type") ?? "").includes("json")) {
    throw new ZernioError(
      `Zernio has no endpoint at ${path.split("?")[0]} (it answered with its website, not JSON).`,
      res.status,
    );
  }
  return (await readJsonOrThrow(res, `Sending to ${path.split("?")[0]}`)) as Record<string, unknown>;
}

// ── Accounts ─────────────────────────────────────────────────────────────────

export type ZernioAccountInfo = {
  id: string;
  platform: string;
  username: string | null;
  displayName: string | null;
  profileUrl: string | null;
  profileId: string | null;
  isActive: boolean;
  // ── Health ────────────────────────────────────────────────────────────────
  /** Zernio's own verdict: this account can't publish until someone re-auths. */
  needsReconnection: boolean;
  /** "active", or whatever the network last reported. */
  platformStatus: string | null;
  /** The network's own words for why, when it gives any. */
  platformStatusReason: string | null;
  /**
   * ⚠ Informational ONLY — never alert on this alone. X and YouTube hand out
   * short-lived access tokens that Zernio refreshes; probed 2026-08-08, four
   * accounts sat 15–70 minutes from expiry in perfect health. Alerting on
   * imminent expiry means alerting hourly about nothing.
   */
  tokenExpiresAt: Date | null;
  /** Set when a human disconnected it deliberately — news, not a fault. */
  intentionalDisconnectAt: Date | null;
};

/** Parse an ISO date that may be absent, null, or unparseable. */
function dateOrNull(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function accountOf(raw: Record<string, unknown>): ZernioAccountInfo {
  // profileId is documented as an OBJECT ({_id,name,slug}) when populated, but
  // a bare id string is the obvious alternative; accept both.
  const p = raw.profileId as { _id?: string } | string | undefined;
  return {
    id: String(raw._id ?? raw.id ?? ""),
    platform: String(raw.platform ?? "").toLowerCase(),
    username: (raw.username as string) ?? null,
    displayName: (raw.displayName as string) ?? null,
    profileUrl: (raw.profileUrl as string) ?? null,
    profileId: typeof p === "string" ? p : (p?._id ?? null),
    isActive: raw.isActive !== false,
    needsReconnection: raw.needsReconnection === true,
    platformStatus: (raw.platformStatus as string) ?? null,
    platformStatusReason: (raw.platformStatusReason as string) ?? null,
    tokenExpiresAt: dateOrNull(raw.tokenExpiresAt),
    intentionalDisconnectAt: dateOrNull(raw.intentionalDisconnectAt),
  };
}

export async function listZernioAccounts(opts: { profileId?: string; cfg?: ZernioConfig; workspaceId?: string | null } = {}): Promise<ZernioAccountInfo[]> {
  // ⚠ Zernio's API rejects `limit` without `page` ("page and limit must be
  // provided together", HTTP 400 — surfaced 2026-08-04; the old limit-only
  // call worked before). That 400 also silently broke REPLACING the API key:
  // the save-time probe runs through this listing, so the probe failed, the
  // save refused, and the old key stayed put — which read as a display bug.
  const PAGE_SIZE = 100;
  const out: ZernioAccountInfo[] = [];
  for (let page = 1; page <= 10; page++) {
    const qs = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (opts.profileId) qs.set("profileId", opts.profileId);
    const res = await zernioFetch(`/accounts?${qs}`, { cfg: opts.cfg, workspaceId: opts.workspaceId });
    const body = (await readJsonOrThrow(res, "Listing Zernio accounts")) as Record<string, unknown>;
    const items = (body.accounts ?? body.items ?? body.data ?? []) as Record<string, unknown>[];
    if (!Array.isArray(items) || items.length === 0) break;
    out.push(...items.map(accountOf));
    if (items.length < PAGE_SIZE) break;
  }
  return out;
}

/**
 * Start the OAuth flow for one platform, scoped to a workspace's profile.
 * Returns the URL to send the admin to.
 */
export async function zernioConnectLink(opts: {
  platform: string;
  profileId: string;
  redirectUrl: string;
  workspaceId?: string | null;
}): Promise<string> {
  const qs = new URLSearchParams({ profileId: opts.profileId, redirect_url: opts.redirectUrl });
  const res = await zernioFetch(`/connect/${encodeURIComponent(opts.platform)}?${qs}`, { workspaceId: opts.workspaceId });
  const body = (await readJsonOrThrow(res, "Starting the connection")) as Record<string, unknown>;
  const url = (body.authUrl ?? body.url ?? body.redirectUrl) as string | undefined;
  if (!url) throw new ZernioError("Zernio didn't return an authUrl to redirect to.", 0, body);
  return url;
}

// ── Media ────────────────────────────────────────────────────────────────────

/**
 * Upload bytes and return the public URL to attach to a post.
 *
 * Two hops by design on Zernio's side: presign, then PUT straight to storage.
 * Note their 7-day expiry on temporary storage — media is copied to permanent
 * storage only when a post using it publishes, so a draft left for longer than
 * a week can lose its image. Scheduling far ahead is the risk case.
 */
export async function uploadZernioMedia(opts: {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
  workspaceId?: string | null;
}): Promise<string> {
  const res = await zernioFetch("/media/presign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: opts.filename, contentType: opts.contentType }),
    workspaceId: opts.workspaceId,
  });
  const body = (await readJsonOrThrow(res, "Requesting a media upload URL")) as Record<string, unknown>;
  const uploadUrl = String(body.uploadUrl ?? "");
  const publicUrl = String(body.publicUrl ?? "");
  if (!uploadUrl || !publicUrl) throw new ZernioError("Zernio's presign reply had no upload/public URL.", 0, body);

  // Straight to object storage — NOT through zernioFetch: this URL is already
  // signed, and sending our API key to a storage host would leak it.
  const put = await fetch(uploadUrl, {
    method: "PUT",
    body: new Blob([new Uint8Array(opts.bytes)], { type: opts.contentType }),
    headers: { "content-type": opts.contentType },
    signal: AbortSignal.timeout(120_000),
  });
  if (!put.ok) {
    throw new ZernioError(`Uploading media failed (HTTP ${put.status}).`, put.status);
  }
  return publicUrl;
}

// ── Posts ────────────────────────────────────────────────────────────────────

export type ZernioMediaItem = { url: string; type: "image" | "video" | "document" };

export type ZernioPostTargetSpec = {
  platform: string;
  accountId: string;
  /** Per-network text/media override. */
  content?: string;
  customMedia?: ZernioMediaItem[];
  /**
   * Per-network options — `{ contentType: "story" | "reel" }` and friends.
   * ⚠ The shape is a `oneOf` chosen by `platform`, and Zernio STORES UNKNOWN
   * KEYS HERE WITHOUT COMPLAINT: a probe sent `postType: "reel"` and got it
   * echoed back intact while doing nothing. Build it through
   * `social/sub-formats.ts`, which only emits documented fields.
   */
  platformSpecificData?: Record<string, unknown>;
};

export type ZernioPostResult = {
  postId: string;
  status: string;
  perPlatform: { platform: string; accountId: string | null; status: string; url: string | null; error: string | null }[];
  /** True when Zernio returned an existing post rather than creating one. */
  deduped: boolean;
};

function resultOf(body: Record<string, unknown>, deduped: boolean): ZernioPostResult {
  const post = (body.post ?? body) as Record<string, unknown>;
  const platforms = (post.platforms ?? []) as Record<string, unknown>[];
  return {
    postId: String(post._id ?? post.id ?? ""),
    status: String(post.status ?? "unknown"),
    deduped,
    perPlatform: (Array.isArray(platforms) ? platforms : []).map((p) => ({
      platform: String(p.platform ?? "").toLowerCase(),
      accountId: (p.accountId as string) ?? null,
      status: String(p.status ?? "unknown"),
      url: (p.platformPostUrl as string) ?? null,
      error: (p.errorMessage as string) ?? (p.error as string) ?? null,
    })),
  };
}

/**
 * Create a post — publish now, schedule, or save as a draft.
 *
 * `requestId` engages Zernio's request-level idempotency. Passing a STABLE id
 * derived from what we're sending means a retry (or a duplicate sweep that
 * slipped past the scheduler lock) returns the original post instead of posting
 * twice to someone's real audience. Their content-hash guard is a second net:
 * an identical post to the same account inside 24h comes back 409 with
 * `existingPostId`, which we treat as success — because it means the content
 * IS already published, which is exactly the outcome we wanted.
 */
export async function createZernioPost(opts: {
  content: string;
  platforms: ZernioPostTargetSpec[];
  mediaItems?: ZernioMediaItem[];
  publishNow?: boolean;
  scheduledFor?: Date;
  isDraft?: boolean;
  timezone?: string;
  requestId?: string;
  /**
   * ⚠ Required in practice since ~2026-08-05: Zernio resolves the KEY'S
   * DEFAULT profile when this is absent and then 403s ("accounts do not
   * belong") for any account of another profile — which broke every LSI send
   * once a second profile existed. Always pass the workspace's profile.
   */
  profileId?: string;
  /** Resolves the workspace's own API key (falling back to the platform key). */
  workspaceId?: string | null;
}): Promise<ZernioPostResult> {
  const payload: Record<string, unknown> = {
    content: opts.content,
    ...(opts.profileId ? { profileId: opts.profileId } : {}),
    platforms: opts.platforms.map((p) => ({
      platform: p.platform,
      accountId: p.accountId,
      // ⚠ The per-platform text override is `customContent`, NOT `content` —
      // it pairs with `customMedia`. Zernio accepts unknown keys SILENTLY, so
      // sending `content` here published the base text every time while the
      // API returned a clean 201: UTM tags never reached a network (four
      // sessions of "why is this untagged?"), and per-network variants —
      // manual overrides AND the AI tailoring — were dropped on the floor.
      // Proven 2026-08-08 by a draft probe: of content / customContent / text
      // / platformContent sent together, only customContent came back stored.
      ...(p.content ? { customContent: p.content } : {}),
      ...(p.customMedia?.length ? { customMedia: p.customMedia } : {}),
      ...(p.platformSpecificData ? { platformSpecificData: p.platformSpecificData } : {}),
    })),
  };
  if (opts.mediaItems?.length) payload.mediaItems = opts.mediaItems;
  if (opts.publishNow) payload.publishNow = true;
  else if (opts.scheduledFor) {
    payload.scheduledFor = opts.scheduledFor.toISOString();
    payload.timezone = opts.timezone ?? "UTC";
  } else payload.isDraft = true;

  const res = await zernioFetch("/posts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    requestId: opts.requestId,
    workspaceId: opts.workspaceId,
  });

  if (res.status === 409) {
    // Content-hash duplicate: already posted. Report the existing id rather
    // than raising — retrying forever on a "you already did this" is worse.
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const existing = String(body.existingPostId ?? body.postId ?? "");
    if (existing) {
      return { postId: existing, status: "published", deduped: true, perPlatform: [] };
    }
  }
  const body = (await readJsonOrThrow(res, "Creating the post")) as Record<string, unknown>;
  // 200 (rather than 201) means the x-request-id matched an earlier call.
  return resultOf(body, res.status === 200);
}

// ── Analytics ────────────────────────────────────────────────────────────────

/** Zernio's per-post metric block. All fields optional — a platform reports
 *  what it reports, and a missing figure must stay unknown rather than zero. */
export type ZernioMetrics = {
  impressions?: number; reach?: number; likes?: number; comments?: number;
  shares?: number; saves?: number; clicks?: number; views?: number; follows?: number;
  engagementRate?: number; lastUpdated?: string;
};

export type ZernioAnalyticsRow = {
  postId: string;
  status: string;
  publishedAt: string | null;
  perPlatform: {
    platform: string;
    accountId: string | null;
    platformPostId: string | null;
    platformPostUrl: string | null;
    syncStatus: string | null;
    metrics: ZernioMetrics;
  }[];
};

function metricsOf(raw: unknown): ZernioMetrics {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
  return {
    impressions: num(r.impressions), reach: num(r.reach), likes: num(r.likes),
    comments: num(r.comments), shares: num(r.shares), saves: num(r.saves),
    clicks: num(r.clicks), views: num(r.views), follows: num(r.follows),
    engagementRate: num(r.engagementRate),
    lastUpdated: typeof r.lastUpdated === "string" ? r.lastUpdated : undefined,
  };
}

/**
 * Pull analytics. Numbers are CUMULATIVE LIFETIME totals per post — Zernio's
 * docs are explicit about this, and it's why SocialSnapshot aggregates
 * latest-per-target instead of summing days. `lastUpdated` reflects Zernio's
 * own sync, which trails the platform (~24h on Instagram).
 */
export async function getZernioAnalytics(opts: {
  profileId?: string;
  accountId?: string;
  postId?: string;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  page?: number;
  workspaceId?: string | null;
}): Promise<ZernioAnalyticsRow[]> {
  const qs = new URLSearchParams();
  if (opts.profileId) qs.set("profileId", opts.profileId);
  if (opts.accountId) qs.set("accountId", opts.accountId);
  if (opts.postId) qs.set("postId", opts.postId);
  // ⚠ CALENDAR DATES ONLY. A full ISO 8601 timestamp is rejected outright —
  // `{"error":"Invalid ISO date","param":"fromDate"}`, HTTP 400 — despite the
  // message asking for exactly what we were sending. Proven 2026-08-08 by
  // trying all five plausible encodings against the live key: only YYYY-MM-DD
  // returns 200 (full ISO, ISO-without-millis, epoch ms and epoch seconds all
  // 400). This single line meant engagement sync had NEVER once succeeded.
  if (opts.fromDate) qs.set("fromDate", ymd(opts.fromDate));
  if (opts.toDate) qs.set("toDate", ymd(opts.toDate));
  qs.set("limit", String(Math.min(100, Math.max(1, opts.limit ?? 100))));
  if (opts.page) qs.set("page", String(opts.page));

  const res = await zernioFetch(`/analytics?${qs}`, { workspaceId: opts.workspaceId });
  const body = (await readJsonOrThrow(res, "Fetching analytics")) as Record<string, unknown>;
  // ⚠ The rows live under `posts`. The previous key list (analytics/data/items/
  // results) matched nothing in the real payload, so even a request that got a
  // 200 parsed to zero rows — a second, independent reason this never worked.
  // The alternatives are kept as fallbacks in case the shape shifts again.
  const rows = (body.posts ?? body.analytics ?? body.data ?? body.items ?? body.results ?? []) as unknown;
  const list = Array.isArray(rows) ? rows : Array.isArray(body) ? body : [];
  return (list as Record<string, unknown>[]).map((r) => {
    // `platforms` is the real per-network array; `platformAnalytics` was a guess.
    const per = (r.platforms ?? r.platformAnalytics ?? []) as Record<string, unknown>[];
    return {
      // ⚠ `_id` here is the ANALYTICS row's id, not the post's — matching on it
      // finds nothing. `latePostId` carries the id we stored as providerPostId.
      postId: String(r.latePostId ?? r.postId ?? r._id ?? ""),
      status: String(r.status ?? ""),
      publishedAt: typeof r.publishedAt === "string" ? r.publishedAt : null,
      perPlatform: (Array.isArray(per) ? per : []).map((p) => ({
        platform: String(p.platform ?? "").toLowerCase(),
        accountId: (p.accountId as string) ?? null,
        platformPostId: (p.platformPostId as string) ?? null,
        platformPostUrl: (p.platformPostUrl as string) ?? null,
        syncStatus: (p.syncStatus as string) ?? null,
        metrics: metricsOf(p.analytics),
      })),
    };
  });
}

/** Zernio's analytics window wants a calendar date, not an instant. */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── Credential probe ─────────────────────────────────────────────────────────

/**
 * Verify an API key by calling Zernio with it, before it's stored.
 *
 * Same house pattern as Drive storage / GSC / GA4 — and the lesson from the
 * Unipile card, which saved unvalidated and so turned a typo into a mystery
 * failure somewhere else entirely.
 */
export async function probeZernioCredentials(
  apiKey: string,
): Promise<{ ok: boolean; message: string; accounts: ZernioAccountInfo[] }> {
  const key = apiKey.trim();
  if (!key) return { ok: false, accounts: [], message: "Paste the API key from your Zernio dashboard." };
  if (!looksLikeApiKey(key)) {
    return {
      ok: false,
      accounts: [],
      message: `That doesn't look like a Zernio key — they start with “sk_” followed by 64 hex characters (got ${key.length} characters).`,
    };
  }
  const baseUrl = (process.env.ZERNIO_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
  try {
    const accounts = await listZernioAccounts({ cfg: { baseUrl, apiKey: key } });
    return {
      ok: true,
      accounts,
      message: accounts.length
        ? `Connected. Zernio reports ${accounts.length} account${accounts.length === 1 ? "" : "s"}: ${accounts.map((a) => `${a.platform}${a.username ? ` (${a.username})` : ""}`).join(", ")}.`
        : "Connected — the key works. No social accounts on it yet; connect one below.",
    };
  } catch (e) {
    if (e instanceof ZernioError && (e.status === 401 || e.status === 403)) {
      return { ok: false, accounts: [], message: `Zernio rejected that key (HTTP ${e.status}). Re-copy it from your dashboard.` };
    }
    return { ok: false, accounts: [], message: e instanceof Error ? e.message : String(e) };
  }
}

// ── Webhooks ─────────────────────────────────────────────────────────────────

/**
 * Verify `X-Zernio-Signature`: lowercase hex HMAC-SHA256 of the RAW body.
 *
 * Must be given the raw text, not a re-serialised object — re-encoding JSON
 * changes bytes and the digest with it. Compared in constant time.
 */
export function verifyZernioSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const given = signature.trim().toLowerCase().replace(/^sha256=/, "");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
