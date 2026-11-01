import crypto from "node:crypto";

/**
 * The encryption keyring (E-SEC-04). Every stored secret is AES-256-GCM under a
 * key named by its id, so the key can be replaced without stranding anything:
 *
 *   TOKEN_ENCRYPTION_KEY           the current key (base64, 32 bytes) — new
 *                                  secrets are encrypted with it
 *   TOKEN_ENCRYPTION_KEY_PREVIOUS  older keys, comma-separated — still read,
 *                                  never written
 *
 * A key's id is the first 8 hex of a hash of it, so nothing has to be
 * configured beside the keys. Secrets written before the keyring carry no id;
 * they're read by trying each key (GCM's tag says which one fits).
 *
 * ⚠ Rotation is: new key into TOKEN_ENCRYPTION_KEY, the old one into
 * TOKEN_ENCRYPTION_KEY_PREVIOUS, deploy, then the operator re-encrypts on
 * Settings → Keyring. Removing a key that something still uses makes that
 * secret unreadable — it then reads as not set and has to be entered again.
 */

export type RingKey = { id: string; key: Buffer };
export type Ring = { current: RingKey | null; previous: RingKey[]; problems: string[] };

export function keyIdOf(key: Buffer): string {
  return crypto.createHash("sha256").update("mys-keyring:").update(key).digest("hex").slice(0, 8);
}

let memo: { env: string; ring: Ring } | null = null;

export function keyring(): Ring {
  const cur = process.env.TOKEN_ENCRYPTION_KEY ?? "";
  const prev = process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS ?? "";
  const env = `${cur}\n${prev}`;
  if (memo?.env === env) return memo.ring;
  const problems: string[] = [];
  const parse = (raw: string, label: string): RingKey | null => {
    const buf = Buffer.from(raw.trim(), "base64");
    if (buf.length !== 32) { problems.push(`${label} isn't 32 bytes of base64 — it's ignored`); return null; }
    return { id: keyIdOf(buf), key: buf };
  };
  const current = cur.trim() ? parse(cur, "TOKEN_ENCRYPTION_KEY") : null;
  const previous: RingKey[] = [];
  prev.split(",").map((s) => s.trim()).filter(Boolean).forEach((raw, i) => {
    const k = parse(raw, `TOKEN_ENCRYPTION_KEY_PREVIOUS #${i + 1}`);
    if (k && k.id !== current?.id && !previous.some((p) => p.id === k.id)) previous.push(k);
  });
  memo = { env, ring: { current, previous, problems } };
  return memo.ring;
}

function allKeys(): RingKey[] {
  const r = keyring();
  return r.current ? [r.current, ...r.previous] : r.previous;
}

export class KeyringError extends Error {}

function currentKey(): RingKey {
  const r = keyring();
  if (!r.current) throw new KeyringError(process.env.TOKEN_ENCRYPTION_KEY ? "TOKEN_ENCRYPTION_KEY must be 32 bytes (base64)" : "TOKEN_ENCRYPTION_KEY is not set");
  return r.current;
}

export type Sealed = { kid?: string; iv: string; tag: string; data: string };

export function seal(plain: string): Sealed & { kid: string } {
  const k = currentKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", k.key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return { kid: k.id, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

function tryOpen(enc: Sealed, k: RingKey): string {
  const d = crypto.createDecipheriv("aes-256-gcm", k.key, Buffer.from(enc.iv, "base64"));
  d.setAuthTag(Buffer.from(enc.tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(enc.data, "base64")), d.final()]).toString("utf8");
}

/** Which key opens `enc` — its id, or by trial for one written before ids. Null: none of ours. */
export function openWith(enc: Sealed): { plain: string; kid: string } | null {
  if (enc.kid) {
    const k = allKeys().find((x) => x.id === enc.kid);
    if (!k) return null;
    try { return { plain: tryOpen(enc, k), kid: k.id }; } catch { return null; }
  }
  for (const k of allKeys()) {
    try { return { plain: tryOpen(enc, k), kid: k.id }; } catch { /* the next key */ }
  }
  return null;
}

export function open(enc: Sealed): string {
  const got = openWith(enc);
  if (got) return got.plain;
  throw new KeyringError(enc.kid
    ? `This secret was encrypted with key ${enc.kid}, which isn't in TOKEN_ENCRYPTION_KEY or TOKEN_ENCRYPTION_KEY_PREVIOUS`
    : "No configured key opens this secret");
}

// ── Settings at rest ─────────────────────────────────────────────────────────
// API keys, client secrets, webhook secrets, service-account JSON and the SMTP
// login were plain text in Setting / WorkspaceSetting. They're sealed on write
// and opened on read by the db client (lib/db.ts), so every reader — getSetting
// and the pages that query the tables directly — sees the plain value, and a row
// written before this reads as it is. `*:refresh_token` rows are already sealed
// JSON by their callers and are left to them.

const PREFIX = "enc:v1:";
const SECRET_SETTING = /^(api_key:[\w.-]+|email:smtp|[\w.-]+:(api_key|client_secret|webhook_secret|service_account|password))$/;

export function isSecretSetting(key: string): boolean {
  return SECRET_SETTING.test(key);
}

export function isSealedSetting(value: string): boolean {
  return value.startsWith(PREFIX);
}

let warnedPlain = false;

/** The value to store for `key`: sealed when it's a secret and a key is configured. */
export function sealSetting(key: string, value: string): string {
  if (!value || !isSecretSetting(key) || isSealedSetting(value)) return value;
  if (!keyring().current) {
    if (!warnedPlain) { warnedPlain = true; console.warn("[keyring] TOKEN_ENCRYPTION_KEY is not set — secret settings are stored unencrypted"); }
    return value;
  }
  const s = seal(value);
  return `${PREFIX}${s.kid}:${s.iv}:${s.tag}:${s.data}`;
}

export function parseSealedSetting(value: string): Sealed | null {
  if (!isSealedSetting(value)) return null;
  const [kid, iv, tag, data] = value.slice(PREFIX.length).split(":");
  return kid && iv && tag && data !== undefined ? { kid, iv, tag, data } : null;
}

const warnedKids = new Set<string>();

/** The plain value of a stored setting. One no key opens reads as not set ("") — logged once per key id. */
export function openSetting(value: string): string {
  const s = parseSealedSetting(value);
  if (!s) return value;
  const got = openWith(s);
  if (got) return got.plain;
  if (!warnedKids.has(s.kid ?? "")) {
    warnedKids.add(s.kid ?? "");
    console.warn(`[keyring] a stored secret was encrypted with key ${s.kid}, which isn't configured — it reads as not set (Settings → Keyring)`);
  }
  return "";
}
