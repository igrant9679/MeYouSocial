import crypto from "node:crypto";

/**
 * Google service-account auth, scope-parameterized. Same dependency-free
 * pattern as src/lib/storage/gdrive.ts (RS256 JWT signed with node:crypto,
 * exchanged for an access token) — generalized here so the Search Console and
 * GA4 connectors can share it. gdrive.ts keeps its own copy on purpose: it is
 * load-bearing for storage and not worth churning.
 *
 * Service accounts work for GSC and GA4 because both let you grant access to an
 * arbitrary principal (add the SA's email as a user on the property/site).
 * YouTube is the exception — channel-owned data needs real OAuth, see
 * src/lib/youtube/oauth.ts.
 */

export type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

export function parseServiceAccount(json: string): ServiceAccount | null {
  try {
    const parsed = JSON.parse(json) as Partial<ServiceAccount>;
    if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") return null;
    if (!parsed.client_email || !parsed.private_key) return null;
    return {
      client_email: parsed.client_email,
      // JSON-pasted keys often arrive with literal \n sequences.
      private_key: parsed.private_key.replace(/\\n/g, "\n"),
      token_uri: parsed.token_uri,
    };
  } catch {
    return null;
  }
}

function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Cache per (service account, scope) — a token is only valid for its scope.
const tokenCache = new Map<string, { token: string; expires: number }>();

export function invalidateGoogleTokenCache() {
  tokenCache.clear();
}

/** Mint (or reuse) an access token for this service account + scope. */
export async function googleAccessToken(sa: ServiceAccount, scope: string): Promise<string> {
  const cacheKey = `${sa.client_email}|${scope}`;
  const hit = tokenCache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.token;

  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope, aud: tokenUri, iat, exp: iat + 3600 }));
  const signingInput = `${header}.${claims}`;

  let signature: string;
  try {
    signature = b64url(crypto.sign("RSA-SHA256", Buffer.from(signingInput), sa.private_key));
  } catch {
    throw new Error("Service account private key is invalid — re-paste the JSON key file.");
  }

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${signingInput}.${signature}`,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string };
  if (!res.ok || !body.access_token) {
    const detail = body.error_description || body.error || `HTTP ${res.status}`;
    throw new Error(`Google token exchange failed: ${detail}`);
  }

  // Refresh a minute early so a long request can't straddle expiry.
  tokenCache.set(cacheKey, { token: body.access_token, expires: Date.now() + 3540_000 });
  return body.access_token;
}

/** Small JSON helper that surfaces Google's error message rather than a bare status. */
export async function googleApi<T>(
  url: string,
  token: string,
  init?: { method?: "GET" | "POST"; body?: unknown },
): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    // non-JSON error page
  }
  if (!res.ok) {
    const message =
      (json as { error?: { message?: string } })?.error?.message ??
      (typeof json === "object" && json && "error_description" in json ? String((json as Record<string, unknown>).error_description) : "") ??
      "";
    throw new Error(`${message || text.slice(0, 200) || res.statusText} (HTTP ${res.status})`);
  }
  return json as T;
}
