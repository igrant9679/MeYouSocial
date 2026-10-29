import { headers } from "next/headers";
import { getRedis } from "@/lib/redis";
import { env } from "@/lib/env";

/**
 * Rate limits on the public and auth endpoints (E-SEC-10): sign-in, sign-up,
 * password reset, email verification, the webhooks and /api/v1. A fixed
 * window per bucket and caller, counted in Redis so every replica shares it,
 * and in this process when Redis isn't there (one replica — still a limit).
 * `RATE_LIMIT_PER_MINUTE` (default 60) sets the API's; the auth limits are
 * tighter and fixed here.
 */
export const LIMITS = {
  signinPerIp: { limit: 30, windowSec: 60 },
  signinPerEmail: { limit: 10, windowSec: 60 },
  signupPerIp: { limit: 10, windowSec: 60 },
  resetPerIp: { limit: 10, windowSec: 60 },
  resetPerEmail: { limit: 3, windowSec: 900 },
  tokenPerIp: { limit: 20, windowSec: 60 },
  resendPerUser: { limit: 3, windowSec: 900 },
  webhookPerIp: { limit: env.RATE_LIMIT_PER_MINUTE * 5, windowSec: 60 },
  apiPerUser: { limit: env.RATE_LIMIT_PER_MINUTE, windowSec: 60 },
} as const;
export type LimitName = keyof typeof LIMITS;

const memory = new Map<string, { n: number; resetAt: number }>();

/** Count one hit; `ok: false` once the window's limit is passed. Never throws — a broken counter lets the request through. */
export async function hit(name: LimitName, id: string): Promise<{ ok: boolean; retryAfter: number }> {
  const { limit, windowSec } = LIMITS[name];
  const now = Date.now();
  const slot = Math.floor(now / (windowSec * 1000));
  const retryAfter = Math.max(1, Math.ceil(((slot + 1) * windowSec * 1000 - now) / 1000));
  const key = `rl:${name}:${id.toLowerCase().slice(0, 200)}:${slot}`;
  const redis = getRedis();
  if (redis) {
    try {
      const n = Number(await redis.command("INCR", key));
      if (n === 1) await redis.command("EXPIRE", key, windowSec + 5);
      return { ok: n <= limit, retryAfter };
    } catch {
      // Fall through to this process's own count.
    }
  }
  if (memory.size > 10_000) for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
  const cur = memory.get(key);
  const n = cur && cur.resetAt > now ? cur.n + 1 : 1;
  memory.set(key, { n, resetAt: (slot + 1) * windowSec * 1000 });
  return { ok: n <= limit, retryAfter };
}

/** The caller's address as Railway's proxy passes it — the first x-forwarded-for hop. */
export function ipFrom(h: Headers): string {
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
}

export async function requestIp(): Promise<string> {
  return ipFrom(await headers());
}

/** A JSON 429 with Retry-After, for route handlers. */
export function tooMany(retryAfter: number): Response {
  return Response.json({ error: "Too many requests — try again shortly." }, { status: 429, headers: { "retry-after": String(retryAfter) } });
}
