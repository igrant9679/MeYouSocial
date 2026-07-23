"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { notify } from "@/lib/notify";

/**
 * FR-10 — reviewer assignment and inline comments.
 *
 * Comments carry an optional anchor: the passage or heading they refer to.
 * Storing the quoted text rather than an offset means an edit elsewhere in the
 * body can't silently move a comment onto the wrong sentence.
 */

export async function assignReviewerAction(formData: FormData) {
  const id = String(formData.get("id"));
  const reviewerId = String(formData.get("reviewerId") ?? "").trim() || null;
  const { user, workspace } = await requireRole("EDITOR");
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post) return;

  if (reviewerId) {
    const member = await db.membership.findFirst({
      where: { workspaceId: workspace.id, userId: reviewerId, status: "active" },
    });
    if (!member) return; // never assign someone who isn't in the workspace
  }

  await db.blogPost.update({ where: { id: post.id }, data: { reviewerId } });
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: reviewerId ? "blog.reviewer_assigned" : "blog.reviewer_cleared",
    entityType: "blog_post",
    entityId: post.id,
    meta: { reviewerId },
  });
  if (reviewerId && reviewerId !== user.id) {
    await notify({
      workspaceId: workspace.id,
      kind: "assigned",
      title: `You're the reviewer for "${post.title}"`,
      path: `/blog/${post.id}`,
      entityType: "blog_post",
      entityId: post.id,
      userIds: [reviewerId],
    });
  }
  revalidatePath(`/blog/${post.id}`);
}

export async function addBlogCommentAction(formData: FormData) {
  const postId = String(formData.get("postId"));
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return;
  const { user, workspace } = await requireRole("EDITOR");
  const post = await db.blogPost.findFirst({ where: { id: postId, workspaceId: workspace.id } });
  if (!post) return;

  await db.blogComment.create({
    data: {
      postId,
      authorId: user.id,
      body: body.slice(0, 4000),
      anchor: String(formData.get("anchor") ?? "").trim().slice(0, 300) || null,
    },
  });

  // Tell the people actually on this post — the reviewer and the author — not
  // the whole workspace.
  const recipients = [post.reviewerId, post.createdById].filter(
    (id): id is string => !!id && id !== user.id,
  );
  await notify({
    workspaceId: workspace.id,
    kind: "comment",
    title: `New comment on "${post.title}"`,
    body: body.slice(0, 300),
    path: `/blog/${post.id}`,
    entityType: "blog_post",
    entityId: post.id,
    userIds: recipients.length ? recipients : undefined,
    excludeUserId: user.id,
  });
  revalidatePath(`/blog/${postId}`);
}

export async function resolveBlogCommentAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  const comment = await db.blogComment.findFirst({
    where: { id, post: { workspaceId: workspace.id } },
  });
  if (!comment) return;
  await db.blogComment.update({ where: { id }, data: { resolved: !comment.resolved } });
  revalidatePath(`/blog/${comment.postId}`);
}

export async function deleteBlogCommentAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  const comment = await db.blogComment.findFirst({
    where: { id, post: { workspaceId: workspace.id } },
  });
  if (!comment) return;
  await db.blogComment.delete({ where: { id } });
  revalidatePath(`/blog/${comment.postId}`);
}
