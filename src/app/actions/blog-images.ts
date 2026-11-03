"use server";

import { advanceIfReadyCore } from "@/lib/blog-gates";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import {
  attachImageCore,
  generateImageBriefsCore,
  generateImageCore,
  isImageRole,
  placeImageCore,
  ROLE_LABELS,
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

const UPLOAD_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/tiff"]);
const UPLOAD_BYTES = 15 * 1024 * 1024;

/**
 * E-ART-04: an image from the device or the Media library, cropped to the
 * role's spec (and branded, for the OG) by `placeImageCore`. An upload is also
 * kept in Media, so it can be picked again for another article or a post.
 */
export async function placeBlogImageAction(formData: FormData) {
  const postId = String(formData.get("postId"));
  const role = String(formData.get("role"));
  const { workspace, user } = await requireRole("EDITOR");
  function back(msg: string, ok = false): never {
    redirect(`/blog/${postId}?tab=assets&${ok ? "flash" : "flashErr"}=${encodeURIComponent(msg)}`);
  }
  if (!isImageRole(role)) back("Pick featured or OG.");
  const altText = String(formData.get("altText") ?? "").trim() || null;
  const file = formData.get("file");
  const mediaKey = String(formData.get("mediaKey") ?? "").trim();
  let bytes: Buffer | null = null;
  let name = "image";
  let source: "upload" | "library" = "upload";
  let upload: File | null = null;
  if (file instanceof File && file.size > 0) {
    if (!UPLOAD_TYPES.has(file.type)) back("Upload a PNG, JPEG, GIF, WebP, AVIF or TIFF image.");
    if (file.size > UPLOAD_BYTES) back("Images must be under 15 MB.");
    bytes = Buffer.from(await file.arrayBuffer());
    name = file.name;
    upload = file;
  } else if (mediaKey) {
    const item = await db.mediaItem.findFirst({ where: { workspaceId: workspace.id, key: mediaKey }, select: { key: true, name: true, description: true } });
    if (!item) back("That image isn't in this workspace's Media.");
    const { storage } = await import("@/lib/storage");
    bytes = await storage.get(item.key);
    if (!bytes) back("That Media image couldn't be read from storage.");
    name = item.name;
    source = "library";
  } else {
    back("Choose a file, or pick one from Media.");
  }
  const res = await placeImageCore(workspace.id, postId, role, bytes!, { altText, source, name, actorId: user.id });
  revalidatePath(`/blog/${postId}`);
  if (!res.ok) back(res.error);
  // The original goes to Media too, to be picked again elsewhere — only once it
  // has proven to be an image, so a refused file leaves nothing behind.
  if (upload) {
    const { storage } = await import("@/lib/storage");
    const kept = await storage.put(upload.name, bytes!, upload.type, workspace.id);
    await db.mediaItem.create({ data: { workspaceId: workspace.id, key: kept.key, name: upload.name.slice(0, 200), description: altText, contentType: upload.type, createdById: user.id } });
  }
  await advanceIfReadyCore(workspace.id, postId, "placed an image");
  back(`${ROLE_LABELS[role]} set — cropped to ${res.width}×${res.height}${res.branded ? " with your logo lockup" : role === "og" ? " (the logo lockup couldn't be added — check the brand logo)" : ""}.`, true);
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
  // Approving the image that held the article moves it now, not next sweep.
  await advanceIfReadyCore(workspace.id, img.postId, "approved an image");
  revalidatePath(`/blog/${img.postId}`);
  revalidatePath("/inbox");
  revalidatePath("/inbox");
  revalidatePath("/publish");
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
