import { db } from "@/lib/db";

/** An article's body kept before a change, newest 20 per article — the history the versions page compares and restores. */
export async function snapshotBlogVersion(postId: string, label: string, body: string | null, actorId: string | null): Promise<void> {
  await db.blogPostVersion.create({ data: { postId, label, body, actorId } });
  const excess = await db.blogPostVersion.findMany({
    where: { postId },
    orderBy: { createdAt: "desc" },
    skip: 20,
    select: { id: true },
  });
  if (excess.length) {
    await db.blogPostVersion.deleteMany({ where: { id: { in: excess.map((v) => v.id) } } });
  }
}
