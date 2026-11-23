import { db } from "@/lib/db";
import { brandAvatarUrl } from "@/lib/brand-avatar";
import { getSetting } from "@/lib/settings";
import { IMAGE_STYLE_KEY, parseImageStyle } from "@/lib/social/image-styles";
import { FRAME_KEY, parseFrameLayout } from "@/lib/social/frame";

/**
 * What the composer needs beyond the post itself, for both Compose and Edit (2026-11-21): the workspace's published
 * articles for "Add link" (newest first, only those with a live http(s) address), how many published articles have
 * no such address (so the panel can say why the list is empty — 2026-11-22, CommunityForce's two published articles
 * were marked published without a link), the name and picture "Preview as posted" draws the accounts with, and the
 * workspace's image style and branded frame (Brand → Post images), which the AI image button starts from.
 */
export async function composerExtras(workspace: { id: string; name: string }) {
  const [rows, published, avatarUrl, styleRaw, frameRaw] = await Promise.all([
    db.blogPost.findMany({
      where: { workspaceId: workspace.id, status: "published", publishedUrl: { not: null } },
      orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }],
      take: 40,
      select: { title: true, publishedUrl: true },
    }),
    db.blogPost.count({ where: { workspaceId: workspace.id, status: "published" } }),
    brandAvatarUrl(workspace.id).catch(() => null),
    getSetting(IMAGE_STYLE_KEY, workspace.id).catch(() => ""),
    getSetting(FRAME_KEY, workspace.id).catch(() => ""),
  ]);
  const articles = rows
    .filter((a): a is { title: string; publishedUrl: string } => !!a.publishedUrl && /^https?:\/\//i.test(a.publishedUrl))
    .map((a) => ({ title: a.title, url: a.publishedUrl }));
  // Published articles the picker can't offer: no live http(s) address saved. Counted only when the list is empty,
  // which is when the panel explains itself; with some listed, the rest don't need a word.
  const unlinkedArticles = articles.length ? 0 : published;
  return { articles, unlinkedArticles, avatarUrl, brandName: workspace.name, imageStyle: parseImageStyle(styleRaw), frameLayout: parseFrameLayout(frameRaw) };
}
