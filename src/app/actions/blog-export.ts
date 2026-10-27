"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";

/**
 * The manual half of the no-WordPress fallback: after an article's HTML was
 * downloaded and added to a site by hand, record it as published (with the
 * live URL) so the loop moves on — social variants, analytics and the board
 * all key off `published`. ADMIN only, like every other publish.
 */
export async function markPublishedManuallyAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const rawUrl = String(formData.get("url") ?? "").trim();
  const { workspace, user } = await requireRole("ADMIN");
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id }, select: { id: true, title: true, status: true } });
  if (!post) return;
  // From the editor or from Publish — each flashes back where it was used.
  const fromEditor = String(formData.get("back") ?? "") === "editor";
  const fail = (msg: string) => redirect(fromEditor ? `/blog/${post.id}?flashErr=${encodeURIComponent(msg)}` : `/publish?err=${encodeURIComponent(msg)}`);
  if (post.status !== "final_approval") {
    fail(`"${post.title.slice(0, 60)}" is at ${post.status}, not final approval — only articles that passed every check can be marked published.`);
  }
  // ⚠ The live link is required (ART-12): "published" with no URL sent social
  // posts out with no link and gave analytics nothing to match.
  let publishedUrl: string | null = null;
  try {
    const u = new URL(rawUrl);
    if (u.protocol === "http:" || u.protocol === "https:") publishedUrl = u.toString();
  } catch { /* not a URL */ }
  if (!publishedUrl) fail("Paste the article's live link (the full https:// address) — social posts and analytics key off it.");
  await db.blogPost.update({ where: { id: post.id }, data: { status: "published", publishedAt: new Date(), publishedUrl } });
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "blog.published_manually",
    entityType: "blog_post",
    entityId: post.id,
    meta: { publishedUrl, via: "html export" },
  });
  revalidatePath("/publish");
  revalidatePath("/blog");
  revalidatePath(`/blog/${post.id}`);
  revalidatePath("/inbox");
  const done = `"${post.title.slice(0, 60)}" recorded as published at ${publishedUrl}.`;
  redirect(fromEditor ? `/blog/${post.id}?flash=${encodeURIComponent(done)}` : `/publish?ok=${encodeURIComponent(done)}`);
}
