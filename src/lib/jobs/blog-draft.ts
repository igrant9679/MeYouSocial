import { jobs } from "@/lib/jobs";

/**
 * Finish a freshly generated blog draft — park it at review, render its
 * featured/OG images, fill the SEO meta the publish gate requires.
 *
 * Runs as a BACKGROUND JOB rather than inline in the draft actions for the same
 * reason `social.autoimage` does: two real image renders plus an LLM metadata
 * pass is a minute of provider time, and the draft generation the user is
 * already waiting on takes ~40s of its own. Hanging the "Draft this" click on
 * all of it invites a proxy timeout, and a timeout there would look exactly
 * like the stall this work exists to remove.
 *
 * The autopilot calls `completeFreshDraftCore` directly instead — it runs in a
 * sweep with no request to keep alive, and its CycleReport wants the counts.
 */

let registered = false;

export function registerBlogDraftJobs() {
  if (registered) return;
  registered = true;

  jobs.register<{ workspaceId: string; postId: string }>("blog.finishdraft", async ({ workspaceId, postId }, ctx) => {
    await ctx.progress(0.1);
    const { completeFreshDraftCore } = await import("@/lib/blog-autopilot");
    const out = await completeFreshDraftCore(workspaceId, postId);
    ctx.log(`advanced=${out.advanced} images=${out.imagesGenerated} seo=${out.seoOptimized}`);
    await ctx.progress(1);
  });
}
