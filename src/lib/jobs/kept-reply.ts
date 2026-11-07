import type { JobContext } from "@/lib/jobs";
import type { LLMResponse } from "@/lib/llm";

/** What a job keeps of a model's reply: enough to write it and stamp who wrote it. */
export type KeptReply = Pick<LLMResponse, "content" | "provider" | "model">;

class MockReply extends Error {
  constructor(readonly reply: KeptReply) { super("mock reply"); }
}

/**
 * A model call made once per job (audit ENG-22): a retry gets the real reply
 * the earlier attempt paid for instead of asking again. A MOCK reply is handed
 * back but never kept — it is the router's stand-in for a provider that didn't
 * answer, and replaying it would make a passing outage permanent for this job.
 */
export async function keptReply(ctx: JobContext, step: string, call: () => Promise<LLMResponse>): Promise<KeptReply> {
  try {
    return await ctx.once(step, async () => {
      const r = await call();
      const kept: KeptReply = { content: r.content, provider: r.provider, model: r.model };
      if (r.provider === "mock") throw new MockReply(kept);
      return kept;
    });
  } catch (e) {
    if (e instanceof MockReply) return e.reply;
    throw e;
  }
}
