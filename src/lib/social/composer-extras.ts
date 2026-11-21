import { db } from "@/lib/db";
import { brandAvatarUrl } from "@/lib/brand-avatar";

/**
 * What the composer needs beyond the post itself, for both Compose and Edit (2026-11-21): the workspace's published
 * articles for "Add link" (newest first, only those with a live http(s) address), and the name and picture
 * "Preview as posted" draws the accounts with.
 */
export async function composerExtras(workspace: { id: string; name: string }) {
  const [rows, avatarUrl] = await Promise.all([
    db.blogPost.findMany({
      where: { workspaceId: workspace.id, status: "published", publishedUrl: { not: null } },
      orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }],
      take: 40,
      select: { title: true, publishedUrl: true },
    }),
    brandAvatarUrl(workspace.id).catch(() => null),
  ]);
  const articles = rows
    .filter((a): a is { title: string; publishedUrl: string } => !!a.publishedUrl && /^https?:\/\//i.test(a.publishedUrl))
    .map((a) => ({ title: a.title, url: a.publishedUrl }));
  return { articles, avatarUrl, brandName: workspace.name };
}
