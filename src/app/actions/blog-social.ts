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

  const [{ zernioConfigured, createZernioPost, platformFor }, { resolveSocialAccount }] = await Promise.all([
    import("@/lib/zernio"),
    import("@/lib/zernio/accounts"),
  ]);
  const revalidate = (msg?: string) => {
    revalidatePath(`/blog/${variant.postId}`);
    if (msg) redirect(`/blog/${variant.postId}?tab=distribute&social_err=${encodeURIComponent(msg)}`);
  };

  if (!(await zernioConfigured(workspace.id))) return revalidate("Zernio isn't configured — add the API key under Admin → Connections.");
  // Blog variants store their own platform label; normalise it to a Zernio slug.
  const platform = platformFor(variant.platform)?.slug ?? variant.platform.toLowerCase();
  const account = await resolveSocialAccount(workspace.id, platform);
  if (!account) return revalidate(`No ${variant.platform} account connected. Connect one under Admin → Connections.`);

  const ws = await db.workspace.findUnique({ where: { id: workspace.id }, select: { zernioProfileId: true } });
  const text = variant.content.replaceAll("{{URL}}", variant.post.publishedUrl ?? "");
  try {
    await createZernioPost({
      content: text,
      platforms: [{ platform, accountId: account.accountId }],
      publishNow: true,
      // Stable per variant: clicking "Post now" twice inside Zernio's window
      // returns the original post rather than posting again.
      requestId: `variant-${variant.id}`,
      profileId: ws?.zernioProfileId ?? undefined,
      workspaceId: workspace.id,
    });
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
