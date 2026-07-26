import { randomUUID } from "node:crypto";
import { getRedis } from "@/lib/redis";

/**
 * Distributed lock for the background sweeps.
 *
 * ── The problem ─────────────────────────────────────────────────────────────
 * `instrumentation.ts` arms four timers on boot: autopilot (30 min), social
 * (60 s), metrics (60 min) and analytics/social-performance (360 min). They
 * were written assuming ONE replica, which Railway currently runs. The moment a
 * second instance exists, every timer fires on both — and these aren't harmless
 * duplicates: the social sweep publishes posts, so a double-fire is a
 * double-post to someone's real audience.
 *
 * ── The design ──────────────────────────────────────────────────────────────
 * A lock is held for the WHOLE DURATION of a sweep, not just long enough to
 * elect a leader. Per-sweep rather than one global leader, so a slow autopilot
 * run can't block the 60-second social tick.
 *
 * Acquire is `SET key <token> NX PX ttl` — atomic by construction. The token is
 * unique per acquisition, and release is a Lua compare-and-delete, so a holder
 * whose lock already expired can never delete the lock a different replica has
 * since taken. That check-then-act is the classic way to break a lock, and it
 * has to be atomic on the server.
 *
 * A HEARTBEAT extends the TTL while work is in progress. That lets the TTL stay
 * short — a replica killed mid-sweep frees the lock in `ttl`, not in however
 * long the job might have taken — without risking expiry under a slow run.
 *
 * ── Honest limits ───────────────────────────────────────────────────────────
 * This is single-instance Redis, so it inherits that failure model: if Redis
 * fails over, two holders are briefly possible. That is a deliberate trade —
 * Redlock across independent nodes would be the alternative, and this
 * deployment has exactly one Redis. For these sweeps the cost of a rare
 * double-run is bounded (the social publisher additionally makes an atomic
 * status claim per post, so a duplicate send is guarded a second time), whereas
 * the cost of the current no-locking situation is unbounded.
 *
 * WITHOUT `REDIS_URL` the lock degrades to an in-process mutex, which protects
 * a single replica only. That is the status quo, so it is never worse — but it
 * is announced loudly at boot, because silently providing no protection is how
 * this bites someone later.
 */

/** Compare-and-delete: only the current holder may release. */
const RELEASE_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
/** Compare-and-extend: only the current holder may push the expiry out. */
const EXTEND_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";

const PREFIX = "meyousocial:lock:";
/** Short enough that a hard kill frees the lock quickly; heartbeat covers long runs. */
export const DEFAULT_TTL_MS = 60_000;

/** In-process fallback: names currently held by this process. */
const localHeld = new Set<string>();

let warned = false;
function warnNoRedis() {
  if (warned) return;
  warned = true;
  console.warn(
    "[lock] REDIS_URL is not set — sweeps are guarded by an in-process mutex only. " +
      "This is safe on ONE replica and provides NO protection across replicas. " +
      "Set REDIS_URL to make scaling out safe.",
  );
}

export type LockOutcome<T> =
  | { ran: true; result: T }
  /** Someone else holds it, or the lock store couldn't be reached. */
  | { ran: false; reason: "held-elsewhere" | "unavailable" };

/**
 * Run `fn` while holding `name`, or skip if another holder has it.
 *
 * Never throws on lock-infrastructure problems — a Redis outage must not stop
 * the app booting or wedge a timer. It reports `unavailable` and skips the run;
 * the next tick tries again. Errors thrown by `fn` itself DO propagate (after
 * the lock is released), because those are the caller's business.
 */
export async function withLock<T>(
  name: string,
  fn: () => Promise<T>,
  opts: { ttlMs?: number } = {},
): Promise<LockOutcome<T>> {
  const ttlMs = Math.max(5_000, opts.ttlMs ?? DEFAULT_TTL_MS);
  const redis = getRedis();

  if (!redis) {
    warnNoRedis();
    if (localHeld.has(name)) return { ran: false, reason: "held-elsewhere" };
    localHeld.add(name);
    try {
      return { ran: true, result: await fn() };
    } finally {
      localHeld.delete(name);
    }
  }

  const key = PREFIX + name;
  const token = randomUUID();

  let acquired: unknown;
  try {
    acquired = await redis.command("SET", key, token, "NX", "PX", ttlMs);
  } catch (e) {
    // Fail OPEN would double-run; fail CLOSED skips this tick. For periodic
    // sweeps, skipping is plainly the safer of the two.
    console.error(`[lock] could not reach Redis for "${name}":`, e instanceof Error ? e.message : e);
    return { ran: false, reason: "unavailable" };
  }
  if (acquired === null) return { ran: false, reason: "held-elsewhere" };

  // Refresh at a third of the TTL: two consecutive heartbeats can fail before
  // the lock is at risk of lapsing under us.
  const heartbeat = setInterval(() => {
    void redis.command("EVAL", EXTEND_LUA, 1, key, token, ttlMs).catch((e) => {
      console.error(`[lock] heartbeat failed for "${name}":`, e instanceof Error ? e.message : e);
    });
  }, Math.floor(ttlMs / 3));
  // Never let the heartbeat hold the process open.
  heartbeat.unref?.();

  try {
    return { ran: true, result: await fn() };
  } finally {
    clearInterval(heartbeat);
    try {
      await redis.command("EVAL", RELEASE_LUA, 1, key, token);
    } catch (e) {
      // Not fatal: the TTL will clear it. Worst case the next tick is skipped.
      console.error(`[lock] release failed for "${name}" (TTL will clear it):`, e instanceof Error ? e.message : e);
    }
  }
}

/** Whether cross-replica locking is actually in force. Surfaced in the UI. */
export function lockBackend(): "redis" | "in-process" {
  return getRedis() ? "redis" : "in-process";
}

/** Liveness check for the admin surface. */
export async function checkLockBackend(): Promise<{ ok: boolean; backend: string; detail: string }> {
  const redis = getRedis();
  if (!redis) {
    return {
      ok: false,
      backend: "in-process",
      detail: "REDIS_URL isn't set. Sweeps are guarded within this instance only — safe on one replica, unsafe if you scale out.",
    };
  }
  try {
    const pong = await redis.ping();
    return { ok: true, backend: "redis", detail: `Redis reachable (PING → ${pong}). Sweeps are safe across replicas.` };
  } catch (e) {
    return { ok: false, backend: "redis", detail: `REDIS_URL is set but unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }
}
