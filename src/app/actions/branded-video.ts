"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { renderBrandedShortCore } from "@/lib/branded-video";

/**
 * Render a branded short for a blog post. Costs HeyGen credits, so EDITOR-gated
 * (same bar as Veo packaging). The core no-ops when no key is configured; the UI
 * only shows the button when a key resolves, so that path is the belt to its
 * braces.
 */
export async function renderBrandedShortAction(formData: FormData) {
  const blogPostId = String(formData.get("blogPostId") ?? "");
  const eyebrow = String(formData.get("eyebrow") ?? "").trim() || undefined;
  const { user, workspace } = await requireRole("EDITOR");

  const post = await db.blogPost.findFirst({
    where: { id: blogPostId, workspaceId: workspace.id },
    select: { id: true, title: true, topic: { select: { name: true } } },
  });
  if (!post) return;

  await renderBrandedShortCore(workspace.id, {
    title: post.title,
    eyebrow: eyebrow ?? post.topic?.name,
    blogPostId: post.id,
    actorId: user.id,
  });
  revalidatePath(`/blog/${blogPostId}`);
}

/** Remove a branded short row (and forget its stored file reference). */
export async function deleteBrandedShortAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const { workspace } = await requireRole("EDITOR");
  const short = await db.brandedShort.findFirst({ where: { id, workspaceId: workspace.id }, select: { blogPostId: true } });
  await db.brandedShort.deleteMany({ where: { id, workspaceId: workspace.id } });
  if (short?.blogPostId) revalidatePath(`/blog/${short.blogPostId}`);
}
