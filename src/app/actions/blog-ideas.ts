"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { isGloballyPaused } from "@/lib/governance";
import { discoverIdeasCore, generateDraftCore } from "@/lib/blog-autopilot";

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
