// Next.js instrumentation hook — runs once when the Node server boots.
// Starts the Phase-3 autopilot scheduler: a periodic sweep that runs each
// workspace's autopilot cycle according to its mode dial (manual/assisted/auto)
// and global pause. Single-replica by design (Railway runs one instance); a
// Redis-locked multi-replica scheduler is a future hardening step.

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
  };
  if (globals.__autopilotTimer) return; // HMR / double-register guard

  const intervalMin = Math.max(5, parseInt(process.env.AUTOPILOT_INTERVAL_MIN ?? "30", 10) || 30);
  const { runAutopilotSweep } = await import("@/lib/blog-autopilot");

  const sweep = async () => {
    try {
      await runAutopilotSweep();
    } catch (e) {
      console.error("[autopilot] sweep failed:", e instanceof Error ? e.message : e);
    }
  };

  // First sweep shortly after boot (let migrations/seed settle), then steady.
  setTimeout(sweep, 2 * 60 * 1000);
  globals.__autopilotTimer = setInterval(sweep, intervalMin * 60 * 1000);
  console.log(`[autopilot] scheduler armed — every ${intervalMin} min`);

  // Social scheduler runs on its own tighter cadence so scheduled posts publish
  // close to their time (the autopilot's 30-min cadence would be too coarse).
  const socialSec = Math.max(30, parseInt(process.env.SOCIAL_SWEEP_SEC ?? "60", 10) || 60);
  const socialSweep = async () => {
    try {
      const { publishDueSocialPosts } = await import("@/lib/social/publish");
      const n = await publishDueSocialPosts();
      if (n > 0) console.log(`[social] published ${n} due post(s)`);
    } catch (e) {
      console.error("[social] sweep failed:", e instanceof Error ? e.message : e);
    }
  };
  globals.__socialTimer = setInterval(socialSweep, socialSec * 1000);
  console.log(`[social] scheduler armed — every ${socialSec}s`);

  // Metrics rollup — freezes point-in-time values (WIP, stalls) so trends have a
  // real history. Upserts per (workspace, day, metric), so running it several
  // times a day just refreshes today's row; hourly keeps it current on a
  // long-lived process without waiting for a restart.
  const metricsMin = Math.max(15, parseInt(process.env.METRICS_ROLLUP_MIN ?? "60", 10) || 60);
  const metricsSweep = async () => {
    try {
      const { rollupAllWorkspaces } = await import("@/lib/metrics/rollup");
      const { workspaces, rows } = await rollupAllWorkspaces();
      console.log(`[metrics] rolled up ${rows} metric row(s) across ${workspaces} workspace(s)`);
      // Recommendations ride the same cadence: they're derived from the metrics
      // that were just refreshed, so generating here keeps the two consistent.
      const { sweepRecommendations } = await import("@/lib/recommendations");
      const { created, applied } = await sweepRecommendations();
      if (created || applied) {
        console.log(`[recommendations] ${created} new, ${applied} auto-applied`);
      }
    } catch (e) {
      console.error("[metrics] rollup failed:", e instanceof Error ? e.message : e);
    }
  };
  setTimeout(metricsSweep, 3 * 60 * 1000);
  globals.__metricsTimer = setInterval(metricsSweep, metricsMin * 60 * 1000);
  console.log(`[metrics] rollup armed — every ${metricsMin} min`);
}
