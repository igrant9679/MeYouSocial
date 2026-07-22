"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { runBlogChecks, requiredChecksPass } from "@/lib/blog-checks";
import { writeAudit } from "@/lib/governance";
import { generateDraftCore } from "@/lib/blog-autopilot";

/**
 * Blog module (ported from Spark's article pipeline — slice 1).
 * Spark guardrails carried over: the AI never invents metrics/quotes; drafts
 * flag unverifiable claims with [NEEDS SOURCE]; publish requires walking the
 * review chain (drafting → draft_review → final_approval → published) — no
 * skipping straight to published.
 */

const STATUS_FLOW = ["drafting", "draft_review", "final_approval", "published"] as const;
type BlogStatus = (typeof STATUS_FLOW)[number];

function isStatus(s: string): s is BlogStatus {
  return (STATUS_FLOW as readonly string[]).includes(s);
}

export async function createBlogPostAction(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const { user, workspace } = await requireRole("EDITOR");
  const post = await db.blogPost.create({
    data: {
      workspaceId: workspace.id,
      title,
      audience: String(formData.get("audience") ?? "").trim() || null,
      focusKeyword: String(formData.get("focusKeyword") ?? "").trim() || null,
      createdById: user.id,
    },
  });
  revalidatePath("/blog");
  redirect(`/blog/${post.id}`);
}

export async function updateBlogPostAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post) return;

  const num = (v: FormDataEntryValue | null) => {
    const n = parseInt(String(v ?? ""), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const str = (v: FormDataEntryValue | null) => String(v ?? "").trim() || null;

  await db.blogPost.update({
    where: { id: post.id },
    data: {
      title: str(formData.get("title")) ?? post.title,
      slug: str(formData.get("slug")),
      metaTitle: str(formData.get("metaTitle")),
      metaDescription: str(formData.get("metaDescription")),
      focusKeyword: str(formData.get("focusKeyword")),
      audience: str(formData.get("audience")),
      wordCountTarget: num(formData.get("wordCountTarget")),
      body: str(formData.get("body")),
    },
  });
  revalidatePath(`/blog/${post.id}`);
  revalidatePath("/blog");
}

/** Move a post one step forward/backward along the review chain. */
export async function advanceBlogStatusAction(formData: FormData) {
  const id = String(formData.get("id"));
  const dir = String(formData.get("dir")) === "back" ? -1 : 1;
  // Final approval → published is an approval act: ADMIN. Everything else: EDITOR.
  const { user, workspace, membership } = await requireRole("EDITOR");
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post || !isStatus(post.status)) return;

  const idx = STATUS_FLOW.indexOf(post.status);
  const next = STATUS_FLOW[idx + dir];
  if (!next) return;
  if (next === "published" && membership.role !== "ADMIN") return; // human gate
  if (dir > 0 && (next === "final_approval" || next === "published")) {
    // Spark gate: checks must pass and citations must be verified to advance
    // into approval/publish. Server-enforced — the UI banner is advisory only.
    const unverified = await db.blogCitation.count({ where: { postId: post.id, verified: false } });
    if (!requiredChecksPass(runBlogChecks(post, unverified))) return;
  }
  await db.blogPost.update({
    where: { id: post.id },
    data: {
      status: next,
      publishedAt: next === "published" ? new Date() : null,
    },
  });
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: next === "published" ? "blog.published" : `blog.status_${next}`,
    entityType: "blog_post",
    entityId: post.id,
  });
  revalidatePath(`/blog/${post.id}`);
  revalidatePath("/blog");
}

export async function deleteBlogPostAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("ADMIN");
  await db.blogPost.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/blog");
  redirect("/blog");
}

/**
 * AI draft: grounded in the workspace's active channel voice/audience when one
 * exists, plus the post's own audience/keyword targets. Truthfulness rules from
 * Spark ride in the system prompt.
 */
export async function generateBlogDraftAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  // Guardrails (global pause, protect-from-rewrite), grounding, and citation
  // extraction live in the core — shared with the autopilot scheduler.
  await generateDraftCore(workspace.id, id);
  revalidatePath(`/blog/${id}`);
}

/**
 * Schedule (or unschedule) publishing. ADMIN act at final_approval — setting a
 * time is the human approval that lets the autopilot publish when it's due,
 * even in assisted mode. Gates still re-verify at the moment of publish.
 */
export async function scheduleBlogPostAction(formData: FormData) {
  const id = String(formData.get("id"));
  const when = String(formData.get("scheduledAt") ?? "").trim();
  const { user, workspace } = await requireRole("ADMIN");
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post || post.status !== "final_approval") return;

  const date = when ? new Date(when) : null;
  if (date && Number.isNaN(date.getTime())) return;
  await db.blogPost.update({ where: { id: post.id }, data: { scheduledAt: date } });
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: date ? "blog.scheduled" : "blog.unscheduled",
    entityType: "blog_post",
    entityId: post.id,
    meta: date ? { scheduledAt: date.toISOString() } : {},
  });
  revalidatePath(`/blog/${post.id}`);
}

// ---- Citations ---------------------------------------------------------------

export async function addCitationAction(formData: FormData) {
  const postId = String(formData.get("postId"));
  const claim = String(formData.get("claim") ?? "").trim();
  if (!claim) return;
  const { workspace } = await requireRole("EDITOR");
  const post = await db.blogPost.findFirst({ where: { id: postId, workspaceId: workspace.id } });
  if (!post) return;
  await db.blogCitation.create({ data: { postId, claim, sourceUrl: String(formData.get("sourceUrl") ?? "").trim() || null } });
  revalidatePath(`/blog/${postId}`);
}

export async function verifyCitationAction(formData: FormData) {
  const id = String(formData.get("id"));
  const sourceUrl = String(formData.get("sourceUrl") ?? "").trim();
  const { workspace } = await requireRole("EDITOR");
  const cit = await db.blogCitation.findFirst({
    where: { id, post: { workspaceId: workspace.id } },
  });
  if (!cit) return;
  // Verification requires a source URL — a claim can't be "verified" against nothing.
  if (!sourceUrl && !cit.sourceUrl) return;
  await db.blogCitation.update({
    where: { id },
    data: { verified: true, sourceUrl: sourceUrl || cit.sourceUrl },
  });
  revalidatePath(`/blog/${cit.postId}`);
}

export async function deleteCitationAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  const cit = await db.blogCitation.findFirst({ where: { id, post: { workspaceId: workspace.id } } });
  if (!cit) return;
  await db.blogCitation.delete({ where: { id } });
  revalidatePath(`/blog/${cit.postId}`);
}

// ---- Org profile -------------------------------------------------------------

export async function saveOrgProfileAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const str = (k: string) => String(formData.get(k) ?? "").trim() || null;
  await db.orgProfile.upsert({
    where: { workspaceId: workspace.id },
    update: {
      description: str("description"),
      industry: str("industry"),
      audience: str("audience"),
    },
    create: {
      workspaceId: workspace.id,
      description: str("description"),
      industry: str("industry"),
      audience: str("audience"),
    },
  });
  revalidatePath("/blog/organization");
  revalidatePath("/blog");
}
