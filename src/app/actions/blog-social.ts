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
  const { workspace, user } = await requireRole("EDITOR");
  // Platform prompts, pause guard, parsing, audit — all in the shared core.
  await generateVariantsCore(workspace.id, postId, user.id);
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
 * Send an approved variant for real: it becomes a social post on the
 * workspace's account for that network and goes out through the same
 * pipeline as everything else (lib/social/publish.ts) — the one send claim,
 * Zernio's duplicate guard, UTM tagging and the record on Distribute.
 *
 * ⚠ It used to call Zernio directly as any editor (audit ART-11): past the
 * approval workflow and its admin rule, with {{URL}} blank when the article
 * wasn't live yet (a post with no link), and without UTM or watermark. Now:
 * ADMIN, and the article must be published with its URL.
 */
export async function postSocialVariantAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace, user } = await requireRole("ADMIN");
  const variant = await db.socialVariant.findFirst({
    where: { id, post: { workspaceId: workspace.id } },
    include: { post: { select: { status: true, publishedUrl: true, topicId: true } } },
  });
  if (!variant) return;
  if (variant.status !== "approved") return; // must be approved first

  const [{ zernioConfigured, platformFor }, { resolveSocialAccount }] = await Promise.all([
    import("@/lib/zernio"),
    import("@/lib/zernio/accounts"),
  ]);
  const revalidate = (msg?: string) => {
    revalidatePath(`/blog/${variant.postId}`);
    if (msg) redirect(`/blog/${variant.postId}?tab=distribute&social_err=${encodeURIComponent(msg)}`);
  };

  if (variant.post.status !== "published" || !variant.post.publishedUrl) {
    return revalidate("The article isn't live yet, so this post would have no link. Post it once the article is published.");
  }
  if (!(await zernioConfigured(workspace.id))) return revalidate("Zernio isn't configured — add the API key under Settings → Connections.");
  // Blog variants store their own platform label; normalise it to a Zernio slug.
  const platform = platformFor(variant.platform)?.slug ?? variant.platform.toLowerCase();
  const account = await resolveSocialAccount(workspace.id, platform);
  if (!account) return revalidate(`No ${variant.platform} account connected. Connect one under Settings → Connections.`);

  // A second click finds the variant already claimed and stops; the post
  // below has the one send claim, so nothing here can go out twice.
  const claim = await db.socialVariant.updateMany({ where: { id, status: "approved" }, data: { status: "posting" } });
  if (claim.count !== 1) return revalidate();

  const { getSetting } = await import("@/lib/settings");
  const requireApproval = (await getSetting("social:require_approval", workspace.id).catch(() => "")) === "true";
  const post = await db.socialPost.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      source: "manual",
      topicId: variant.post.topicId,
      text: variant.content.replaceAll("{{URL}}", variant.post.publishedUrl),
      status: "draft",
      // An admin's own post, stamped the way Compose stamps one.
      approval: requireApproval ? "approved" : null,
      targets: { create: [{ provider: platform, accountId: account.accountId, accountName: account.name }] },
    },
  });
  const { publishSocialPost } = await import("@/lib/social/publish");
  await publishSocialPost(post.id).catch(() => undefined);
  const sent = await db.socialPost.findUnique({ where: { id: post.id }, include: { targets: { select: { status: true, error: true } } } });
  const out = sent?.status === "posted" || sent?.status === "partial";
  await db.socialVariant.update({ where: { id }, data: { status: out ? "posted" : "approved" } });
  revalidatePath(`/blog/${variant.postId}`);
  revalidatePath("/social", "layout");
  if (!out) return revalidate(sent?.targets[0]?.error ?? "Posting failed — the post is in Distribute → Queue with what went wrong.");
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
