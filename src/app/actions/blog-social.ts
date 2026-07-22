"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { llm } from "@/lib/llm";
import { isGloballyPaused, writeAudit } from "@/lib/governance";

/**
 * Social variants (Spark FR-12 port): per-platform copy for a post, generated
 * in one call, moving draft → approved → posted through a manual queue. When
 * every variant is posted the post auto-advances published → distributed…
 * except MeYouSocial's blog flow ends at published, so we simply record it.
 * {{URL}} in generated copy is substituted with the post's published URL.
 */

const PLATFORMS = ["linkedin", "x", "instagram", "facebook"] as const;

export async function generateSocialVariantsAction(formData: FormData) {
  const postId = String(formData.get("postId"));
  const { workspace } = await requireRole("EDITOR");
  const post = await db.blogPost.findFirst({ where: { id: postId, workspaceId: workspace.id } });
  if (!post || !post.body) return;
  if (await isGloballyPaused(workspace.id)) return;

  const org = await db.orgProfile.findUnique({ where: { workspaceId: workspace.id } });
  const summary = post.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 1500);

  const system =
    "You write social media copy promoting a blog post. Respond ONLY with a JSON object keyed by platform: " +
    '{"linkedin": string, "x": string, "instagram": string, "facebook": string}. ' +
    "Use {{URL}} where the post link belongs. Platform conventions: linkedin = professional, 2-3 short paragraphs; " +
    "x = under 260 chars, punchy; instagram = conversational with line breaks, no link in body (say 'link in bio' + {{URL}} on its own line); " +
    "facebook = friendly, 1-2 paragraphs. Never invent statistics or quotes not present in the article.";
  const prompt = [
    `Blog post title: "${post.title}"`,
    org?.description ? `The organization: ${org.description.slice(0, 400)}` : null,
    `Article summary: ${summary}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await llm.complete({
    model: workspace.defaultModel ?? llm.defaultModel,
    system,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 1500,
  });

  let parsed: Record<string, unknown> = {};
  try {
    const match = res.content.match(/\{[\s\S]*\}/);
    parsed = match ? (JSON.parse(match[0]) as Record<string, unknown>) : {};
  } catch {
    parsed = {};
  }

  // Regenerate = replace unposted drafts; posted history stays.
  await db.socialVariant.deleteMany({ where: { postId: post.id, status: { not: "posted" } } });
  const rows = PLATFORMS.filter((p) => typeof parsed[p] === "string" && (parsed[p] as string).trim())
    .map((p) => ({
      postId: post.id,
      platform: p,
      content: (parsed[p] as string).trim().slice(0, 3000),
    }));
  if (rows.length) await db.socialVariant.createMany({ data: rows });
  await writeAudit({
    workspaceId: workspace.id,
    action: "social.variants_generated",
    entityType: "blog_post",
    entityId: post.id,
    meta: { platforms: rows.map((r) => r.platform) },
  });
  revalidatePath(`/blog/${post.id}`);
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
