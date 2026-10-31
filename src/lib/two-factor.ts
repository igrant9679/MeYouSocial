import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { encryptSecret, decryptSecret, type Encrypted } from "@/lib/blog-crypto";
import { matchStep, hashRecoveryCode } from "@/lib/totp";

/**
 * Two-factor sign-in (E-SEC-07). A person turns it on from their own settings
 * (/account/two-factor); a workspace can require it of its admins
 * (`security:require_2fa_admins`). Sign-in is two steps: the password, then a
 * code — the first step leaves a five-minute signed token in a cookie, so the
 * password is never asked for twice or carried anywhere.
 */
export const PENDING_COOKIE = "mys.2fa_pending";
export const PENDING_MS = 5 * 60_000;
export const REQUIRE_SETTING = "security:require_2fa_admins";
/** New recovery codes on their way to the page (encrypted, two minutes, path-scoped). */
export const CODES_COOKIE = "mys.2fa_codes";

type TwoFactorUser = { id: string; totpSecret: string | null; totpEnabledAt: Date | null; totpLastStep: number | null; totpRecovery: string | null };

function sign(payload: string): string {
  return createHmac("sha256", `2fa:${env.AUTH_SECRET}`).update(payload).digest("base64url");
}

/** The token the password step leaves: the user and an expiry, signed with AUTH_SECRET. */
export function pendingToken(userId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, exp: now + PENDING_MS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** The user a pending token names, or null when it's forged or expired. */
export function readPending(token: string, now = Date.now()): string | null {
  const [payload, mac] = token.split(".");
  if (!payload || !mac || !env.AUTH_SECRET) return null;
  const want = Buffer.from(sign(payload));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u?: string; exp?: number };
    return u && typeof exp === "number" && exp > now ? u : null;
  } catch {
    return null;
  }
}

export function storeSecret(secretB32: string): string {
  return JSON.stringify(encryptSecret(secretB32));
}

export function readSecret(stored: string | null): string | null {
  if (!stored) return null;
  try { return decryptSecret(JSON.parse(stored) as Encrypted); } catch { return null; }
}

/**
 * Does `code` pass for this person? An authenticator code is accepted once (the
 * step is claimed in a conditional update); a recovery code is removed as it's
 * used, also conditionally, so two requests can't both spend it.
 */
export async function checkSecondFactor(user: TwoFactorUser, code: string): Promise<boolean> {
  const secret = readSecret(user.totpSecret);
  if (!secret) return false;
  const step = matchStep(secret, code, user.totpLastStep);
  if (step !== null) {
    const { count } = await db.user.updateMany({ where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } });
    return count === 1;
  }
  // A recovery code is ten base32 characters (shown as XXXXX-XXXXX).
  if (code.toUpperCase().replace(/[^A-Z2-7]/g, "").length !== 10 || !user.totpRecovery) return false;
  const hashes = JSON.parse(user.totpRecovery) as string[];
  const h = hashRecoveryCode(code);
  if (!hashes.includes(h)) return false;
  const { count } = await db.user.updateMany({ where: { id: user.id, totpRecovery: user.totpRecovery }, data: { totpRecovery: JSON.stringify(hashes.filter((x) => x !== h)) } });
  return count === 1;
}

export function recoveryLeft(user: { totpRecovery: string | null }): number {
  try { return user.totpRecovery ? (JSON.parse(user.totpRecovery) as string[]).length : 0; } catch { return 0; }
}
