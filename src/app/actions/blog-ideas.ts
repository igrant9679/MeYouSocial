"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { isGloballyPaused, writeAudit } from "@/lib/governance";
import { discoverIdeasCore, generateDraftCore } from "@/lib/blog-autopilot";
import { rescoreIdeas } from "@/lib/blog-idea-scoring";
import { readMotifWeights, serializeMotifs } from "@/lib/motifs";

/**
 * Blog idea engine (Spark FR-5 port): AI discovery grounded in the org profile,
 * approve/reject curation, draft-from-idea, and auto-draft of approved ideas
 * (capped 2/run like Spark's pipeline). AI ideas carry no invented metrics —
 * angle text explains why the topic works, nothing more.
 */

export async function addBlogIdeaAction(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const { workspace } = await requireRole("EDITOR");
  await db.blogIdea.create({
    data: {
      workspaceId: workspace.id,
      title,
      keyword: String(formData.get("keyword") ?? "").trim() || null,
      source: "manual",
    },
  });
  revalidatePath("/blog");
}

export async function discoverBlogIdeasAction() {
  const { workspace } = await requireRole("EDITOR");
  // Grounding, dedupe, parsing, pause guard, audit — all in the shared core.
  await discoverIdeasCore(workspace.id);
  revalidatePath("/blog");
}

export async function setBlogIdeaStatusAction(formData: FormData) {
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  if (!["discovered", "approved", "rejected"].includes(status)) return;
  const { workspace } = await requireRole("EDITOR");
  await db.blogIdea.updateMany({ where: { id, workspaceId: workspace.id }, data: { status } });
  revalidatePath("/blog");
  revalidatePath("/blog/ideas");
}

/** FR-5: edit an idea's tags in place from the board. */
export async function updateBlogIdeaAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  const idea = await db.blogIdea.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!idea) return;
  const text = (k: string, max: number) => {
    const v = String(formData.get(k) ?? "").trim();
    return v ? v.slice(0, max) : null;
  };
  const tierRaw = parseInt(String(formData.get("tier") ?? ""), 10);
  await db.blogIdea.update({
    where: { id },
    data: {
      title: String(formData.get("title") ?? "").trim().slice(0, 200) || idea.title,
      angle: text("angle", 500),
      keyword: text("keyword", 80),
      audience: text("audience", 120),
      targetPage: text("targetPage", 500),
      seasonalHook: text("seasonalHook", 120),
      tier: Number.isFinite(tierRaw) && tierRaw >= 1 && tierRaw <= 4 ? tierRaw : null,
      motifs: serializeMotifs(readMotifWeights(formData)),
    },
  });
  await rescoreIdeas(workspace.id);
  revalidatePath("/blog/ideas");
}

/** Recompute every open idea's priority and dedupe note from workspace facts. */
export async function rescoreBlogIdeasAction() {
  const { workspace } = await requireRole("EDITOR");
  const changed = await rescoreIdeas(workspace.id);
  await writeAudit({
    workspaceId: workspace.id,
    action: "ideas.rescored",
    entityType: "blog_idea",
    meta: { changed },
  });
  revalidatePath("/blog/ideas");
  revalidatePath("/blog");
}

/**
 * FR-5 merge: fold one idea into another. The loser keeps a pointer rather than
 * being deleted, so the board's history stays honest about what was combined.
 */
export async function mergeBlogIdeasAction(formData: FormData) {
  const sourceId = String(formData.get("sourceId"));
  const targetId = String(formData.get("targetId"));
  if (!sourceId || !targetId || sourceId === targetId) return;
  const { workspace } = await requireRole("EDITOR");
  const [source, target] = await Promise.all([
    db.blogIdea.findFirst({ where: { id: sourceId, workspaceId: workspace.id } }),
    db.blogIdea.findFirst({ where: { id: targetId, workspaceId: workspace.id } }),
  ]);
  if (!source || !target || source.status === "drafted" || target.status === "merged") return;

  const combinedAngle = [target.angle, source.angle]
    .filter(Boolean)
    .join(" ")
    .slice(0, 500);
  await db.blogIdea.update({
    where: { id: target.id },
    data: {
      angle: combinedAngle || null,
      keyword: target.keyword ?? source.keyword,
      audience: target.audience ?? source.audience,
      targetPage: target.targetPage ?? source.targetPage,
      seasonalHook: target.seasonalHook ?? source.seasonalHook,
      tier: target.tier ?? source.tier,
    },
  });
  await db.blogIdea.update({
    where: { id: source.id },
    data: { status: "merged", mergedIntoId: target.id },
  });
  await rescoreIdeas(workspace.id);
  await writeAudit({
    workspaceId: workspace.id,
    action: "ideas.merged",
    entityType: "blog_idea",
    entityId: target.id,
    meta: { mergedFrom: source.id },
  });
  revalidatePath("/blog/ideas");
}

export async function deleteBlogIdeaAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  await db.blogIdea.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/blog/ideas");
  revalidatePath("/blog");
}

/** Create the post from an idea and generate its grounded draft. */
export async function draftFromIdeaAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { user, workspace } = await requireRole("EDITOR");
  const idea = await db.blogIdea.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!idea || idea.status === "drafted") return;

  const post = await db.blogPost.create({
    data: {
      workspaceId: workspace.id,
      title: idea.title,
      focusKeyword: idea.keyword,
      createdById: user.id,
    },
  });
  await db.blogIdea.update({ where: { id: idea.id }, data: { status: "drafted", postId: post.id } });

  await generateDraftCore(workspace.id, post.id);
  revalidatePath("/blog");
  redirect(`/blog/${post.id}`);
}

/** Auto-draft up to 2 approved ideas per run (Spark's pipeline cap). */
export async function autoDraftApprovedAction() {
  const { user, workspace } = await requireRole("EDITOR");
  if (await isGloballyPaused(workspace.id)) return;
  const approved = await db.blogIdea.findMany({
    where: { workspaceId: workspace.id, status: "approved" },
    orderBy: { createdAt: "asc" },
    take: 2,
  });
  for (const idea of approved) {
    const post = await db.blogPost.create({
      data: {
        workspaceId: workspace.id,
        title: idea.title,
        focusKeyword: idea.keyword,
        createdById: user.id,
      },
    });
    await db.blogIdea.update({ where: { id: idea.id }, data: { status: "drafted", postId: post.id } });
    await generateDraftCore(workspace.id, post.id);
  }
  revalidatePath("/blog");
}
