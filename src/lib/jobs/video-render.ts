import { jobs } from "@/lib/jobs";

/**
 * "Render now" as a background job (E-VID-07). A board is minutes of provider
 * calls; inline in the server action it held the request open until a proxy
 * timed it out, and the page couldn't show anything until it ended. Now the
 * page refreshes while the board moves scene by scene.
 *
 * ⚠ ONE attempt: a render costs real money, and processRenderCore already
 * leaves a failed board "failed" with its finished clips kept, for a person to
 * Retry. An automatic retry would pay again without anyone deciding to.
 * Each finished scene reports progress, which is also the job's heartbeat —
 * a long board is never mistaken for an abandoned one and run twice.
 */

let registered = false;

export const VIDEO_RENDER_JOB = "video.render";

export function registerVideoRenderJobs() {
  if (registered) return;
  registered = true;
  jobs.register<{ workspaceId: string; renderId: string }>(VIDEO_RENDER_JOB, async ({ workspaceId, renderId }, ctx) => {
    await ctx.progress(0.02);
    const { processRenderCore } = await import("@/lib/blog-autopilot");
    await processRenderCore(workspaceId, renderId, {
      onScene: (done, total) => ctx.progress(Math.min(0.98, done / Math.max(1, total))),
    });
    await ctx.progress(1);
  });
}
