// Next.js instrumentation hook — runs once when the Node server boots.
// Starts the periodic sweeps: autopilot, the social scheduler, the metrics
// rollup, and the analytics/social-performance pull.
//
// EVERY sweep runs inside a distributed lock (src/lib/lock.ts). Without one,
// each timer fires on every replica — and these are not harmless duplicates:
// the social sweep publishes to a real audience. The lock is held for the whole
// run, not just to elect a leader, and is per-sweep so a slow autopilot can't
// block the 60-second social tick.
//
// With REDIS_URL set the lock is cross-replica. Without it, it degrades to an
// in-process mutex — the previous behaviour, safe on one replica only — and
// says so loudly at boot.

// NOTE: nothing may be imported statically here that touches Node built-ins.
// Next compiles this file for the EDGE runtime as well as Node, and the lock
// reaches `node:net`/`node:tls`/`node:crypto` through the Redis client — which
// Edge has no implementation for. A static import puts those in the Edge graph
// and the build reports "Ecmascript file had an error" for each one, even
// though `register()` returns early off-Node and they are never executed.
// Everything below is therefore imported dynamically, AFTER the runtime guard.

type Guarded = (name: string, ttlMs: number, body: () => Promise<void>) => () => Promise<void>;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.AUTOPILOT === "off") {
    console.log("[autopilot] disabled via AUTOPILOT=off");
    return;
  }

  const globals = globalThis as unknown as {
    __autopilotTimer?: ReturnType<typeof setInterval>;
    __socialTimer?: ReturnType<typeof setInterval>;
    __metricsTimer?: ReturnType<typeof setInterval>;
    __accountHealthTimer?: ReturnType<typeof setInterval>;
    __analyticsTimer?: ReturnType<typeof setInterval>;
    __jobsTimer?: ReturnType<typeof setInterval>;
  };
  if (globals.__autopilotTimer) return; // HMR / double-register guard

  // Safe here: we're past the NEXT_RUNTIME guard, so this only ever loads on Node.
  const { withLock, lockBackend } = await import("@/lib/lock");
  console.log(`[lock] sweep locking backend: ${lockBackend()}`);

  /**
   * Wrap a sweep so it (a) takes the lock, (b) never throws into the timer, and
   * (c) stays quiet when it simply lost the race — on a multi-replica
   * deployment the losing replicas skip every tick, and logging that would
   * drown the logs it shares with the work that actually ran.
   */
  const guarded: Guarded = (name, ttlMs, body) => async () => {
    try {
      const out = await withLock(name, body, { ttlMs });
      if (!out.ran && out.reason === "unavailable") {
        console.warn(`[${name}] skipped — lock store unreachable; will retry next tick`);
      }
    } catch (e) {
      console.error(`[${name}] sweep failed:`, e instanceof Error ? e.message : e);
    }
  };

  const intervalMin = Math.max(5, parseInt(process.env.AUTOPILOT_INTERVAL_MIN ?? "30", 10) || 30);
  const { runAutopilotSweep } = await import("@/lib/blog-autopilot");

  // TTL exceeds any plausible run; the heartbeat extends it if one runs long,
  // and a hard-killed replica frees the lock within the TTL rather than after
  // however long the job might have taken.
  const sweep = guarded("autopilot", 10 * 60_000, async () => {
    await runAutopilotSweep();
  });

  // First sweep shortly after boot (let migrations/seed settle), then steady.
  setTimeout(sweep, 2 * 60 * 1000);
  globals.__autopilotTimer = setInterval(sweep, intervalMin * 60 * 1000);
  console.log(`[autopilot] scheduler armed — every ${intervalMin} min`);

  // Social scheduler runs on its own tighter cadence so scheduled posts publish
  // close to their time (the autopilot's 30-min cadence would be too coarse).
  const socialSec = Math.max(30, parseInt(process.env.SOCIAL_SWEEP_SEC ?? "60", 10) || 60);
  // The one sweep with an irreversible side effect: it posts publicly. TTL is
  // kept under the tick interval's own safety margin but well above a normal
  // run, and `publishDueSocialPosts` ALSO makes an atomic per-post status claim
  // — belt and braces, because a duplicate here reaches a real audience.
  const socialSweep = guarded("social", 5 * 60_000, async () => {
    const { publishDueSocialPosts } = await import("@/lib/social/publish");
    const n = await publishDueSocialPosts();
    if (n > 0) console.log(`[social] published ${n} due post(s)`);
    // Evergreen refill rides the same lock: it writes scheduled posts, so it
    // must never race the publisher or run on two replicas at once. Opt-in per
    // workspace (social:evergreen_fill) — the sweep no-ops cheaply otherwise.
    const { recycleEvergreenPosts } = await import("@/lib/social/evergreen");
    const r = await recycleEvergreenPosts();
    if (r > 0) console.log(`[social] recycled ${r} evergreen post(s) into free slots`);
  });
  globals.__socialTimer = setInterval(socialSweep, socialSec * 1000);
  console.log(`[social] scheduler armed — every ${socialSec}s`);

  // Background-job worker. Two responsibilities, both impossible before the
  // queue became durable: requeue jobs abandoned mid-run (a redeploy kills the
  // container that was executing them) and pick up anything enqueued by a
  // process that has since gone away.
  //
  // ⚠ Handlers must be registered HERE. They are otherwise registered as a side
  // effect of importing a server-action module, and this boot path imports
  // none — so a claimed row would find no handler and fail as a "deploy
  // problem" that isn't one.
  const jobsSec = Math.max(10, parseInt(process.env.JOBS_SWEEP_SEC ?? "20", 10) || 20);
  const { registerAllJobs, jobs } = await import("@/lib/jobs");
  await registerAllJobs();
  // TTL comfortably exceeds a bounded sweep (5 jobs) of slow LLM work. A tick
  // that arrives while one is still running simply loses the lock and skips,
  // which is the intended behaviour rather than a queue-up.
  const jobsSweep = guarded("jobs", 15 * 60_000, async () => {
    const { recovered, ran } = await jobs.sweep();
    if (recovered || ran) console.log(`[jobs] swept — ${recovered} recovered, ${ran} run`);
  });
  // Runs promptly at boot ON PURPOSE: the jobs most needing recovery are the
  // ones the restart just interrupted.
  setTimeout(jobsSweep, 15 * 1000);
  globals.__jobsTimer = setInterval(jobsSweep, jobsSec * 1000);
  console.log(`[jobs] worker armed — every ${jobsSec}s`);

  // Metrics rollup — freezes point-in-time values (WIP, stalls) so trends have a
  // real history. Upserts per (workspace, day, metric), so running it several
  // times a day just refreshes today's row; hourly keeps it current on a
  // long-lived process without waiting for a restart.
  const metricsMin = Math.max(15, parseInt(process.env.METRICS_ROLLUP_MIN ?? "60", 10) || 60);
  const metricsSweep = guarded("metrics", 10 * 60_000, async () => {
    const { rollupAllWorkspaces } = await import("@/lib/metrics/rollup");
    const { workspaces, rows } = await rollupAllWorkspaces();
    console.log(`[metrics] rolled up ${rows} metric row(s) across ${workspaces} workspace(s)`);
    // Recommendations ride the same cadence: they're derived from the metrics
    // that were just refreshed, so generating here keeps the two consistent.
    // They share the lock too — auto-apply must not run twice.
    const { sweepRecommendations } = await import("@/lib/recommendations");
    const { created, applied } = await sweepRecommendations();
    if (created || applied) {
      console.log(`[recommendations] ${created} new, ${applied} auto-applied`);
    }
  });
  setTimeout(metricsSweep, 3 * 60 * 1000);
  globals.__metricsTimer = setInterval(metricsSweep, metricsMin * 60 * 1000);
  console.log(`[metrics] rollup armed — every ${metricsMin} min`);

  // Social account health — reads each workspace's accounts back from Zernio
  // and notifies when one STOPS being able to publish. Without this the first
  // sign of a dead token is a failed post, which is how CommunityForce's
  // Facebook outage was found twice in one day on 2026-08-07.
  //
  // Half-hourly: it's one listing call per workspace, and a token that dies
  // now matters at the next slot, not the next second. It shares no lock with
  // the publisher because it only ever writes account rows.
  const healthMin = Math.max(10, parseInt(process.env.ACCOUNT_HEALTH_MIN ?? "30", 10) || 30);
  const healthSweep = guarded("account-health", 5 * 60_000, async () => {
    const { sweepAccountHealth } = await import("@/lib/social/account-health");
    const { workspaces, alerted } = await sweepAccountHealth();
    if (alerted > 0) console.log(`[account-health] ${alerted} account(s) newly broken across ${workspaces} workspace(s)`);
  });
  setTimeout(healthSweep, 90 * 1000);
  globals.__accountHealthTimer = setInterval(healthSweep, healthMin * 60 * 1000);
  console.log(`[account-health] armed — every ${healthMin} min`);

  // Analytics sync (Search Console / GA4 → BlogSnapshot). Its own, slower
  // cadence: GSC data lags ~2 days and is revised for a while, so polling it
  // hourly would burn quota to re-fetch the same numbers. No-ops cheaply when
  // no workspace has a connector configured.
  const syncMin = Math.max(30, parseInt(process.env.ANALYTICS_SYNC_MIN ?? "360", 10) || 360);
  // Longest TTL of the four: these make many sequential external API calls.
  const analyticsSweep = guarded("analytics", 20 * 60_000, async () => {
    try {
      const { syncAllWorkspaces } = await import("@/lib/analytics/sync");
      const { workspaces, rowsWritten } = await syncAllWorkspaces();
      if (workspaces > 0) {
        console.log(`[analytics] synced ${rowsWritten} snapshot row(s) across ${workspaces} connected workspace(s)`);
      }
    } catch (e) {
      console.error("[analytics] sync failed:", e instanceof Error ? e.message : e);
    }
    // Social engagement rides the same cadence rather than taking a fifth
    // timer: it's the same job (pull external performance in, feed the spine),
    // and every extra timer is another thing that double-fires the day a second
    // replica appears. Isolated in its own try so a Unipile outage can't stop
    // the GSC/GA4 half from having run.
    try {
      const { syncAllWorkspacesSocialPerformance } = await import("@/lib/social/performance");
      const { workspaces, rowsWritten } = await syncAllWorkspacesSocialPerformance();
      if (rowsWritten > 0) {
        console.log(`[social-perf] pulled ${rowsWritten} engagement row(s) across ${workspaces} workspace(s)`);
      }
    } catch (e) {
      console.error("[social-perf] sync failed:", e instanceof Error ? e.message : e);
    }
  });
  setTimeout(analyticsSweep, 5 * 60 * 1000);
  globals.__analyticsTimer = setInterval(analyticsSweep, syncMin * 60 * 1000);
  console.log(`[analytics] sync armed — every ${syncMin} min`);
}
