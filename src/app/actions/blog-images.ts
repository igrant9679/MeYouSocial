"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import {
  attachImageCore,
  generateImageBriefsCore,
  generateImageCore,
  isImageRole,
  probeImageDimensions,
} from "@/lib/blog-images";

/**
 * FR-8 asset actions. Approving an AI-generated image is the human review the
 * spec requires, so it is an EDITOR act recorded in the audit log.
 */

export async function generateImageBriefsAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  await generateImageBriefsCore(workspace.id, id);
  revalidatePath(`/blog/${id}`);
}

export async function attachBlogImageAction(formData: FormData) {
  const postId = String(formData.get("postId"));
  const role = String(formData.get("role"));
  const url = String(formData.get("url") ?? "").trim();
  if (!isImageRole(role) || !url) return;
  const { workspace } = await requireRole("EDITOR");
  await attachImageCore(
    workspace.id,
    postId,
    role,
    url,
    String(formData.get("altText") ?? "").trim() || null,
    formData.get("branded") === "on",
  );
  revalidatePath(`/blog/${postId}`);
}

export async function generateBlogImageAction(formData: FormData) {
  const postId = String(formData.get("postId"));
  const role = String(formData.get("role"));
  if (!isImageRole(role)) return;
  const { workspace } = await requireRole("EDITOR");
  await generateImageCore(workspace.id, postId, role);
  revalidatePath(`/blog/${postId}`);
}

/** The human review gate: an AI image only counts once someone approves it. */
export async function approveBlogImageAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { user, workspace } = await requireRole("EDITOR");
  const img = await db.blogImage.findFirst({
    where: { id, post: { workspaceId: workspace.id } },
  });
  if (!img) return;
  await db.blogImage.update({ where: { id }, data: { status: "approved" } });
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "blog.image_approved",
    entityType: "blog_image",
    entityId: id,
    meta: { role: img.role, source: img.source },
  });
  revalidatePath(`/blog/${img.postId}`);
}

export async function saveImageAltAction(formData: FormData) {
  const id = String(formData.get("id"));
  const alt = String(formData.get("altText") ?? "").trim();
  const { workspace } = await requireRole("EDITOR");
  const img = await db.blogImage.findFirst({ where: { id, post: { workspaceId: workspace.id } } });
  if (!img) return;
  await db.blogImage.update({
    where: { id },
    data: { altText: alt ? alt.slice(0, 200) : null, branded: formData.get("branded") === "on" || img.role === "og" },
  });
  revalidatePath(`/blog/${img.postId}`);
}

/** Re-measure a file that changed at its URL (or that we couldn't read before). */
export async function remeasureBlogImageAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  const img = await db.blogImage.findFirst({ where: { id, post: { workspaceId: workspace.id } } });
  if (!img) return;
  const dims = await probeImageDimensions(img.url);
  await db.blogImage.update({
    where: { id },
    data: { width: dims?.width ?? null, height: dims?.height ?? null },
  });
  revalidatePath(`/blog/${img.postId}`);
}

export async function deleteBlogImageAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  const img = await db.blogImage.findFirst({ where: { id, post: { workspaceId: workspace.id } } });
  if (!img) return;
  await db.blogImage.delete({ where: { id } });
  revalidatePath(`/blog/${img.postId}`);
}
