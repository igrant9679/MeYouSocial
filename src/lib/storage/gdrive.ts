import crypto from "node:crypto";
import { nanoid } from "nanoid";
import type { StoredFile, StorageProvider } from "@/lib/storage";

// Google Drive storage backend (FR: durable media on Railway, whose local disk
// is wiped on every redeploy). House pattern throughout: config lives in the
// Setting table (Admin → API keys → Storage), env vars are the fallback, no SDK
// dependency — Drive v3 REST + a service-account JWT signed with node:crypto.
//
// Files are uploaded into ONE Drive folder shared with the service account and
// are NOT made public: the app streams them through /api/files/<key> to
// signed-in users only. Keys are `gdrive:<fileId>` so they can never collide
// with legacy local keys.
//
// Honest limits (also stated in the admin UI): on a personal My Drive folder,
// uploads are owned by the service account and count against the SERVICE
// ACCOUNT's own 15 GB Google quota — not the folder owner's. Shared Drives
// (Google Workspace) pool quota instead; both work here (supportsAllDrives).

export type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

export type GdriveConfig = {
  sa: ServiceAccount;
  folderId: string;
};

const DRIVE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const SCOPE = "https://www.googleapis.com/auth/drive";

export const GDRIVE_KEY_PREFIX = "gdrive:";

export function parseServiceAccount(json: string): ServiceAccount | null {
  try {
    const parsed = JSON.parse(json) as Partial<ServiceAccount>;
    if (typeof parsed.client_email === "string" && parsed.client_email.includes("@") &&
        typeof parsed.private_key === "string" && parsed.private_key.includes("PRIVATE KEY")) {
      return { client_email: parsed.client_email, private_key: parsed.private_key, token_uri: parsed.token_uri };
    }
  } catch {
    // not JSON
  }
  return null;
}

/** Accepts a bare folder id or any Drive folder URL and returns the id. */
export function extractFolderId(input: string): string | null {
  const s = input.trim();
  const fromUrl = s.match(/\/folders\/([A-Za-z0-9_-]{10,})/);
  if (fromUrl) return fromUrl[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(s)) return s;
  return null;
}

// ── Config resolution (DB Setting first, env fallback, 30s cache) ────────────

const CONFIG_TTL_MS = 30_000;
let configCache: { value: GdriveConfig | null; expires: number } | null = null;

export async function getGdriveConfig(): Promise<GdriveConfig | null> {
  if (configCache && configCache.expires > Date.now()) return configCache.value;
  let saJson = "";
  let folderRaw = "";
  try {
    const { db } = await import("@/lib/db");
    const rows = await db.setting.findMany({ where: { key: { in: ["gdrive:service_account", "gdrive:folder_id"] } } });
    for (const r of rows) {
      if (r.key === "gdrive:service_account") saJson = r.value;
      if (r.key === "gdrive:folder_id") folderRaw = r.value;
    }
  } catch {
    // DB unavailable — fall through to env
  }
  if (!saJson) saJson = process.env.GDRIVE_SERVICE_ACCOUNT_JSON ?? "";
  if (!folderRaw) folderRaw = process.env.GDRIVE_FOLDER_ID ?? "";

  const sa = saJson ? parseServiceAccount(saJson) : null;
  const folderId = folderRaw ? extractFolderId(folderRaw) : null;
  const value = sa && folderId ? { sa, folderId } : null;
  configCache = { value, expires: Date.now() + CONFIG_TTL_MS };
  return value;
}

export function invalidateGdriveCache() {
  configCache = null;
  tokenCache = null;
}

// ── OAuth: service-account JWT → access token ────────────────────────────────

let tokenCache: { token: string; saEmail: string; expires: number } | null = null;

function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString("base64url");
}

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (tokenCache && tokenCache.saEmail === sa.client_email && tokenCache.expires > Date.now()) {
    return tokenCache.token;
  }
  const iat = Math.floor(Date.now() / 1000);
  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: tokenUri, iat, exp: iat + 3600 }));
  const input = `${header}.${claims}`;
  const signature = crypto.createSign("RSA-SHA256").update(input).sign(sa.private_key);
  const assertion = `${input}.${b64url(signature)}`;

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Google token exchange failed (HTTP ${res.status}): ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Google token exchange returned no access_token");
  tokenCache = {
    token: data.access_token,
    saEmail: sa.client_email,
    expires: Date.now() + (Math.max(120, data.expires_in ?? 3600) - 120) * 1000,
  };
  return data.access_token;
}

// ── Drive REST helpers ───────────────────────────────────────────────────────

function requireConfig(cfg: GdriveConfig | null): GdriveConfig {
  if (!cfg) {
    throw new Error(
      "Google Drive storage is selected but not configured — paste the service account JSON and folder under Admin → API keys → Storage.",
    );
  }
  return cfg;
}

async function driveUpload(cfg: GdriveConfig, name: string, data: Buffer, contentType: string): Promise<{ id: string }> {
  const token = await accessToken(cfg.sa);
  const boundary = `mys-${nanoid(12)}`;
  const meta = JSON.stringify({ name, parents: [cfg.folderId] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await fetch(`${DRIVE_UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // storageQuotaExceeded = the service account's OWN 15 GB is full (personal
    // My Drive target) — surface that plainly instead of a generic 403.
    const quota = detail.includes("storageQuotaExceeded")
      ? " The service account's own 15 GB Drive quota is full — free space or switch to a Workspace Shared Drive."
      : "";
    throw new Error(`Drive upload failed (HTTP ${res.status}): ${detail.slice(0, 200)}${quota}`);
  }
  const out = (await res.json()) as { id?: string };
  if (!out.id) throw new Error("Drive upload returned no file id");
  return { id: out.id };
}

/**
 * Fetch a file's bytes. `range` (e.g. "bytes=0-") is forwarded so <video>
 * seeking works through the /api/files proxy; Drive answers 206 + Content-Range.
 */
export async function gdriveFetchMedia(fileId: string, range?: string): Promise<Response> {
  const cfg = requireConfig(await getGdriveConfig());
  const token = await accessToken(cfg.sa);
  return fetch(`${DRIVE}/files/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}`, ...(range ? { Range: range } : {}) },
    signal: AbortSignal.timeout(300_000),
  });
}

export type GdriveStatus = {
  ok: boolean;
  email?: string;
  folderName?: string;
  usedBytes?: number;
  limitBytes?: number;
  error?: string;
};

/** Live connection + quota check for the admin card. Never throws. */
export async function gdriveStatus(): Promise<GdriveStatus> {
  const cfg = await getGdriveConfig();
  if (!cfg) return { ok: false, error: "Not configured" };
  try {
    const token = await accessToken(cfg.sa);
    const [aboutRes, folderRes] = await Promise.all([
      fetch(`${DRIVE}/about?fields=storageQuota`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6_000),
      }),
      fetch(`${DRIVE}/files/${cfg.folderId}?fields=id,name&supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6_000),
      }),
    ]);
    if (!folderRes.ok) {
      return { ok: false, email: cfg.sa.client_email, error: `Folder not reachable (HTTP ${folderRes.status}) — is it shared with the service account as Editor?` };
    }
    const folder = (await folderRes.json()) as { name?: string };
    const about = aboutRes.ok
      ? ((await aboutRes.json()) as { storageQuota?: { usage?: string; limit?: string } })
      : {};
    return {
      ok: true,
      email: cfg.sa.client_email,
      folderName: folder.name,
      usedBytes: about.storageQuota?.usage ? Number(about.storageQuota.usage) : undefined,
      limitBytes: about.storageQuota?.limit ? Number(about.storageQuota.limit) : undefined,
    };
  } catch (err) {
    return { ok: false, email: cfg.sa.client_email, error: err instanceof Error ? err.message : "Connection failed" };
  }
}

/**
 * Write-then-delete probe used by the admin save action: proves the folder is
 * writable AND that quota exists — a metadata read can't catch either.
 */
export async function gdriveProbeWrite(): Promise<{ ok: boolean; error?: string }> {
  try {
    const cfg = requireConfig(await getGdriveConfig());
    const { id } = await driveUpload(cfg, ".meyousocial-write-probe.txt", Buffer.from("probe"), "text/plain");
    const token = await accessToken(cfg.sa);
    await fetch(`${DRIVE}/files/${id}?supportsAllDrives=true`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    }).catch(() => {});
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Write probe failed" };
  }
}

// ── StorageProvider implementation ───────────────────────────────────────────

export const gdriveProvider: StorageProvider = {
  async put(name, data, contentType): Promise<StoredFile> {
    const cfg = requireConfig(await getGdriveConfig());
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    // Keep the human-readable name visible in the Drive folder, prefixed for
    // uniqueness (Drive allows duplicate names, humans browsing don't enjoy them).
    const safeName = name.replace(/[^\w.-]+/g, "_").slice(0, 80) || "file";
    const { id } = await driveUpload(cfg, `${nanoid(10)}-${safeName}`, buf, contentType || "application/octet-stream");
    const key = `${GDRIVE_KEY_PREFIX}${id}`;
    return {
      key,
      url: `/api/files/${encodeURIComponent(key)}`,
      size: buf.byteLength,
      contentType,
      originalName: name,
    };
  },
  async get(key): Promise<Buffer | null> {
    const id = key.startsWith(GDRIVE_KEY_PREFIX) ? key.slice(GDRIVE_KEY_PREFIX.length) : key;
    try {
      const res = await gdriveFetchMedia(id);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  },
  url(key): string {
    return `/api/files/${encodeURIComponent(key)}`;
  },
};
