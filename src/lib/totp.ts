import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time codes (RFC 6238: HMAC-SHA1, 30-second steps, 6 digits) —
 * what every authenticator app speaks. Written on node:crypto rather than a
 * dependency, and checked against the RFC's test vectors (2026-10-29). Pure:
 * storage, replay and recovery codes' use live in lib/two-factor.ts.
 */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const STEP_MS = 30_000;

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of clean) {
    value = (value << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** A new shared secret: 20 random bytes, base32 (what authenticator apps take). */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The code for one 30-second step. */
export function codeAt(secret: Buffer, step: number, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", secret).update(counter).digest();
  const off = mac[mac.length - 1] & 0x0f;
  const n = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(n % 10 ** digits).padStart(digits, "0");
}

/**
 * The step a typed code matches — this one or one either side, for clock drift —
 * and only a step after `lastStep`, so a code can't be used twice. null = no match.
 */
export function matchStep(secretB32: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  const typed = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(typed)) return null;
  const key = base32Decode(secretB32);
  const step = Math.floor(now / STEP_MS);
  for (const s of [step - 1, step, step + 1]) {
    if (lastStep !== null && s <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(codeAt(key, s)), Buffer.from(typed))) return s;
  }
  return null;
}

/** The link an authenticator app opens (or the person copies the secret by hand). */
export function otpauthUri(secretB32: string, account: string, issuer: string): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** Ten single-use recovery codes, shown once; only their hashes are kept. */
export function newRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => {
    const s = base32Encode(randomBytes(7)).slice(0, 10);
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code.toUpperCase().replace(/[^A-Z2-7]/g, "")).digest("hex");
}
