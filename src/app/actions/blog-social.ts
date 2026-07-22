"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { generateVariantsCore } from "@/lib/blog-autopilot";

/**
 * Social variants (Spark FR-12 port): per-platform copy for a post, generated
 * in one call, moving draft → approved → posted through a manual queue. When
 * every variant is posted the post auto-advances published → distributed…
 * except MeYouSocial's blog flow ends at published, so we simply record it.
 * {{URL}} in generated copy is substituted with the post's published URL.
 */

export async function generateSocialVariantsAction(formData: FormData) {
  const postId = String(formData.get("postId"));
  const { workspace } = await requireRole("EDITOR");
  // Platform prompts, pause guard, parsing, audit — all in the shared core.
  await generateVariantsCore(workspace.id, postId);
  revalidatePath(`/blog/${postId}`);
}

export async function setSocialVariantStatusAction(formData: FormData) {
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  if (!["approved", "posted"].includes(status)) return;
  const { workspace } = await requireRole("EDITOR");
  const variant = await db.socialVariant.findFirst({
    where: { id, post: { workspaceId: workspace.id } },
  });
  if (!variant) return;
  // Queue discipline: drafts must be approved before they can be marked posted.
  if (status === "posted" && variant.status !== "approved") return;
  await db.socialVariant.update({ where: { id }, data: { status } });
  revalidatePath(`/blog/${variant.postId}`);
}

export async function deleteSocialVariantAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  const variant = await db.socialVariant.findFirst({ where: { id, post: { workspaceId: workspace.id } } });
  if (!variant) return;
  await db.socialVariant.delete({ where: { id } });
  revalidatePath(`/blog/${variant.postId}`);
}
