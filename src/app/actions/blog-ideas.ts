"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { llm } from "@/lib/llm";
import { generateBlogDraftAction } from "@/app/actions/blog";

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
  const org = await db.orgProfile.findUnique({ where: { workspaceId: workspace.id } });
  const existing = await db.blogIdea.findMany({
    where: { workspaceId: workspace.id },
    select: { title: true },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const system =
    "You generate blog topic ideas. Respond ONLY with a JSON array of objects: " +
    '[{"title": string, "angle": string, "keyword": string}] — no prose, no markdown fences. ' +
    "Titles must be specific and non-generic. The angle explains why this topic serves the audience. " +
    "Never invent statistics or cite studies in the angle.";
  const prompt = [
    org?.description
      ? `The organization: ${org.description}${org.industry ? ` Industry: ${org.industry}.` : ""}${org.audience ? ` Audience: ${org.audience}.` : ""}`
      : "No organization profile is set — generate broadly useful business-content ideas and note that grounding is missing.",
    existing.length ? `Avoid duplicating these existing ideas: ${existing.map((i) => i.title).join(" | ")}` : null,
    "Generate 6 blog post ideas.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await llm.complete({
    model: workspace.defaultModel ?? llm.defaultModel,
    system,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 1500,
  });

  // Parse defensively: models sometimes wrap JSON in fences or prose.
  let ideas: Array<{ title?: string; angle?: string; keyword?: string }> = [];
  try {
    const match = res.content.match(/\[[\s\S]*\]/);
    ideas = match ? JSON.parse(match[0]) : [];
  } catch {
    ideas = [];
  }
  const rows = ideas
    .filter((i) => typeof i.title === "string" && i.title.trim().length > 3)
    .slice(0, 6)
    .map((i) => ({
      workspaceId: workspace.id,
      title: i.title!.trim().slice(0, 200),
      angle: typeof i.angle === "string" ? i.angle.trim().slice(0, 500) : null,
      keyword: typeof i.keyword === "string" ? i.keyword.trim().slice(0, 80) : null,
      source: "ai",
    }));
  if (rows.length) await db.blogIdea.createMany({ data: rows });
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

  const fd = new FormData();
  fd.set("id", post.id);
  await generateBlogDraftAction(fd);
  revalidatePath("/blog");
  redirect(`/blog/${post.id}`);
}

/** Auto-draft up to 2 approved ideas per run (Spark's pipeline cap). */
export async function autoDraftApprovedAction() {
  const { user, workspace } = await requireRole("EDITOR");
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
    const fd = new FormData();
    fd.set("id", post.id);
    await generateBlogDraftAction(fd);
  }
  revalidatePath("/blog");
}
