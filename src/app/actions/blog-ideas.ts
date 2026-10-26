"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { isGloballyPaused, writeAudit } from "@/lib/governance";
import { discoverIdeasCore } from "@/lib/blog-autopilot";
import { rescoreIdeas } from "@/lib/blog-idea-scoring";
import { readMotifWeights, serializeMotifs } from "@/lib/motifs";
import { cleanTitle } from "@/lib/list-marker";

/**
 * Blog idea engine (Spark FR-5 port): AI discovery grounded in the org profile,
 * approve/reject curation, draft-from-idea, and auto-draft of approved ideas
 * (capped 2/run like Spark's pipeline). AI ideas carry no invented metrics —
 * angle text explains why the topic works, nothing more.
 */

export async function addBlogIdeaAction(formData: FormData) {
  // cleanTitle also covers the paste-from-a-list case: someone copying a bullet
  // out of a doc lands the same "- " the model used to (A3).
  const title = cleanTitle(String(formData.get("title") ?? ""), 200);
  if (!title) return;
  const { workspace } = await requireRole("EDITOR");
  const rawTopic = String(formData.get("topicId") ?? "").trim();
  const topicId = rawTopic
    ? (await db.topic.findFirst({ where: { id: rawTopic, workspaceId: workspace.id }, select: { id: true } }))?.id ?? null
    : null;
  await db.blogIdea.create({
    data: {
      workspaceId: workspace.id,
      title,
      keyword: String(formData.get("keyword") ?? "").trim() || null,
      topicId,
      source: "manual",
    },
  });
  revalidatePath("/blog");
  revalidatePath("/ideas");
}

export async function discoverBlogIdeasAction(formData?: FormData) {
  const { workspace } = await requireRole("EDITOR");
  // Optional focus topic — validated against the workspace before it steers a run.
  const raw = String(formData?.get("topicId") ?? "").trim();
  const topicId = raw
    ? (await db.topic.findFirst({ where: { id: raw, workspaceId: workspace.id }, select: { id: true } }))?.id ?? null
    : null;
  // Grounding, dedupe, parsing, pause guard, audit — all in the shared core.
  await discoverIdeasCore(workspace.id, topicId);
  revalidatePath("/blog");
  revalidatePath("/ideas");
}

export async function setBlogIdeaStatusAction(formData: FormData) {
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  if (!["discovered", "approved", "rejected"].includes(status)) return;
  const { user, workspace } = await requireRole("EDITOR");
  const idea = await db.blogIdea.findFirst({ where: { id, workspaceId: workspace.id }, select: { status: true, title: true } });
  if (!idea) return;
  // Only between the open states: a drafted or merged idea can't be
  // re-approved into a second article (IDE-06).
  const r = await db.blogIdea.updateMany({ where: { id, workspaceId: workspace.id, status: { in: ["discovered", "approved", "rejected"] } }, data: { status } });
  if (!r.count) return;
  // Approval is the article side's one human gate, so who opened or closed it
  // is recorded — the row social ideas have always written.
  if (idea.status !== status) {
    await writeAudit({
      workspaceId: workspace.id,
      actorId: user.id,
      action: status === "approved" ? "ideas.approved" : status === "rejected" ? "ideas.rejected" : "ideas.restored",
      entityType: "blog_idea",
      entityId: id,
      meta: { from: idea.status, title: idea.title },
    });
  }
  revalidatePath("/blog");
  revalidatePath("/ideas");
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
      title: cleanTitle(String(formData.get("title") ?? ""), 200) || idea.title,
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
  revalidatePath("/ideas");
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
  revalidatePath("/ideas");
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
  revalidatePath("/ideas");
}

export async function deleteBlogIdeaAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  await db.blogIdea.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/ideas");
  revalidatePath("/blog");
}

/**
 * Draft an idea now — through the same claim and refresh rules as the sweep
 * (lib/idea-drafting.ts). Lands on the article; a site-change idea (retire,
 * merge, a rewrite of a page the app didn't write) explains itself instead.
 */
export async function draftFromIdeaAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { user, workspace } = await requireRole("EDITOR");
  const { draftIdeaCore } = await import("@/lib/idea-drafting");
  const r = await draftIdeaCore(workspace.id, id, { from: ["discovered", "approved"], actorId: user.id, finish: "job" });
  revalidatePath("/blog");
  revalidatePath("/ideas");
  if (r.ok) redirect(`/blog/${r.postId}`);
  if (r.postId && r.reason === "taken") redirect(`/blog/${r.postId}`);
  redirect(`/ideas?err=${encodeURIComponent(r.message)}`);
}

/** Auto-draft up to 2 approved ideas per run (Spark's pipeline cap). */
export async function autoDraftApprovedAction() {
  const { user, workspace } = await requireRole("EDITOR");
  if (await isGloballyPaused(workspace.id)) return;
  const { draftIdeaCore, ideaChange } = await import("@/lib/idea-drafting");
  const approved = (await db.blogIdea.findMany({
    where: { workspaceId: workspace.id, status: "approved" },
    orderBy: { createdAt: "asc" },
    take: 50,
  })).filter((i) => ideaChange(i) !== "site_change").slice(0, 2);
  for (const idea of approved) {
    await draftIdeaCore(workspace.id, idea.id, { from: ["approved"], actorId: user.id, finish: "job" });
  }
  revalidatePath("/blog");
}
