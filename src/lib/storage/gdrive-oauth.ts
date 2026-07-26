import crypto from "node:crypto";
import { getSetting, setPlatformSetting } from "@/lib/settings";
import { encryptSecret, decryptSecret, type Encrypted } from "@/lib/blog-crypto";

/**
 * Google Drive storage over USER OAuth, as an alternative to the service
 * account in ./gdrive.ts.
 *
 * WHY THIS EXISTS — the service-account path cannot work on a personal Google
 * account, and no amount of sharing fixes it. A service account has a storage
 * limit of exactly 0 bytes and OWNS every file it uploads, so writing into a My
 * Drive folder always ends in `storageQuotaExceeded`; sharing a folder grants
 * permission, never capacity. Google's own error names two escapes — Shared
 * Drives and domain-wide delegation — and BOTH require Google Workspace. On a
 * @gmail.com account there is no service-account path at all. With user OAuth
 * the files are owned by the signed-in human and use their own quota, which is
 * the only arrangement that works without a Workspace subscription.
 *
 * ⚠ SCOPE IS `drive.file`, AND THAT IS A DELIBERATE, LEAD-PIPE CONSTRAINT.
 * Two consequences that will look like bugs if you don't know them:
 *
 *   1. `drive.file` is a NON-SENSITIVE scope, so the OAuth client needs no
 *      Google verification review. Full `drive` is a RESTRICTED scope: it drags
 *      in verification and a third-party security assessment before the app can
 *      leave "Testing" status — and an app left in Testing has its refresh
 *      tokens EXPIRED BY GOOGLE AFTER 7 DAYS. Storage that silently dies every
 *      week is worse than no storage. Do not "upgrade" the scope.
 *   2. `drive.file` grants access ONLY to files this app created. Uploading
 *      with `parents: [someUserFolderId]` therefore fails with a 404 on the
 *      parent — the app genuinely cannot see a folder it didn't make. That is
 *      why OAuth mode CREATES AND OWNS its folder (`ensureAppFolder`) instead of
 *      letting the operator paste a folder id the way service-account mode does.
 *      A "let them choose the folder" feature request needs the Drive Picker,
 *      not a wider scope.
 *
 * Storage is PLATFORM infrastructure (one store serves every tenant), so unlike
 * the per-workspace YouTube OAuth in src/lib/youtube/oauth.ts every value here
 * is a global `Setting` row and the flow is gated to the platform operator.
 * The refresh token is long-lived, so it is AES-GCM encrypted at rest.
 */

export const DRIVE_OAUTH_SCOPE = "https://www.googleapis.com/auth/drive.file";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DRIVE = "https://www.googleapis.com/drive/v3";

const K = {
  clientId: "gdrive_oauth:client_id",
  clientSecret: "gdrive_oauth:client_secret",
  refreshToken: "gdrive_oauth:refresh_token",
  account: "gdrive_oauth:account",
  folderId: "gdrive_oauth:folder_id",
  state: "gdrive_oauth:state",
} as const;

/** Folder created in the connected account's My Drive. Visible to the user, which is the point. */
export const APP_FOLDER_NAME = "MeYouSocial";

export type GdriveOauthClient = { clientId: string; clientSecret: string };

export async function getGdriveOauthClient(): Promise<GdriveOauthClient | null> {
  const [clientId, clientSecret] = await Promise.all([
    getSetting(K.clientId).catch(() => ""),
    getSetting(K.clientSecret).catch(() => ""),
  ]);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** The redirect URI to register in Google Cloud Console. Origin-derived, so a custom domain just works. */
export function gdriveRedirectUri(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/api/oauth/gdrive/callback`;
}

// ── Consent flow ─────────────────────────────────────────────────────────────

/**
 * Build the consent URL, arming a single-use CSRF nonce.
 *
 * The YouTube flow uses the workspace id as `state` because its callback can
 * re-derive that from the session. Storage has no workspace to key on, so this
 * stores a random nonce that the callback must match and then burns. 10-minute
 * life: long enough for a consent screen, short enough that a leaked URL is
 * dead by the time anyone finds it.
 */
export async function buildGdriveAuthUrl(origin: string): Promise<string | null> {
  const client = await getGdriveOauthClient();
  if (!client) return null;
  const nonce = crypto.randomBytes(24).toString("base64url");
  await setPlatformSetting(K.state, `${nonce}.${Date.now() + 10 * 60_000}`);
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: gdriveRedirectUri(origin),
    response_type: "code",
    scope: DRIVE_OAUTH_SCOPE,
    // offline + consent is what makes Google return a REFRESH token. Without
    // prompt=consent a SECOND authorization returns only an access token and
    // the connection dies an hour later, looking like a random outage.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: nonce,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * Verify + burn the nonce. Single use, so a replayed callback fails.
 *
 * Reads the row DIRECTLY rather than through getSetting's 30s cache. The cache
 * is per-process: a replica that had already cached an empty nonce would reject
 * a perfectly good callback for up to 30 seconds, which would look like a random
 * "link expired" for no reason a user could act on.
 */
async function consumeState(state: string): Promise<boolean> {
  let stored = "";
  try {
    const { db } = await import("@/lib/db");
    stored = (await db.setting.findUnique({ where: { key: K.state } }))?.value ?? "";
  } catch {
    return false;
  }
  await setPlatformSetting(K.state, "");
  if (!stored || !state) return false;
  const [nonce, expiry] = stored.split(".");
  if (!nonce || nonce !== state) return false;
  return Number(expiry) > Date.now();
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

/** Exchange the consent code, store the refresh token encrypted, and make the app folder. */
export async function exchangeGdriveCode(code: string, state: string, origin: string): Promise<{ ok: boolean; message: string }> {
  const client = await getGdriveOauthClient();
  if (!client) return { ok: false, message: "Drive OAuth client is not configured." };
  if (!(await consumeState(state))) {
    return { ok: false, message: "That authorization link expired or was already used. Hit Connect again." };
  }
  try {
    const tokens = await tokenRequest({
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: gdriveRedirectUri(origin),
      grant_type: "authorization_code",
    });
    if (!tokens.refresh_token) {
      return {
        ok: false,
        message: "Google returned no refresh token. Remove this app at myaccount.google.com/permissions and connect again.",
      };
    }
    await setPlatformSetting(K.refreshToken, JSON.stringify(encryptSecret(tokens.refresh_token)));
    invalidateGdriveOauthCache();

    if (!tokens.access_token) return { ok: true, message: "Connected." };

    // Name the account and create the folder now, so a broken setup surfaces
    // here rather than on the first upload.
    const account = await fetchAccountEmail(tokens.access_token);
    await setPlatformSetting(K.account, account);
    const folder = await ensureAppFolder(tokens.access_token);
    return {
      ok: true,
      message: `Connected ${account || "Google account"} — files go to the “${folder.name}” folder in its Drive.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message.slice(0, 300) : "Connection failed" };
  }
}

// ── Access tokens ────────────────────────────────────────────────────────────

let tokenCache: { token: string; expires: number } | null = null;

export function invalidateGdriveOauthCache() {
  tokenCache = null;
}

/**
 * A fresh access token. Refresh tokens don't expire in normal use once the
 * OAuth app is published (see the scope note at the top — a Testing-status app
 * is the case where they DO, after 7 days).
 */
export async function gdriveOauthAccessToken(): Promise<string | null> {
  if (tokenCache && tokenCache.expires > Date.now()) return tokenCache.token;
  const [client, stored] = await Promise.all([
    getGdriveOauthClient(),
    getSetting(K.refreshToken).catch(() => ""),
  ]);
  if (!client || !stored) return null;
  let refreshToken: string;
  try {
    refreshToken = decryptSecret(JSON.parse(stored) as Encrypted);
  } catch {
    return null; // key rotated or row corrupt — the UI will show disconnected
  }
  try {
    const tokens = await tokenRequest({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
    if (!tokens.access_token) return null;
    tokenCache = {
      token: tokens.access_token,
      expires: Date.now() + (Math.max(120, tokens.expires_in ?? 3600) - 120) * 1000,
    };
    return tokens.access_token;
  } catch {
    return null;
  }
}

// ── The app-owned folder ─────────────────────────────────────────────────────

async function fetchAccountEmail(token: string): Promise<string> {
  try {
    // about.get is in drive.file's scope list, so this needs no extra consent.
    const res = await fetch(`${DRIVE}/about?fields=user(emailAddress)`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return "";
    const data = (await res.json()) as { user?: { emailAddress?: string } };
    return data.user?.emailAddress ?? "";
  } catch {
    return ""; // naming is cosmetic — the token is what matters
  }
}

/**
 * Resolve the folder this app owns, creating it on first use.
 *
 * The stored id is re-validated every time rather than trusted: the user can
 * delete or trash the folder from Drive at any moment, and a stale id would
 * turn every upload into a 404. A trashed folder counts as gone — uploading
 * into the bin would "work" and then quietly vanish.
 */
export async function ensureAppFolder(token: string): Promise<{ id: string; name: string }> {
  const stored = (await getSetting(K.folderId).catch(() => "")).trim();
  if (stored) {
    try {
      const res = await fetch(`${DRIVE}/files/${stored}?fields=id,name,trashed`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const f = (await res.json()) as { id?: string; name?: string; trashed?: boolean };
        if (f.id && !f.trashed) return { id: f.id, name: f.name ?? APP_FOLDER_NAME };
      }
    } catch {
      // fall through and recreate
    }
  }
  const res = await fetch(`${DRIVE}/files?fields=id,name`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ name: APP_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Could not create the “${APP_FOLDER_NAME}” folder in Drive: ${detail.slice(0, 200)}`);
  }
  const created = (await res.json()) as { id?: string; name?: string };
  if (!created.id) throw new Error("Drive returned no folder id");
  await setPlatformSetting(K.folderId, created.id);
  return { id: created.id, name: created.name ?? APP_FOLDER_NAME };
}

// ── Status / teardown ────────────────────────────────────────────────────────

export async function gdriveOauthConnected(): Promise<{ connected: boolean; account: string; folderId: string }> {
  const [token, account, folderId] = await Promise.all([
    getSetting(K.refreshToken).catch(() => ""),
    getSetting(K.account).catch(() => ""),
    getSetting(K.folderId).catch(() => ""),
  ]);
  return { connected: Boolean(token), account: account ?? "", folderId: folderId ?? "" };
}

/**
 * Forget the connection. The folder and its files are deliberately LEFT IN
 * DRIVE — they belong to the user's account, and existing `gdrive:<id>` keys in
 * the database still point at them. Deleting here would destroy live media to
 * tidy up a credential.
 */
export async function disconnectGdriveOauth(): Promise<void> {
  await setPlatformSetting(K.refreshToken, "");
  await setPlatformSetting(K.account, "");
  await setPlatformSetting(K.folderId, "");
  invalidateGdriveOauthCache();
}
