import { settlePost, type SettledPost } from "@/lib/social/hashtag-text";

/**
 * Make a post the engine wrote fit its limit without sending a broken sentence (2026-11-24, the owner's "Fix both").
 *
 * The writer is told the limit, but models count characters badly: CommunityForce's 24 Nov posts came back long, and
 * the old settling cut the body at a word — "…reporting deadlines and disbursement" went out to four networks. Now:
 * 1. settle the reply (`settlePost`); if every sentence fits, done;
 * 2. otherwise ask the writer ONCE to shorten it, telling it the exact length and the limit;
 * 3. keep the better of the two — every sentence kept beats closing sentences dropped — and never one that would
 *    need a sentence cut in half: then `null`, and the caller stores nothing (an idea stays approved for the next run).
 */
export type FittedPost = { text: string; fit: "whole" | "sentence"; rewritten: boolean };

const RANK: Record<SettledPost["fit"], number> = { whole: 2, sentence: 1, over: 0 };

/** The writer's reply as a post: no wrapping quotation marks. */
export const cleanReply = (raw: string): string => raw.trim().replace(/^["“]|["”]$/g, "");

export async function fitPost(input: {
  raw: string;
  count: number;
  house?: string[];
  limit: number;
  /** One shorter version of `long` (the settled post, `length` characters), or null when no real reply came. */
  rewrite: (long: string, length: number) => Promise<string | null>;
}): Promise<FittedPost | null> {
  const opts = { count: input.count, house: input.house, limit: input.limit };
  const first = settlePost(cleanReply(input.raw), opts);
  if (first.fit === "whole") return { text: first.text, fit: "whole", rewritten: false };
  const again = await input.rewrite(first.whole, first.whole.length).catch(() => null);
  const second = again?.trim() ? settlePost(cleanReply(again), opts) : null;
  // A tie goes to the rewrite: it was written to fit.
  const best = second && RANK[second.fit] >= RANK[first.fit] ? second : first;
  if (best.fit === "over") return null;
  return { text: best.text, fit: best.fit, rewritten: best === second };
}

/** What the writer is told when its post came back too long. */
export function shortenRequest(length: number, limit: number, hasLink: boolean): string {
  return (
    `That post is ${length} characters; it must be at most ${limit} characters in all, hashtags${hasLink ? " and the link" : ""} included. ` +
    "Rewrite it shorter: the same idea, every sentence complete, the same closing line of hashtags" +
    (hasLink ? ", the link kept whole just before them" : "") +
    ". Return ONLY the post text."
  );
}
