"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { notify } from "@/lib/notify";
import { parseMentions } from "@/lib/comment-anchors";

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
  const body = String(formData.get("body") ?? "").trim().slice(0, 4000);
  if (!body) return;
  const { user, workspace } = await requireRole("EDITOR");
  const post = await db.blogPost.findFirst({ where: { id: postId, workspaceId: workspace.id } });
  if (!post) return;

  // E-ART-15: @mentions are resolved now, against the people in this
  // workspace, so a name typed later can't reach someone who wasn't here.
  const members = await db.membership.findMany({
    where: { workspaceId: workspace.id, status: "active" },
    select: { userId: true, user: { select: { name: true, email: true } } },
  });
  const mentionIds = parseMentions(body, members.map((m) => ({ userId: m.userId, name: m.user.name, email: m.user.email })))
    .filter((id) => id !== user.id);

  const comment = await db.blogComment.create({
    data: {
      postId,
      authorId: user.id,
      body,
      anchor: String(formData.get("anchor") ?? "").trim().replace(/\s+/g, " ").slice(0, 300) || null,
      mentionIds,
    },
  });
  const path = `/blog/${post.id}?tab=review#comment-${comment.id}`;
  const author = user.name ?? user.email ?? "Someone";

  if (mentionIds.length) {
    await notify({
      workspaceId: workspace.id,
      kind: "mentioned",
      title: `${author} mentioned you on "${post.title}"`,
      body: body.slice(0, 300),
      path,
      entityType: "blog_post",
      entityId: post.id,
      userIds: mentionIds,
    });
  }

  // Tell the people actually on this post — the reviewer and the author — not
  // the whole workspace; anyone mentioned has already been told.
  const recipients = [post.reviewerId, post.createdById].filter(
    (id): id is string => !!id && id !== user.id && !mentionIds.includes(id),
  );
  if (recipients.length || !mentionIds.length) {
    await notify({
      workspaceId: workspace.id,
      kind: "comment",
      title: `New comment on "${post.title}"`,
      body: body.slice(0, 300),
      path,
      entityType: "blog_post",
      entityId: post.id,
      userIds: recipients.length ? recipients : undefined,
      excludeUserId: user.id,
    });
  }
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "blog.comment_added",
    entityType: "blog_post",
    entityId: post.id,
    meta: { commentId: comment.id, anchored: !!comment.anchor, mentions: mentionIds.length },
  });
  revalidatePath(`/blog/${postId}`);
}

export async function resolveBlogCommentAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { user, workspace } = await requireRole("EDITOR");
  const comment = await db.blogComment.findFirst({
    where: { id, post: { workspaceId: workspace.id } },
  });
  if (!comment) return;
  const resolved = !comment.resolved;
  // Conditional on the state this person saw, so two clicks don't undo each other.
  const r = await db.blogComment.updateMany({
    where: { id, resolved: comment.resolved },
    data: resolved ? { resolved, resolvedById: user.id, resolvedAt: new Date() } : { resolved, resolvedById: null, resolvedAt: null },
  });
  if (r.count) {
    await writeAudit({
      workspaceId: workspace.id,
      actorId: user.id,
      action: resolved ? "blog.comment_resolved" : "blog.comment_reopened",
      entityType: "blog_post",
      entityId: comment.postId,
      meta: { commentId: id },
    });
  }
  revalidatePath(`/blog/${comment.postId}`);
}

/** Its author, or an admin — someone else's note isn't an editor's to take back. */
export async function deleteBlogCommentAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { user, workspace, membership } = await requireRole("EDITOR");
  const comment = await db.blogComment.findFirst({
    where: { id, post: { workspaceId: workspace.id } },
  });
  if (!comment) return;
  if (comment.authorId !== user.id && membership.role !== "ADMIN") return;
  await db.blogComment.delete({ where: { id } });
  revalidatePath(`/blog/${comment.postId}`);
}
