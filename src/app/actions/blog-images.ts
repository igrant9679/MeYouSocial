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
  parseImageDimensions,
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
  // Our own stored images live at session-gated RELATIVE urls (/uploads/…,
  // /api/files/…) that an HTTP probe can never read — measure those straight
  // from storage bytes. Only external http(s) urls go through the probe.
  // ⚠ This action once wrote `dims ?? null`, so clicking Re-measure on a
  // stored image ERASED good dimensions and wedged the asset gate at "size
  // unknown" with no way back (found by the user on the first real
  // walk-through, 2026-08-12). A failed measurement now changes nothing.
  let dims: { width: number; height: number } | null = null;
  const storedKey = img.url.match(/\/(?:uploads|api\/files)\/([^"'\s)]+)/)?.[1];
  if (storedKey) {
    const { storage } = await import("@/lib/storage");
    const buf = await storage.get(decodeURIComponent(storedKey)).catch(() => null);
    if (buf) dims = parseImageDimensions(new Uint8Array(buf));
  } else {
    dims = await probeImageDimensions(img.url);
  }
  if (dims) {
    await db.blogImage.update({ where: { id }, data: { width: dims.width, height: dims.height } });
  }
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
