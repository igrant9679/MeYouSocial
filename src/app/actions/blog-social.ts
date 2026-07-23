"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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

/**
 * Publish a social variant for real through the workspace's connected Unipile
 * account for that network, then mark it posted. Substitutes {{URL}} with the
 * post's published URL (same as the preview). Redirects back with an error
 * banner param if the network isn't connected or the post call fails.
 */
export async function postSocialVariantAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  const variant = await db.socialVariant.findFirst({
    where: { id, post: { workspaceId: workspace.id } },
    include: { post: { select: { publishedUrl: true } } },
  });
  if (!variant) return;
  if (variant.status !== "approved") return; // must be approved first

  const [{ unipileConfigured, createPostViaUnipile }, { resolveSocialAccount }] = await Promise.all([
    import("@/lib/unipile"),
    import("@/lib/unipile/accounts"),
  ]);
  const revalidate = (msg?: string) => {
    revalidatePath(`/blog/${variant.postId}`);
    if (msg) redirect(`/blog/${variant.postId}?tab=distribute&social_err=${encodeURIComponent(msg)}`);
  };

  if (!(await unipileConfigured())) return revalidate("Unipile isn't configured — connect a social account under Admin → Connections.");
  const account = await resolveSocialAccount(workspace.id, variant.platform);
  if (!account) return revalidate(`No ${variant.platform} account connected. Connect one under Admin → Connections.`);

  const text = variant.content.replaceAll("{{URL}}", variant.post.publishedUrl ?? "");
  try {
    await createPostViaUnipile({ accountId: account.accountId, text });
  } catch (e) {
    return revalidate(e instanceof Error ? e.message : "Posting failed.");
  }
  await db.socialVariant.update({ where: { id }, data: { status: "posted" } });
  revalidatePath(`/blog/${variant.postId}`);
  redirect(`/blog/${variant.postId}?tab=distribute&social_ok=1`);
}

export async function deleteSocialVariantAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  const variant = await db.socialVariant.findFirst({ where: { id, post: { workspaceId: workspace.id } } });
  if (!variant) return;
  await db.socialVariant.delete({ where: { id } });
  revalidatePath(`/blog/${variant.postId}`);
}
