import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// How the website proves a call is its own (2026-11-26): HMAC-SHA256 over "<unix seconds>.<raw body>"
// with the secret the operator made on Settings → Sign-ups, sent as
//   X-MeYouSocial-Signature: t=1764158400,v1=5f2b…(64 hex)
// The same scheme Stripe uses, so any language's standard library can make it. A signature more
// than five minutes from Publisher's clock is refused (a replayed call), and each event id is
// applied once (lib/membership/process.ts).

export const SIGNATURE_HEADER = "x-meyousocial-signature";
export const SIGNATURE_TOLERANCE_SEC = 300;

export const SECRET_KEY = "membership:webhook_secret";
/** The secret before the last "Make a new secret" — still accepted for a day, so the website can catch up. */
export const PREVIOUS_SECRET_KEY = "membership_previous:webhook_secret";
export const ROTATED_AT_KEY = "membership:webhook_secret_rotated_at";
export const PREVIOUS_SECRET_GRACE_MS = 24 * 3_600_000;

export function signatureFor(secret: string, body: string, t: number): string {
  return createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
}

/** The header value for `body` — what the website sends (and what the tests and examples use). */
export function signBody(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${signatureFor(secret, body, t)}`;
}

export type SignatureCheck = { ok: true; t: number } | { ok: false; why: "missing" | "malformed" | "stale" | "mismatch" };

/** Check a header against one or more secrets (the current one, and the previous one during its grace day). */
export function verifySignature(
  secrets: string[],
  header: string | null | undefined,
  body: string,
  nowSec = Math.floor(Date.now() / 1000),
  toleranceSec = SIGNATURE_TOLERANCE_SEC,
): SignatureCheck {
  if (!header?.trim()) return { ok: false, why: "missing" };
  let t: number | null = null;
  const given: string[] = [];
  for (const part of header.split(",")) {
    const [k, ...rest] = part.trim().split("=");
    const v = rest.join("=").trim();
    if (k === "t" && /^\d{9,12}$/.test(v)) t = Number(v);
    else if (k === "v1" && /^[0-9a-f]{64}$/i.test(v)) given.push(v.toLowerCase());
  }
  if (t == null || given.length === 0) return { ok: false, why: "malformed" };
  if (Math.abs(nowSec - t) > toleranceSec) return { ok: false, why: "stale" };
  for (const secret of secrets.filter(Boolean)) {
    const want = Buffer.from(signatureFor(secret, body, t), "hex");
    if (given.some((g) => timingSafeEqual(Buffer.from(g, "hex"), want))) return { ok: true, t };
  }
  return { ok: false, why: "mismatch" };
}

/** A new shared secret: 32 random bytes, recognisable by its prefix. */
export function newSecret(): string {
  return `mys_whsec_${randomBytes(32).toString("base64url")}`;
}

/** A short public fingerprint of a secret — to tell two apart without showing either. */
export function secretFingerprint(secret: string): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 8);
}
