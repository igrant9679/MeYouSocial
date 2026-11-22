import { db } from "@/lib/db";
import { TAG_RE } from "@/lib/social/hashtag-text";

/**
 * The brand's own hashtags: every hashtag in the workspace's saved hashtag sets and snippets (`SocialSnippet`, managed
 * in Compose), spelled as saved, in name order, at most 40. Both the composer's suggestions and the posts the engine
 * writes offer these first (2026-11-21).
 */
export async function houseTags(workspaceId: string): Promise<string[]> {
  const snippets = await db.socialSnippet.findMany({ where: { workspaceId }, orderBy: { name: "asc" }, select: { body: true }, take: 100 });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of snippets) {
    for (const t of s.body.match(TAG_RE) ?? []) {
      const low = t.toLowerCase();
      if (seen.has(low)) continue;
      seen.add(low);
      out.push(t);
      if (out.length >= 40) return out;
    }
  }
  return out;
}
