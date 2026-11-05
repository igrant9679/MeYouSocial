import { jobs } from "@/lib/jobs";
import { readResearchSource } from "@/lib/documents/research-read";

/**
 * Read an attached file (E-ENG-13). A job for the reason `brand.extractdoc` is one:
 * reading can take minutes, and a killed container mid-read would leave a file
 * saying "reading" for good with nothing to resume it. `enqueue` starts it at once
 * in this process, so a small file is done before anyone notices.
 */

let registered = false;

export function registerResearchReadJobs() {
  if (registered) return;
  registered = true;

  jobs.register<{ sourceId: string; actorId: string | null }>("research.read", async ({ sourceId, actorId }, ctx) => {
    await ctx.progress(0.1);
    // The heartbeat: without it the sweeper takes a long read for a dead one and runs it twice.
    const beat = setInterval(() => void ctx.progress(0.5).catch(() => {}), 30_000);
    try {
      await readResearchSource(sourceId, actorId);
    } finally {
      clearInterval(beat);
    }
    await ctx.progress(1);
  });
}
