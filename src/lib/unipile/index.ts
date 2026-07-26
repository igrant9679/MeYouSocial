import { getSetting } from "@/lib/settings";

/**
 * Unipile client — EMAIL ONLY since 2026-07-26.
 *
 * Social publishing, account connection and analytics all moved to Zernio
 * (src/lib/zernio/), because Unipile had dropped networks this product needs —
 * Facebook and Twitter/X among them.
 *
 * This did NOT become dead code, and shouldn't be deleted: Zernio has no email
 * channel, and Railway blocks outbound SMTP (587/465/2525 all time out), so a
 * Unipile-connected mailbox over HTTPS:443 is still the only way real mail
 * leaves this host. Everything below serves `src/lib/email/index.ts`.
 *
 * Multi-tenant fit: the PLATFORM holds one Unipile API key + DSN (Settings
 * `unipile:api_key` / `unipile:dsn`, operator-set, env fallback). Each tenant
 * connects its own mailbox under it via the hosted-auth wizard; the resulting
 * Unipile account_id is stored per workspace (UnipileAccount, kind=email).
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

/** The only providers the wizard is scoped to now — social moved to Zernio. */
export const EMAIL_PROVIDERS = ["GOOGLE", "MICROSOFT", "IMAP"] as const;

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

/**
 * Verify a DSN + API key pair by actually calling Unipile with it.
 *
 * The house pattern (Drive storage, GSC, GA4): credentials are proved before
 * they're stored, and the failure names the fix. Previously these two fields
 * saved unvalidated, so a typo in the DSN looked identical to success and only
 * showed up later as "Post now" mysteriously failing.
 *
 * Takes the candidate config explicitly rather than reading Settings, so it can
 * validate a pasted value BEFORE persisting it.
 */
export async function probeUnipileCredentials(
  dsn: string,
  apiKey: string,
): Promise<{ ok: boolean; message: string; accounts: UnipileAccountInfo[] }> {
  const baseUrl = normalizeDsn(dsn);
  if (!baseUrl) {
    return { ok: false, accounts: [], message: `“${dsn}” isn't a usable DSN. Copy it from dashboard.unipile.com — it looks like api8.unipile.com:13443.` };
  }
  if (!apiKey.trim()) {
    return { ok: false, accounts: [], message: "An API key is required. Create one under Access Tokens in the Unipile dashboard." };
  }

  let res: Response;
  try {
    res = await unipileFetch("/api/v1/accounts?limit=250", { cfg: { baseUrl, apiKey: apiKey.trim() } });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    // Distinguish "host doesn't exist" from "host refused us" — different fixes.
    const hint = /ENOTFOUND|EAI_AGAIN/i.test(detail)
      ? ` The host in the DSN doesn't resolve — check it for typos.`
      : /timeout|abort/i.test(detail)
        ? ` The host didn't respond. Check the port in the DSN (it isn't 443).`
        : "";
    return { ok: false, accounts: [], message: `Couldn't reach ${baseUrl}: ${detail}.${hint}` };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, accounts: [], message: `${baseUrl} rejected that API key (HTTP ${res.status}). The DSN looks reachable, so re-copy the key from Access Tokens.` };
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    return { ok: false, accounts: [], message: `Unipile returned HTTP ${res.status} from ${baseUrl}. ${detail}` };
  }

  const data = (await res.json().catch(() => ({}))) as { items?: Record<string, unknown>[] };
  const accounts = (data.items ?? []).map(normalizeAccount);
  const summary = accounts.length
    ? `Connected. Unipile reports ${accounts.length} account${accounts.length === 1 ? "" : "s"}: ${accounts.map((a) => `${a.type}${a.name ? ` (${a.name})` : ""}`).join(", ")}.`
    : "Connected — the credentials work. Unipile has no accounts on it yet; connect a mailbox or profile below.";
  return { ok: true, accounts, message: summary };
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

// ── Social posting: REMOVED 2026-07-26 ───────────────────────────────────────
// Publishing and post statistics moved to Zernio (src/lib/zernio/), which
// supports the networks this product needs — Unipile had dropped Facebook and
// Twitter/X among others. This client is now EMAIL ONLY; it stays because
// Zernio has no email channel and Railway blocks outbound SMTP.
