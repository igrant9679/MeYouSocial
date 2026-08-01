import { env } from "@/lib/env";

// Background-job interface (agents, onboarding).
//
// ⚠ READ THIS BEFORE CHANGING THE BACKEND.
//
// Until 2026-07-31 this file exported an in-memory Map queue unconditionally,
// while `JOB_BACKEND=redis` sat in production being read by nothing and four
// docs claimed BullMQ+Redis. The consequences were not theoretical:
//
//   • Every redeploy destroyed all queued and running jobs, silently.
//   • `status()` then returned null forever for those ids.
//   • A handler that threw recorded its error into a field nothing read, so
//     "failed" and "still working" were indistinguishable in the UI —
//     permanently, since the wizard infers progress from row counts.
//
// The durable backend is Postgres, not Redis. There is no BullMQ here: this
// repo hand-rolls its Redis client (src/lib/redis.ts) and pulling in BullMQ +
// ioredis for one queue would be the heaviest dependency in the tree. The UI
// has to RENDER job state, which needs a queryable row whatever the transport,
// and the DB is already the system of record.
//
// DEFAULT IS DURABLE. `JOB_BACKEND=memory` is opt-in, for tests and for dev
// without a database — the same rule the mock flags follow (default to the real
// thing, so a correct deployment needs no env archaeology).

export type JobHandler<TPayload = unknown> = (payload: TPayload, ctx: JobContext) => Promise<void>;

export type JobContext = {
  id: string;
  progress: (n: number) => Promise<void>;
  log: (message: string) => void;
};

export type JobState = "queued" | "running" | "done" | "failed";

export type JobStatus = {
  id: string;
  name: string;
  progress: number;
  state: JobState;
  error?: string;
  attempts?: number;
  finishedAt?: Date | null;
};

export type EnqueueOptions = {
  /** The entity this job is about (channelId, agent runId) — indexed, so a page
   *  can ask how the job for THIS entity ended without scanning payloads. */
  refId?: string;
  workspaceId?: string;
  maxAttempts?: number;
};

export interface JobQueue {
  register<TPayload>(name: string, handler: JobHandler<TPayload>): void;
  enqueue<TPayload>(name: string, payload: TPayload, opts?: EnqueueOptions): Promise<string>;
  status(id: string): Promise<JobStatus | null>;
  /** Latest job of a given name for an entity. Null when none was ever queued. */
  latestFor(name: string, refId: string): Promise<JobStatus | null>;
  /** Requeue jobs abandoned mid-run (killed replica), then run what's waiting.
   *  No-op on the memory queue, which has nothing to recover. */
  sweep(): Promise<{ recovered: number; ran: number }>;
}

// ── Handler registry ─────────────────────────────────────────────────────────
// Shared by both backends and kept at module scope: handlers are registered by
// whichever action module gets imported first, and the sweeper registers them
// all explicitly at boot (see registerAllJobs).
const handlers = new Map<string, JobHandler<unknown>>();

// ── Memory backend (opt-in) ──────────────────────────────────────────────────

type MemoryRecord = { id: string; name: string; payload: unknown; state: JobState; progress: number; error?: string; refId?: string };

class MemoryQueue implements JobQueue {
  private jobs = new Map<string, MemoryRecord>();

  register<TPayload>(name: string, handler: JobHandler<TPayload>): void {
    handlers.set(name, handler as JobHandler<unknown>);
  }

  async enqueue<TPayload>(name: string, payload: TPayload, opts?: EnqueueOptions): Promise<string> {
    const id = "job_" + Math.random().toString(36).slice(2, 12);
    const rec: MemoryRecord = { id, name, payload, state: "queued", progress: 0, refId: opts?.refId };
    this.jobs.set(id, rec);
    void this.run(rec); // fire-and-forget; must not block the request path
    return id;
  }

  private async run(rec: MemoryRecord) {
    const handler = handlers.get(rec.name);
    if (!handler) {
      rec.state = "failed";
      rec.error = `No handler for ${rec.name}`;
      return;
    }
    rec.state = "running";
    try {
      await handler(rec.payload, {
        id: rec.id,
        progress: async (n) => { rec.progress = Math.max(0, Math.min(1, n)); },
        log: (m) => { if (env.LOG_LEVEL === "debug") console.log(`[job ${rec.id}]`, m); },
      });
      rec.state = "done";
      rec.progress = 1;
    } catch (e) {
      rec.state = "failed";
      rec.error = e instanceof Error ? e.message : String(e);
    }
  }

  async status(id: string): Promise<JobStatus | null> {
    const r = this.jobs.get(id);
    return r ? { id: r.id, name: r.name, progress: r.progress, state: r.state, error: r.error } : null;
  }

  async latestFor(name: string, refId: string): Promise<JobStatus | null> {
    let found: MemoryRecord | null = null;
    for (const r of this.jobs.values()) if (r.name === name && r.refId === refId) found = r;
    return found ? { id: found.id, name: found.name, progress: found.progress, state: found.state, error: found.error } : null;
  }

  async sweep() { return { recovered: 0, ran: 0 }; }
}

// ── Postgres backend (default) ───────────────────────────────────────────────

/** A job still `running` with a claim older than this was abandoned — almost
 *  always by a redeploy killing the container mid-run. Comfortably longer than
 *  any real job (the LLM calls time out at 45s; a storyboard render is minutes)
 *  so a slow job is never mistaken for a dead one. */
const STALE_CLAIM_MS = 15 * 60_000;

/** Bounded per sweep so one tick can't monopolise the process, and so the
 *  lock the sweeper holds is released on a predictable cadence. */
const MAX_PER_SWEEP = 5;

const INSTANCE_ID = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

class DbQueue implements JobQueue {
  register<TPayload>(name: string, handler: JobHandler<TPayload>): void {
    handlers.set(name, handler as JobHandler<unknown>);
  }

  async enqueue<TPayload>(name: string, payload: TPayload, opts?: EnqueueOptions): Promise<string> {
    const { db } = await import("@/lib/db");
    const job = await db.job.create({
      data: {
        name,
        payload: JSON.stringify(payload ?? {}),
        refId: opts?.refId ?? null,
        workspaceId: opts?.workspaceId ?? null,
        ...(opts?.maxAttempts ? { maxAttempts: opts.maxAttempts } : {}),
      },
      select: { id: true },
    });

    // Run it now, in this process, exactly as the old queue did — the request
    // path stays non-blocking and the user sees progress immediately. The
    // difference is that the row survives if this attempt dies: the sweeper
    // finds it either as `queued` (never started) or as a stale `running`.
    void this.attempt(job.id).catch(() => {});
    return job.id;
  }

  /** Atomically take a queued job. Returns false if another worker won it. */
  private async claim(id: string): Promise<boolean> {
    const { db } = await import("@/lib/db");
    const now = new Date();
    // The whole safety argument for multi-replica sweeping lives in this WHERE:
    // only a row still in `queued` is updated, and Postgres serialises it, so
    // exactly one caller sees count === 1.
    const { count } = await db.job.updateMany({
      where: { id, state: "queued" },
      data: { state: "running", claimedAt: now, claimedBy: INSTANCE_ID, startedAt: now, attempts: { increment: 1 } },
    });
    return count === 1;
  }

  private async attempt(id: string): Promise<boolean> {
    const { db } = await import("@/lib/db");
    if (!(await this.claim(id))) return false;

    const job = await db.job.findUnique({ where: { id } });
    if (!job) return false;

    const handler = handlers.get(job.name);
    if (!handler) {
      // Not retryable: a missing handler is a deploy problem, not a transient
      // one, and burning the attempt budget on it just delays the diagnosis.
      await db.job.update({
        where: { id },
        data: { state: "failed", error: `No handler registered for "${job.name}"`, finishedAt: new Date() },
      });
      console.error(`[jobs] no handler for ${job.name} (job ${id})`);
      return false;
    }

    let payload: unknown = {};
    try {
      payload = JSON.parse(job.payload);
    } catch {
      await db.job.update({
        where: { id },
        data: { state: "failed", error: "Payload is not valid JSON", finishedAt: new Date() },
      });
      return false;
    }

    try {
      await handler(payload, {
        id,
        progress: async (n) => {
          // ⚠ Doubles as a HEARTBEAT. recoverStalled() treats an old `claimedAt`
          // as "the container died mid-run"; without refreshing it here, a job
          // legitimately running longer than STALE_CLAIM_MS would be requeued
          // underneath itself and executed twice. Every handler reports progress
          // at least at its start and end.
          await db.job
            .update({ where: { id }, data: { progress: Math.max(0, Math.min(1, n)), claimedAt: new Date() } })
            .catch(() => {}); // progress is telemetry; never fail a job over it
        },
        log: (m) => {
          if (env.LOG_LEVEL === "debug") console.log(`[job ${id}]`, m);
          void db.job.update({ where: { id }, data: { lastLog: m.slice(0, 500) } }).catch(() => {});
        },
      });
      await db.job.update({
        where: { id },
        data: { state: "done", progress: 1, error: null, finishedAt: new Date() },
      });
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message.slice(0, 1000) : String(e).slice(0, 1000);
      const fresh = await db.job.findUnique({ where: { id }, select: { attempts: true, maxAttempts: true } });
      const exhausted = (fresh?.attempts ?? 1) >= (fresh?.maxAttempts ?? 3);
      await db.job.update({
        where: { id },
        data: exhausted
          ? { state: "failed", error: message, finishedAt: new Date() }
          : // Back to queued and left for the sweeper rather than retried in a
            // tight loop here: whatever failed (an API 5xx, a rate limit) is
            // likelier to have cleared a tick later than a millisecond later.
            { state: "queued", error: message, claimedAt: null, claimedBy: null },
      });
      console.warn(`[jobs] ${job.name} (${id}) ${exhausted ? "FAILED" : "will retry"}: ${message}`);
      return false;
    }
  }

  async status(id: string): Promise<JobStatus | null> {
    const { db } = await import("@/lib/db");
    const j = await db.job.findUnique({ where: { id } });
    return j ? toStatus(j) : null;
  }

  async latestFor(name: string, refId: string): Promise<JobStatus | null> {
    const { db } = await import("@/lib/db");
    const j = await db.job.findFirst({ where: { name, refId }, orderBy: { createdAt: "desc" } });
    return j ? toStatus(j) : null;
  }

  async sweep(): Promise<{ recovered: number; ran: number }> {
    const { db } = await import("@/lib/db");

    // 1. Requeue anything abandoned mid-run. This is the redeploy-survival
    //    property: the container that was executing these no longer exists.
    const cutoff = new Date(Date.now() - STALE_CLAIM_MS);
    const stalled = await db.job.findMany({
      where: { state: "running", claimedAt: { lt: cutoff } },
      select: { id: true, name: true, attempts: true, maxAttempts: true },
      take: 50,
    });
    let recovered = 0;
    for (const s of stalled) {
      const exhausted = s.attempts >= s.maxAttempts;
      await db.job.update({
        where: { id: s.id },
        data: exhausted
          ? { state: "failed", error: "Interrupted and out of attempts (the server most likely restarted mid-run).", finishedAt: new Date() }
          : { state: "queued", claimedAt: null, claimedBy: null, error: "Interrupted mid-run — requeued." },
      });
      recovered++;
      console.warn(`[jobs] recovered stalled ${s.name} (${s.id}) → ${exhausted ? "failed" : "queued"}`);
    }

    // 2. Run what's waiting, oldest first.
    const queued = await db.job.findMany({
      where: { state: "queued" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
      take: MAX_PER_SWEEP,
    });
    let ran = 0;
    for (const q of queued) {
      if (await this.attempt(q.id)) ran++;
    }
    return { recovered, ran };
  }
}

type JobRow = {
  id: string; name: string; progress: number; state: string;
  error: string | null; attempts: number; finishedAt: Date | null;
};

function toStatus(j: JobRow): JobStatus {
  return {
    id: j.id,
    name: j.name,
    progress: j.progress,
    state: j.state as JobState,
    error: j.error ?? undefined,
    attempts: j.attempts,
    finishedAt: j.finishedAt,
  };
}

// ── Selection ────────────────────────────────────────────────────────────────

function pickBackend(): JobQueue {
  const configured = env.JOB_BACKEND;
  if (configured === "memory") return new MemoryQueue();
  if (configured === "redis") {
    // Kept working rather than thrown, because this exact value is set in
    // production today. It never meant anything: no Redis queue was ever
    // implemented. Say so once, loudly, instead of pretending.
    console.warn(
      "[jobs] JOB_BACKEND=redis is obsolete — no Redis queue was ever implemented and the value was read by nothing. " +
        "Using the durable Postgres queue. Set JOB_BACKEND=db (or remove it) to silence this.",
    );
  }
  return new DbQueue();
}

// Singleton across HMR reloads in dev AND across module instances in prod.
// ⚠ The old code only stashed this off-production, so separate bundles could
// each get their own queue — harmless with a Map per process, actively wrong
// once handlers must be findable by whichever instance claims a row.
const globalForJobs = globalThis as unknown as { __jobs?: JobQueue };
export const jobs: JobQueue = globalForJobs.__jobs ?? pickBackend();
globalForJobs.__jobs = jobs;

/**
 * Register every handler in this process. The sweeper must call this: handlers
 * are otherwise registered as a side effect of importing an action module, and
 * the boot path imports none of them — so a claimed job would find no handler
 * and fail as a "deploy problem" that isn't one.
 */
export async function registerAllJobs(): Promise<void> {
  const [{ registerOnboardingJobs }, { registerAgentJobs }] = await Promise.all([
    import("@/lib/jobs/onboarding"),
    import("@/lib/jobs/agent"),
  ]);
  registerOnboardingJobs();
  registerAgentJobs();
}
