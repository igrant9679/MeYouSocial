import { getSetting, setWorkspaceSetting } from "@/lib/settings";
import { encryptSecret, decryptSecret, type Encrypted } from "@/lib/blog-crypto";
import { parseServiceAccount, googleAccessToken, type ServiceAccount } from "@/lib/google/service-account";

/**
 * "Sign in with Google" for the analytics connectors (per workspace).
 *
 * Search Console and GA4 accept a service account, but creating one per tenant
 * is real Cloud Console work. OAuth lets a workspace admin connect the
 * company's own Google account instead — the same consent pattern as the
 * YouTube and Drive connects. One consent covers BOTH connectors (webmasters +
 * analytics read scopes), plus the email scope so the UI can name the account.
 *
 * The OAuth client is the workspace's existing Google client: the
 * `youtube_oauth:client_id/secret` rows. The key name is historical — it is
 * the workspace's Google OAuth client, shared by every Google consent flow —
 * and renaming settings keys in place isn't worth stranding stored values.
 *
 * The refresh token is long-lived, so it is stored AES-GCM encrypted
 * (blog-crypto / TOKEN_ENCRYPTION_KEY), never in the clear.
 */

export const ANALYTICS_SCOPES = [
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

async function getOauthClient(workspaceId?: string | null): Promise<{ clientId: string; clientSecret: string } | null> {
  const [clientId, clientSecret] = await Promise.all([
    getSetting("youtube_oauth:client_id", workspaceId).catch(() => ""),
    getSetting("youtube_oauth:client_secret", workspaceId).catch(() => ""),
  ]);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** The redirect URI to register in Google Cloud Console (alongside YouTube's). */
export function analyticsRedirectUri(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/api/oauth/google-analytics/callback`;
}

/**
 * Build the consent URL. `state` carries the workspace id (the callback
 * re-checks it against the signed-in admin's workspace). access_type=offline +
 * prompt=consent is what makes Google return a REFRESH token.
 */
export async function buildAnalyticsAuthUrl(workspaceId: string, origin: string): Promise<string | null> {
  const cfg = await getOauthClient(workspaceId);
  if (!cfg) return null;
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: analyticsRedirectUri(origin),
    response_type: "code",
    scope: ANALYTICS_SCOPES,
    access_type: "offline",
    prompt: "consent",
    // ⚠ No include_granted_scopes — see the same note in youtube/oauth.ts:
    // merged prior grants (drive.file, youtube.*) make Google reject the
    // request outright once other consents exist on this project.
    state: workspaceId,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok) {
    throw new Error(json.error_description || json.error || `Token exchange failed (HTTP ${res.status})`);
  }
  return json;
}

/** Exchange the consent code for tokens and store the refresh token encrypted. */
export async function exchangeAnalyticsCode(workspaceId: string, code: string, origin: string): Promise<{ ok: boolean; message: string }> {
  const cfg = await getOauthClient(workspaceId);
  if (!cfg) return { ok: false, message: "Save a Google OAuth client ID and secret first." };
  try {
    const tokens = await tokenRequest({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: analyticsRedirectUri(origin),
      grant_type: "authorization_code",
    });
    if (!tokens.refresh_token) {
      return {
        ok: false,
        message: "Google returned no refresh token. Remove this app at myaccount.google.com/permissions and connect again.",
      };
    }
    await setWorkspaceSetting(workspaceId, "ganalytics_oauth:refresh_token", JSON.stringify(encryptSecret(tokens.refresh_token)));

    // Name the account so the UI can say whose credential is in use.
    let account = "";
    if (tokens.access_token) {
      try {
        const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { authorization: `Bearer ${tokens.access_token}` },
          signal: AbortSignal.timeout(30_000),
        });
        const data = (await res.json()) as { email?: string };
        account = data.email ?? "";
      } catch {
        // naming is cosmetic — the token is what matters
      }
    }
    await setWorkspaceSetting(workspaceId, "ganalytics_oauth:account", account);
    oauthTokenCache.delete(workspaceId);
    return { ok: true, message: account ? `Connected Google account ${account}.` : "Google account connected." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message.slice(0, 300) : "Connection failed" };
  }
}

export async function analyticsOauthConnected(workspaceId?: string | null): Promise<{ connected: boolean; account: string }> {
  const [token, account] = await Promise.all([
    getSetting("ganalytics_oauth:refresh_token", workspaceId).catch(() => ""),
    getSetting("ganalytics_oauth:account", workspaceId).catch(() => ""),
  ]);
  return { connected: Boolean(token), account: account ?? "" };
}

// Access tokens live an hour; the sync queries GSC and GA4 back to back, so a
// short per-workspace cache saves a refresh-grant round trip per call site.
const oauthTokenCache = new Map<string, { token: string; expires: number }>();

/** A fresh access token from the stored refresh token, or null when not connected. */
export async function analyticsOauthAccessToken(workspaceId: string): Promise<string | null> {
  const hit = oauthTokenCache.get(workspaceId);
  if (hit && hit.expires > Date.now()) return hit.token;

  const [cfg, stored] = await Promise.all([
    getOauthClient(workspaceId),
    getSetting("ganalytics_oauth:refresh_token", workspaceId).catch(() => ""),
  ]);
  if (!cfg || !stored) return null;
  let refreshToken: string;
  try {
    refreshToken = decryptSecret(JSON.parse(stored) as Encrypted);
  } catch {
    return null; // key rotated or row corrupt — the UI will show disconnected
  }
  try {
    const tokens = await tokenRequest({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
    if (!tokens.access_token) return null;
    const ttlMs = Math.max(60, (tokens.expires_in ?? 3600) - 60) * 1000;
    oauthTokenCache.set(workspaceId, { token: tokens.access_token, expires: Date.now() + ttlMs });
    return tokens.access_token;
  } catch {
    return null;
  }
}

export async function disconnectAnalyticsOauth(workspaceId: string): Promise<void> {
  await setWorkspaceSetting(workspaceId, "ganalytics_oauth:refresh_token", "");
  await setWorkspaceSetting(workspaceId, "ganalytics_oauth:account", "");
  oauthTokenCache.delete(workspaceId);
}

// ── Credential resolution shared by the GSC and GA4 connectors ───────────────

/**
 * Which credential a workspace's analytics calls run on, most-specific first:
 * the workspace's connected Google account, else the workspace's own pasted
 * service account, else the shared platform Drive SA (deliberate back-fill so
 * one operator project can serve tenants that haven't connected their own).
 * `identity` is what error messages and the admin UI show.
 */
export type AnalyticsCredential =
  | { kind: "oauth"; identity: string }
  | { kind: "own_sa"; identity: string; sa: ServiceAccount }
  | { kind: "platform_sa"; identity: string; sa: ServiceAccount };

export async function resolveAnalyticsCredential(
  workspaceId: string | null | undefined,
  ownSaSettingKey: "gsc:service_account" | "ga4:service_account",
): Promise<AnalyticsCredential | null> {
  if (workspaceId) {
    const oauth = await analyticsOauthConnected(workspaceId);
    if (oauth.connected) return { kind: "oauth", identity: oauth.account || "the connected Google account" };
  }
  const own = await getSetting(ownSaSettingKey, workspaceId).catch(() => "");
  if (own) {
    const sa = parseServiceAccount(own);
    return sa ? { kind: "own_sa", identity: sa.client_email, sa } : null;
  }
  try {
    const { db } = await import("@/lib/db");
    const row = await db.setting.findUnique({ where: { key: "gdrive:service_account" } });
    const sa = row?.value ? parseServiceAccount(row.value) : null;
    return sa ? { kind: "platform_sa", identity: sa.client_email, sa } : null;
  } catch {
    return null;
  }
}

/** An access token for this credential + scope, whatever its kind. */
export async function analyticsCredentialToken(
  workspaceId: string | null | undefined,
  cred: AnalyticsCredential,
  scope: string,
): Promise<string> {
  if (cred.kind === "oauth") {
    if (!workspaceId) throw new Error("OAuth analytics credentials are workspace-scoped.");
    const token = await analyticsOauthAccessToken(workspaceId);
    if (!token) throw new Error("The connected Google account's token could not be refreshed — reconnect it under Admin → Analytics.");
    return token;
  }
  return googleAccessToken(cred.sa, scope);
}
