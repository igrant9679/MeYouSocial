import { getSetting, setWorkspaceSetting } from "@/lib/settings";
import { encryptSecret, decryptSecret, type Encrypted } from "@/lib/blog-crypto";

/**
 * YouTube OAuth (per workspace).
 *
 * Why OAuth and not a service account like GSC/GA4: YouTube does not let you
 * grant an arbitrary principal access to a channel. Anything channel-owned —
 * uploading, or reading your own channel's analytics — requires a real user
 * consent flow and a refresh token. The Data API *key* under Admin → API keys
 * is a different thing: it only reads public data.
 *
 * The refresh token is long-lived and grants upload rights, so it is stored
 * AES-GCM encrypted (blog-crypto / TOKEN_ENCRYPTION_KEY), never in the clear.
 */

// upload = publish videos; yt-analytics.readonly = own-channel view/watch data;
// youtube.readonly = channel + video metadata. Requested together so the user
// consents once for everything the intelligence layer will need.
export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
  "https://www.googleapis.com/auth/youtube.readonly",
].join(" ");

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export type YoutubeOauthConfig = { clientId: string; clientSecret: string };

export async function getYoutubeOauthConfig(workspaceId?: string | null): Promise<YoutubeOauthConfig | null> {
  const [clientId, clientSecret] = await Promise.all([
    getSetting("youtube_oauth:client_id", workspaceId).catch(() => ""),
    getSetting("youtube_oauth:client_secret", workspaceId).catch(() => ""),
  ]);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** The redirect URI to register in Google Cloud Console. Origin-derived, so a custom domain just works. */
export function youtubeRedirectUri(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/api/oauth/youtube/callback`;
}

/**
 * Build the consent URL. `state` carries the workspace id so the callback knows
 * which workspace to attach the token to; it is also the CSRF guard (the
 * callback re-checks it against the signed-in user's workspace).
 * access_type=offline + prompt=consent is what makes Google return a REFRESH
 * token — without prompt=consent a second authorization returns only an access
 * token and the connection silently expires in an hour.
 */
export async function buildYoutubeAuthUrl(workspaceId: string, origin: string): Promise<string | null> {
  const cfg = await getYoutubeOauthConfig(workspaceId);
  if (!cfg) return null;
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: youtubeRedirectUri(origin),
    response_type: "code",
    scope: YOUTUBE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    // ⚠ No include_granted_scopes: Google merges previously granted scopes
    // (e.g. Drive's drive.file) into the request, and YouTube scopes refuse to
    // combine with them — "scopes that cannot be requested together",
    // Error 400 invalid_request. Each connect keeps its own token instead.
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
export async function exchangeYoutubeCode(workspaceId: string, code: string, origin: string): Promise<{ ok: boolean; message: string }> {
  const cfg = await getYoutubeOauthConfig(workspaceId);
  if (!cfg) return { ok: false, message: "YouTube OAuth client is not configured." };
  try {
    const tokens = await tokenRequest({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: youtubeRedirectUri(origin),
      grant_type: "authorization_code",
    });
    if (!tokens.refresh_token) {
      return {
        ok: false,
        message: "Google returned no refresh token. Remove this app at myaccount.google.com/permissions and connect again.",
      };
    }
    await setWorkspaceSetting(workspaceId, "youtube_oauth:refresh_token", JSON.stringify(encryptSecret(tokens.refresh_token)));

    // Record which channel was connected, so the UI can name it.
    let channel = "";
    if (tokens.access_token) {
      try {
        const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
          headers: { authorization: `Bearer ${tokens.access_token}` },
          signal: AbortSignal.timeout(30_000),
        });
        const data = (await res.json()) as { items?: Array<{ id: string; snippet?: { title?: string } }> };
        const item = data.items?.[0];
        if (item) channel = `${item.snippet?.title ?? "channel"} (${item.id})`;
      } catch {
        // naming is cosmetic — the token is what matters
      }
    }
    await setWorkspaceSetting(workspaceId, "youtube_oauth:channel", channel);
    return { ok: true, message: channel ? `Connected ${channel}.` : "Connected." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message.slice(0, 300) : "Connection failed" };
  }
}

export async function youtubeOauthConnected(workspaceId?: string | null): Promise<{ connected: boolean; channel: string }> {
  const [token, channel] = await Promise.all([
    getSetting("youtube_oauth:refresh_token", workspaceId).catch(() => ""),
    getSetting("youtube_oauth:channel", workspaceId).catch(() => ""),
  ]);
  return { connected: Boolean(token), channel: channel ?? "" };
}

/**
 * A fresh access token for API calls. Refresh tokens don't expire in normal use,
 * so this is the entry point every YouTube call should use.
 */
export async function youtubeAccessToken(workspaceId: string): Promise<string | null> {
  const [cfg, stored] = await Promise.all([
    getYoutubeOauthConfig(workspaceId),
    getSetting("youtube_oauth:refresh_token", workspaceId).catch(() => ""),
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
    return tokens.access_token ?? null;
  } catch {
    return null;
  }
}

export async function disconnectYoutubeOauth(workspaceId: string): Promise<void> {
  await setWorkspaceSetting(workspaceId, "youtube_oauth:refresh_token", "");
  await setWorkspaceSetting(workspaceId, "youtube_oauth:channel", "");
}
