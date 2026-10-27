import { db } from "@/lib/db";
import { claimsFromMarkers, hasMarker } from "@/lib/citations-extract";

/**
 * Every [NEEDS SOURCE] marker in an article has a citation row — the row is
 * what the Inbox turns into a card with Verify and Drop the claim. Only
 * auto-review under full autonomy used to recreate missing rows, so a marker
 * written by hand, brought back by Restore or left by a section rewrite held
 * the article on "No unresolved markers" with nothing anyone could click
 * (ART-19). Called after every body write (lib/blog-gates
 * returnToReviewAfterEdit). Only ADDS: a row a person created for a claim
 * without a marker stays theirs.
 */
export async function syncMarkerRows(postId: string): Promise<number> {
  const post = await db.blogPost.findUnique({ where: { id: postId }, select: { body: true } });
  if (!post?.body || !hasMarker(post.body)) return 0;
  const tail = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase().slice(-60);
  const existing = await db.blogCitation.findMany({ where: { postId }, select: { claim: true } });
  const known = new Set(existing.map((c) => tail(c.claim)));
  const missing = claimsFromMarkers(post.body.replace(/<[^>]+>/g, " "), 20).filter((c) => !known.has(tail(c)));
  if (missing.length) await db.blogCitation.createMany({ data: missing.map((claim) => ({ postId, claim })) });
  return missing.length;
}
