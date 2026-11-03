import { jobs } from "@/lib/jobs";

/**
 * Pull 16 months of Search Console and GA4 history (E-MEA-09) — window by
 * window, newest first, through the same sync the sweep runs, so the history
 * lands in the same per-post rows Insights and Measure read. Single attempt:
 * a window that fails is named in the log and the rest still run; pressing
 * the button again fills what's missing.
 */
let registered = false;

export function registerAnalyticsJobs() {
  if (registered) return;
  registered = true;

  jobs.register<{ workspaceId: string }>("analytics.backfill", async ({ workspaceId }, ctx) => {
    const { runAnalyticsBackfill } = await import("@/lib/analytics/sync");
    const out = await runAnalyticsBackfill(workspaceId, { log: (m) => ctx.log(m), progress: (f) => ctx.progress(f) });
    if (out.failed.length) ctx.log(`failed windows: ${out.failed.join(" | ")}`);
  });
}
