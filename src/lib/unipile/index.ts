import { getSetting } from "@/lib/settings";

/**
 * Unipile client — one HTTPS API that connects end-users' mailboxes and social
 * profiles and sends/posts on their behalf. This is how MeYouSocial delivers
 * email at all: Railway blocks outbound SMTP, but Unipile posts over HTTPS:443.
 *
 * Multi-tenant fit: the PLATFORM holds one Unipile API key + DSN (Settings
 * `unipile:api_key` / `unipile:dsn`, operator-set, env fallback). Each tenant
 * connects its own mailbox/social accounts under it via the hosted-auth wizard;
 * the resulting Unipile account_id is stored per workspace (UnipileAccount).
 *
 * DSN = the dedicated host:port from the Unipile dashboard, e.g.
 * `api8.unipile.com:13443`. Base URL is `https://<dsn>`, endpoints under
 * `/api/v1`. Auth header is `X-API-KEY`.
 */

export type UnipileConfig = { baseUrl: string; apiKey: string };

/** Normalize a pasted DSN (`host:port`, or a full URL) to `https://host:port`. */
export function normalizeDsn(raw: string): string | null {
  const s = raw.trim().replace(/\/+$/, "");
  if (!s) return null;
  const withProto = /^https?:\/\//.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withProto);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export async function getUnipileConfig(): Promise<UnipileConfig | null> {
  // Platform-level: no workspace scoping (one Unipile account serves all tenants).
  let dsn = await getSetting("unipile:dsn");
  let apiKey = await getSetting("unipile:api_key");
  if (!dsn) dsn = process.env.UNIPILE_DSN ?? "";
  if (!apiKey) apiKey = process.env.UNIPILE_API_KEY ?? "";
  const baseUrl = dsn ? normalizeDsn(dsn) : null;
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}

export async function unipileConfigured(): Promise<boolean> {
  return (await getUnipileConfig()) !== null;
}

function requireConfig(cfg: UnipileConfig | null): UnipileConfig {
  if (!cfg) throw new Error("Unipile is not configured — the platform operator must set the DSN + API key under Admin → API keys → Unipile.");
  return cfg;
}

async function unipileFetch(path: string, init: RequestInit & { cfg?: UnipileConfig } = {}): Promise<Response> {
  const cfg = requireConfig(init.cfg ?? (await getUnipileConfig()));
  const headers = new Headers(init.headers);
  headers.set("X-API-KEY", cfg.apiKey);
  headers.set("accept", "application/json");
  return fetch(`${cfg.baseUrl}${path}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(30_000) });
}

// ── Email address shape ──────────────────────────────────────────────────────
export type EmailRecipient = { display_name?: string; identifier: string };

// ── Hosted auth wizard ───────────────────────────────────────────────────────

/** Provider groups the wizard can be scoped to. */
export const EMAIL_PROVIDERS = ["GOOGLE", "MICROSOFT", "IMAP"] as const;
export const SOCIAL_PROVIDERS = ["LINKEDIN", "INSTAGRAM", "X", "WHATSAPP", "TELEGRAM"] as const;

/**
 * Create a hosted-auth wizard link. The user visits it to connect an account;
 * on success Unipile POSTs `{ status:"CREATION_SUCCESS", account_id, name }` to
 * notifyUrl — we pass name=<workspaceId>:<nonce> so the webhook maps the new
 * account to the right company.
 */
export async function hostedAuthLink(opts: {
  providers: readonly string[];
  name: string;
  notifyUrl: string;
  successUrl: string;
  failureUrl: string;
  expiresMinutes?: number;
}): Promise<string> {
  const cfg = requireConfig(await getUnipileConfig());
  const expiresOn = new Date(Date.now() + (opts.expiresMinutes ?? 30) * 60_000).toISOString();
  const res = await unipileFetch("/api/v1/hosted/accounts/link", {
    cfg,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "create",
      providers: opts.providers,
      api_url: cfg.baseUrl,
      expiresOn,
      name: opts.name,
      notify_url: opts.notifyUrl,
      success_redirect_url: opts.successUrl,
      failure_redirect_url: opts.failureUrl,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Unipile hosted-auth link failed (HTTP ${res.status}): ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { url?: string };
  if (!data.url) throw new Error("Unipile returned no hosted-auth url");
  return data.url;
}

// ── Accounts ─────────────────────────────────────────────────────────────────

export type UnipileAccountInfo = { id: string; type: string; name: string | null };

/** Fetch one account's details (type + display name) by id. Null if unknown. */
export async function getUnipileAccount(accountId: string): Promise<UnipileAccountInfo | null> {
  try {
    const res = await unipileFetch(`/api/v1/accounts/${encodeURIComponent(accountId)}`);
    if (!res.ok) return null;
    const a = (await res.json()) as Record<string, unknown>;
    return normalizeAccount(a);
  } catch {
    return null;
  }
}

export async function listUnipileAccounts(): Promise<UnipileAccountInfo[]> {
  try {
    const res = await unipileFetch(`/api/v1/accounts?limit=250`);
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: Record<string, unknown>[] };
    return (data.items ?? []).map(normalizeAccount);
  } catch {
    return [];
  }
}

// Unipile account objects vary by provider; pull the id/type/name defensively.
function normalizeAccount(a: Record<string, unknown>): UnipileAccountInfo {
  const id = String(a.id ?? a.account_id ?? "");
  const type = String(a.type ?? a.provider ?? "").toUpperCase();
  const name =
    (a.name as string) ??
    ((a.connection_params as { mail?: { username?: string } } | undefined)?.mail?.username) ??
    (a.username as string) ??
    null;
  return { id, type, name: name ?? null };
}

/** Email account types Unipile reports (used to classify email vs social). */
const EMAIL_TYPES = new Set(["GOOGLE", "GMAIL", "OUTLOOK", "MICROSOFT", "MAIL", "IMAP", "EXCHANGE"]);
export function classifyAccount(type: string): { kind: "email" | "social"; provider: string } {
  const t = type.toUpperCase();
  return { kind: EMAIL_TYPES.has(t) ? "email" : "social", provider: t };
}

// ── Send email ───────────────────────────────────────────────────────────────

/**
 * Send an email through a connected account. `body` is HTML by default (Unipile
 * infers from content). Returns the provider/Unipile message id.
 */
export async function sendEmailViaUnipile(opts: {
  accountId: string;
  to: EmailRecipient[];
  subject: string;
  html: string;
  cc?: EmailRecipient[];
  bcc?: EmailRecipient[];
}): Promise<string> {
  const form = new FormData();
  form.append("account_id", opts.accountId);
  form.append("subject", opts.subject);
  form.append("body", opts.html);
  form.append("to", JSON.stringify(opts.to));
  if (opts.cc?.length) form.append("cc", JSON.stringify(opts.cc));
  if (opts.bcc?.length) form.append("bcc", JSON.stringify(opts.bcc));
  const res = await unipileFetch("/api/v1/emails", { method: "POST", body: form });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Unipile send failed (HTTP ${res.status}): ${detail.slice(0, 200)}`);
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string; message_id?: string };
  return data.id ?? data.message_id ?? "sent";
}

// ── Social posting ───────────────────────────────────────────────────────────

/** Publish a text post from a connected social account. Returns the post id. */
export async function createPostViaUnipile(opts: {
  accountId: string;
  text: string;
}): Promise<string> {
  const form = new FormData();
  form.append("account_id", opts.accountId);
  form.append("text", opts.text);
  const res = await unipileFetch("/api/v1/posts", { method: "POST", body: form });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Unipile post failed (HTTP ${res.status}): ${detail.slice(0, 200)}`);
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string; post_id?: string };
  return data.id ?? data.post_id ?? "posted";
}
