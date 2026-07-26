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
// TWO AUTH MODES, chosen by the Setting `gdrive:auth_mode`:
//   service_account — this file. Server-to-server, no human involved.
//   oauth           — ./gdrive-oauth.ts. Files owned by a consenting human.
//
// ⚠ Honest limit, measured not assumed: a service account's storage quota is
// literally 0 and it OWNS every file it uploads, so a personal My Drive folder
// can NEVER work no matter how it is shared — the upload 403s with
// storageQuotaExceeded. Only a Shared Drive (Google Workspace) makes the
// service-account path viable, because there the drive owns the file. On a
// personal @gmail.com account, use OAuth mode instead.

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
  // The OAuth access token is cached separately; a mode switch or a reconnect
  // must not leave a stale token behind for the other path.
  void import("@/lib/storage/gdrive-oauth").then((m) => m.invalidateGdriveOauthCache()).catch(() => {});
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

// ── Auth mode: service account vs user OAuth ─────────────────────────────────

/**
 * Two ways to reach Drive, and which one is in play changes what a failure
 * MEANS — so every call resolves through here rather than reaching for the
 * service account directly.
 *
 * - `service_account`: server-to-server, files owned by the SA. Only viable
 *   against a Shared Drive, i.e. Google Workspace. See ./gdrive-oauth.ts for
 *   why a My Drive folder can never work.
 * - `oauth`: files owned by the human who consented, using their own quota.
 *   The only option on a personal @gmail.com account.
 *
 * Default is `service_account` so existing installs are untouched by this
 * being added.
 */
export type DriveAuthMode = "service_account" | "oauth";

export async function getDriveAuthMode(): Promise<DriveAuthMode> {
  try {
    const { db } = await import("@/lib/db");
    const row = await db.setting.findUnique({ where: { key: "gdrive:auth_mode" } });
    if (row?.value === "oauth") return "oauth";
  } catch {
    // DB unavailable — the service-account path is the safe assumption
  }
  return "service_account";
}

/**
 * Everything a Drive call needs, with the mode carried along so error messages
 * can name the right fix. `label` is the identity that owns the files — the SA
 * address, or the connected Google account.
 */
export type DriveAccess = {
  mode: DriveAuthMode;
  token: string;
  folderId: string;
  label: string;
};

/** Resolves credentials + destination folder for whichever mode is configured. */
export async function resolveDriveAccess(): Promise<DriveAccess | null> {
  if ((await getDriveAuthMode()) === "oauth") {
    const { gdriveOauthAccessToken, ensureAppFolder, gdriveOauthConnected } = await import("@/lib/storage/gdrive-oauth");
    const token = await gdriveOauthAccessToken();
    if (!token) return null;
    // The folder is re-validated on every resolve: the user can delete it from
    // Drive whenever they like, and a stale id 404s every upload.
    const folder = await ensureAppFolder(token);
    const { account } = await gdriveOauthConnected();
    return { mode: "oauth", token, folderId: folder.id, label: account || "the connected Google account" };
  }
  const cfg = await getGdriveConfig();
  if (!cfg) return null;
  return { mode: "service_account", token: await accessToken(cfg.sa), folderId: cfg.folderId, label: cfg.sa.client_email };
}

function requireAccess(access: DriveAccess | null): DriveAccess {
  if (!access) {
    throw new Error(
      "Google Drive storage is selected but not connected — set it up under Admin → API keys → Storage" +
      " (connect a Google account, or paste a service account JSON and folder).",
    );
  }
  return access;
}

// ── Drive REST helpers ───────────────────────────────────────────────────────

/**
 * Pull the human sentence out of a Drive error body. Drive answers
 * `{"error":{"code":403,"message":"…"}}`; blindly slicing that leaves the caller
 * staring at half a JSON object. Falls back to a trimmed body when it isn't the
 * shape we expect (HTML error pages from a proxy, say).
 */
function driveErrorMessage(detail: string): string {
  try {
    const parsed = JSON.parse(detail) as { error?: { message?: string } };
    const message = parsed.error?.message;
    if (message) return message;
  } catch {
    // not JSON — fall through
  }
  return detail.replace(/\s+/g, " ").trim().slice(0, 300) || "no detail returned";
}

async function driveUpload(access: DriveAccess, name: string, data: Buffer, contentType: string): Promise<{ id: string }> {
  const token = access.token;
  const boundary = `mys-${nanoid(12)}`;
  const meta = JSON.stringify({ name, parents: [access.folderId] });
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
    // Name the fix rather than dumping Google's JSON. These two are, in
    // practice, the only 403s this call produces, and they need opposite
    // actions — so telling them apart is the whole value of the message.
    //
    // ⚠ When we have a hint, the raw body is REPLACED, not appended to. The
    // previous version concatenated our advice onto `detail.slice(0, 200)`,
    // which cut Google's JSON mid-sentence and spliced English into an
    // unbalanced brace — the user saw "...Leverage shared drives (...), or use
    // The service account's own Drive quota is full". Truncated JSON plus prose
    // reads as a broken app, which is the opposite of the point here.
    //
    // ⚠ `storageQuotaExceeded` means two COMPLETELY different things depending
    // on the mode, and telling a user with a full Drive to go buy Google
    // Workspace would be nonsense. Branch on the mode, not just the reason code.
    if (detail.includes("storageQuotaExceeded")) {
      if (access.mode === "oauth") {
        throw new Error(
          `Drive upload failed: ${access.label} is out of Google storage.` +
          ` Free space in that account (Drive, Gmail and Photos share one quota) or upgrade its Google One plan, then try again.`,
        );
      }
      // The service account OWNS what it uploads, and its own Drive quota is
      // separate from the folder owner's — sharing a folder grants no space.
      throw new Error(
        `Drive upload failed: the service account (${access.label}) has no Drive storage of its own.` +
        ` A service account owns every file it uploads, and that storage is separate from the folder owner's —` +
        ` sharing a folder with it grants permission, never quota, so a My Drive folder can never work.` +
        ` Fix: either switch Storage to "Connect a Google account" (works on a personal account), or create a Shared Drive` +
        ` (Google Workspace only), add ${access.label} as a member with Content manager, and use a folder ID from inside it.`,
      );
    }
    if (res.status === 403 && /Insufficient permissions for the specified parent|insufficientFilePermissions/i.test(detail)) {
      // Almost always: the folder is shared with the SA as VIEWER, or not at
      // all. Read access is enough to pass the folder check and still fail here.
      throw new Error(
        `Drive upload failed: the folder is reachable but not writable by ${access.label}.` +
        ` Open the folder in Drive → Share, add that address with the EDITOR role (Viewer isn't enough), and untick "Notify people".` +
        ` If it lives in a Shared Drive, add the service account as a member of the drive with Content manager.`,
      );
    }
    throw new Error(`Drive upload failed (HTTP ${res.status}): ${driveErrorMessage(detail)}`);
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
  const access = requireAccess(await resolveDriveAccess());
  return fetch(`${DRIVE}/files/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${access.token}`, ...(range ? { Range: range } : {}) },
    signal: AbortSignal.timeout(300_000),
  });
}

export type GdriveStatus = {
  ok: boolean;
  mode?: DriveAuthMode;
  email?: string;
  folderName?: string;
  usedBytes?: number;
  limitBytes?: number;
  error?: string;
};

/** Live connection + quota check for the admin card. Never throws. */
export async function gdriveStatus(): Promise<GdriveStatus> {
  const mode = await getDriveAuthMode();
  let access: DriveAccess | null;
  try {
    access = await resolveDriveAccess();
  } catch (err) {
    // OAuth mode resolves the folder eagerly, so folder creation can fail here.
    return { ok: false, mode, error: err instanceof Error ? err.message : "Connection failed" };
  }
  if (!access) {
    return {
      ok: false,
      mode,
      error: mode === "oauth" ? "No Google account connected" : "Not configured",
    };
  }
  try {
    const [aboutRes, folderRes] = await Promise.all([
      fetch(`${DRIVE}/about?fields=storageQuota`, {
        headers: { Authorization: `Bearer ${access.token}` }, signal: AbortSignal.timeout(6_000),
      }),
      fetch(`${DRIVE}/files/${access.folderId}?fields=id,name,driveId&supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${access.token}` }, signal: AbortSignal.timeout(6_000),
      }),
    ]);
    if (!folderRes.ok) {
      return {
        ok: false, mode, email: access.label,
        error: mode === "oauth"
          ? `The app's Drive folder is not reachable (HTTP ${folderRes.status}) — reconnect the Google account.`
          : `Folder not reachable (HTTP ${folderRes.status}) — is it shared with the service account as Editor?`,
      };
    }
    // `driveId` is present only for items inside a Shared Drive. Its absence
    // means the folder lives in somebody's My Drive.
    const folder = (await folderRes.json()) as { name?: string; driveId?: string };
    const about = aboutRes.ok
      ? ((await aboutRes.json()) as { storageQuota?: { usage?: string; limit?: string } })
      : {};

    // ⚠ THE CARD USED TO GO GREEN HERE WHILE EVERY UPLOAD FAILED. Reaching the
    // folder proves permission, never capacity: a service account has a storage
    // limit of exactly 0 and owns every file it creates, so writing into a My
    // Drive folder always ends in storageQuotaExceeded no matter who shared it
    // or with what role. Inside a Shared Drive the DRIVE owns the file, so a
    // zero limit is expected and fine — hence the driveId check, not a bare
    // limit check. In OAuth mode a real human owns the quota, so this whole
    // trap is inapplicable.
    if (mode === "service_account" && about.storageQuota?.limit === "0" && !folder.driveId) {
      return {
        ok: false,
        mode,
        email: access.label,
        folderName: folder.name,
        error:
          `Folder is reachable, but uploads cannot work: “${folder.name}” is in a My Drive and the service account has 0 bytes of storage of its own.` +
          ` A service account owns every file it uploads, so sharing a folder with it grants permission but never space.` +
          // No "above"/"below" — this renders in a banner that sits ABOVE the
          // control it points at, and it may get surfaced elsewhere later. Name
          // the control, not its position on one particular page.
          ` Fix: under "How to reach Drive", pick "Connect a Google account" — or use a folder inside a Shared Drive` +
          ` (Google Workspace only) with ${access.label} added as Content manager.`,
      };
    }

    return {
      ok: true,
      mode,
      email: access.label,
      folderName: folder.name,
      usedBytes: about.storageQuota?.usage ? Number(about.storageQuota.usage) : undefined,
      limitBytes: about.storageQuota?.limit ? Number(about.storageQuota.limit) : undefined,
    };
  } catch (err) {
    return { ok: false, mode, email: access.label, error: err instanceof Error ? err.message : "Connection failed" };
  }
}

/**
 * Write-then-delete probe used by the admin save action: proves the folder is
 * writable AND that quota exists — a metadata read can't catch either.
 */
export async function gdriveProbeWrite(): Promise<{ ok: boolean; error?: string }> {
  try {
    const access = requireAccess(await resolveDriveAccess());
    const { id } = await driveUpload(access, ".meyousocial-write-probe.txt", Buffer.from("probe"), "text/plain");
    await fetch(`${DRIVE}/files/${id}?supportsAllDrives=true`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${access.token}` },
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
    const access = requireAccess(await resolveDriveAccess());
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    // Keep the human-readable name visible in the Drive folder, prefixed for
    // uniqueness (Drive allows duplicate names, humans browsing don't enjoy them).
    const safeName = name.replace(/[^\w.-]+/g, "_").slice(0, 80) || "file";
    const { id } = await driveUpload(access, `${nanoid(10)}-${safeName}`, buf, contentType || "application/octet-stream");
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
