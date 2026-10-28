import { db } from "@/lib/db";

/** One note on a post's review thread, ready to show (E-SOC-02). */
export type ThreadNote = { id: string; body: string; kind: string; createdAt: Date; author: string };

/**
 * Each post's review thread, oldest first, with the author's name. Every id
 * asked for gets an entry — an empty thread still shows its "add a comment" box.
 */
export async function threadsFor(postIds: string[]): Promise<Map<string, ThreadNote[]>> {
  const out = new Map<string, ThreadNote[]>(postIds.map((id) => [id, []]));
  if (!postIds.length) return out;
  const rows = await db.socialPostComment.findMany({ where: { postId: { in: postIds } }, orderBy: { createdAt: "asc" }, take: 2000 });
  const authorIds = [...new Set(rows.map((r) => r.authorId).filter((x): x is string => !!x))];
  const users = authorIds.length ? await db.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true, email: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name || u.email]));
  for (const r of rows) {
    out.get(r.postId)?.push({ id: r.id, body: r.body, kind: r.kind, createdAt: r.createdAt, author: (r.authorId && nameOf.get(r.authorId)) || "a former member" });
  }
  return out;
}
