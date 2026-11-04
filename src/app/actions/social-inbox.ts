"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { writeAudit } from "@/lib/governance";
import { sendInboxMessage, replyOnPost, replyToInboxReview, explainInboxSendError } from "@/lib/zernio/inbox";
import { markInboxStale } from "@/lib/zernio/inbox-cache";

/**
 * Answering from Engage: a direct-message reply, and a comment on our own post.
 *
 * ⚠ Both of these PUBLISH TO A REAL AUDIENCE the moment they succeed. There is
 * no draft, no queue and no undo — unlike a scheduled post, which passes the
 * approval gate and can be cancelled up to its slot. That shapes every rule
 * below: the account is re-checked against the workspace, the text is bounded,
 * an empty send is refused rather than silently no-oped, and every attempt is
 * audited whether it worked or not.
 */

type Flash = (msg: string, kind?: "err" | "ok") => never;

/**
 * ⚠ Unlike the other Social action files, `to` here ALREADY carries a query
 * string — we return to the specific thread (`?dm=…&acct=…`), not to a bare
 * tab. Appending "?err=…" produced `…&acct=x?err=y`, a second question mark
 * that leaves `err` inside the value of `acct`, so the page rendered no banner
 * at all. Caught by the tenancy negative test, which refused correctly and
 * then said nothing about it.
 */
function flashTo(to: string, msg: string, kind: "err" | "ok"): never {
  const sep = to.includes("?") ? "&" : "?";
  redirect(`${to}${sep}${kind === "err" ? "err" : "ok"}=${encodeURIComponent(msg)}`);
}

const MAX_LEN = 2000;

/** Reviews are the only drafted kind so far; DMs and comments share the box. */
const DRAFT_KIND = "review";

/**
 * Resolve the sending account, scoped to the caller's workspace.
 *
 * ⚠ THE TENANCY GUARD. `accountId` arrives from a form field, and Zernio would
 * happily accept any account id the API key can see — which, on a key shared
 * across profiles, includes another tenant's accounts. Without this check a
 * crafted request from one workspace could post as another company. Same
 * reasoning as the `find`-AND-`remove` scoping in the deletion registry.
 */
async function requireOwnAccount(workspaceId: string, accountId: string, back: Flash) {
  const account = await db.zernioAccount.findFirst({
    where: { workspaceId, accountId, status: "connected" },
    select: { accountId: true, platform: true, displayName: true, username: true },
  });
  if (!account) back("That account isn't connected to this workspace.");
  return account!;
}

function requireMessage(raw: FormDataEntryValue | null, back: Flash): string {
  const text = String(raw ?? "").trim();
  if (!text) back("Write something first — an empty reply isn't sent.");
  if (text.length > MAX_LEN) back(`That's ${text.length} characters; keep a reply under ${MAX_LEN}.`);
  return text;
}

/** Reply inside a direct-message thread. */
export async function sendInboxReplyAction(formData: FormData) {
  const { workspace, membership } = await requireRole("EDITOR");
  const conversationId = String(formData.get("conversationId") ?? "");
  const accountId = String(formData.get("accountId") ?? "");
  // Land back on the thread we replied in, not on the inbox root.
  const back: Flash = (msg, kind = "err") =>
    flashTo(
      `/social/engage?dm=${encodeURIComponent(conversationId)}&acct=${encodeURIComponent(accountId)}`,
      msg, kind,
    );

  if (!conversationId || !accountId) back("Couldn't tell which conversation that was.");
  const account = await requireOwnAccount(workspace.id, accountId, back);
  const message = requireMessage(formData.get("message"), back);

  try {
    await sendInboxMessage({ workspaceId: workspace.id, conversationId, accountId, message });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await writeAudit({
      workspaceId: workspace.id, actorId: membership.userId,
      action: "social.dm_reply_failed", entityType: "zernio_conversation", entityId: conversationId,
      meta: { platform: account.platform, chars: message.length, error: detail.slice(0, 300) },
    });
    // Say what the network said, in words that name the fix. The raw form —
    // an HTTP 403 wrapping an fbtraceId — is preserved in the audit row above,
    // where a diagnosis needs it, not in front of the person who just lost a
    // reply they'd written.
    back(`Couldn't send that. ${explainInboxSendError(detail)}`);
  }

  await writeAudit({
    workspaceId: workspace.id, actorId: membership.userId,
    action: "social.dm_replied", entityType: "zernio_conversation", entityId: conversationId,
    meta: { platform: account.platform, account: account.displayName ?? account.username, chars: message.length },
  });
  await markInboxStale(workspace.id);
  revalidatePath("/social", "layout");
  back(`Sent on ${account.platform}.`, "ok");
}

/**
 * Reply to a review.
 *
 * Public, immediate, and attached to the business itself rather than to one
 * post — which is why it takes the same admin gate as a public comment while
 * the workspace reviews content before it goes out.
 */
export async function replyToReviewAction(formData: FormData) {
  const { workspace, membership } = await requireRole("EDITOR");
  const reviewId = String(formData.get("reviewId") ?? "");
  const accountId = String(formData.get("accountId") ?? "");
  const back: Flash = (msg, kind = "err") => flashTo("/social/engage", msg, kind);

  if (!reviewId || !accountId) back("Couldn't tell which review that was.");
  const account = await requireOwnAccount(workspace.id, accountId, back);

  if (!canAdmin(membership.role)) {
    const requireApproval =
      (await getSetting("social:require_approval", workspace.id).catch(() => "")) === "true";
    if (requireApproval) {
      back("This workspace reviews posts before they go out, so replying to a review is admin-only.");
    }
  }

  const message = requireMessage(formData.get("message"), back);

  try {
    await replyToInboxReview({ workspaceId: workspace.id, reviewId, accountId, message });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await writeAudit({
      workspaceId: workspace.id, actorId: membership.userId,
      action: "social.review_reply_failed", entityType: "zernio_review", entityId: reviewId,
      meta: { platform: account.platform, chars: message.length, error: detail.slice(0, 300) },
    });
    back(`Couldn't post that reply. ${explainInboxSendError(detail)}`);
  }

  await writeAudit({
    workspaceId: workspace.id, actorId: membership.userId,
    action: "social.review_replied", entityType: "zernio_review", entityId: reviewId,
    meta: { platform: account.platform, account: account.displayName ?? account.username, chars: message.length },
  });
  // A sent reply must not leave its draft standing, or the box would re-offer
  // text that is already public and invite a second copy of the same answer.
  await db.inboxReplyDraft.deleteMany({
    where: { workspaceId: workspace.id, kind: DRAFT_KIND, targetId: reviewId },
  });
  await markInboxStale(workspace.id);
  revalidatePath("/social", "layout");
  back(`Replied on ${account.platform}.`, "ok");
}

/**
 * Save a review reply WITHOUT sending it.
 *
 * ⚠ The point of this action is what it doesn't do. Every other reply in Engage
 * reaches a real audience the instant it succeeds, so a review — which stands
 * under the business for years, and is often answered long after it was written
 * — is the one answer worth reading twice before it exists in the world.
 *
 * ⚠ NOTHING DISPATCHES THESE. There is no sweep over drafts and there must
 * never be one: a draft becomes a reply only when a person presses Send, so one
 * left forgotten stays silent rather than surprising a customer months later.
 *
 * Deliberately NOT admin-gated under `social:require_approval`, unlike sending.
 * Writing an answer for someone else to weigh is the reviewED step, not the
 * publishing one — gating it would leave an editor nothing to do but ask an
 * admin to type.
 */
export async function saveReviewReplyDraftAction(formData: FormData) {
  const { user, workspace, membership } = await requireRole("EDITOR");
  const reviewId = String(formData.get("reviewId") ?? "");
  const accountId = String(formData.get("accountId") ?? "");
  const back: Flash = (msg, kind = "err") => flashTo("/social/engage", msg, kind);

  if (!reviewId || !accountId) back("Couldn't tell which review that was.");
  // Same tenancy guard as sending. A draft names the account it would go out
  // as, and that name must be true when it is written, not only when it is sent.
  await requireOwnAccount(workspace.id, accountId, back);
  const message = requireMessage(formData.get("message"), back);
  const authorName = user.name ?? user.email;

  await db.inboxReplyDraft.upsert({
    where: {
      workspaceId_kind_targetId: { workspaceId: workspace.id, kind: DRAFT_KIND, targetId: reviewId },
    },
    create: {
      workspaceId: workspace.id, kind: DRAFT_KIND, targetId: reviewId,
      accountId, message, authorId: membership.userId, authorName,
    },
    // Saving again edits the draft in place rather than stacking a second one,
    // so two people can't end up holding rival answers to the same review.
    update: { message, accountId, authorId: membership.userId, authorName },
  });

  await writeAudit({
    workspaceId: workspace.id, actorId: membership.userId,
    action: "social.review_reply_drafted", entityType: "zernio_review", entityId: reviewId,
    meta: { chars: message.length },
  });
  revalidatePath("/social", "layout");
  back("Draft saved. Nothing has been sent.", "ok");
}

/** Throw away a saved draft. The review itself is untouched. */
export async function discardReviewReplyDraftAction(formData: FormData) {
  const { workspace, membership } = await requireRole("EDITOR");
  const reviewId = String(formData.get("reviewId") ?? "");
  const back: Flash = (msg, kind = "err") => flashTo("/social/engage", msg, kind);
  if (!reviewId) back("Couldn't tell which review that was.");

  // `deleteMany` scoped by workspace, never `delete` by id: it is the tenancy
  // boundary here, and a draft that has already gone (sent from another tab)
  // should report calmly rather than throwing a record-not-found.
  const { count } = await db.inboxReplyDraft.deleteMany({
    where: { workspaceId: workspace.id, kind: DRAFT_KIND, targetId: reviewId },
  });

  if (count > 0) {
    await writeAudit({
      workspaceId: workspace.id, actorId: membership.userId,
      action: "social.review_reply_draft_discarded", entityType: "zernio_review", entityId: reviewId,
      meta: {},
    });
  }
  revalidatePath("/social", "layout");
  back(count > 0 ? "Draft discarded." : "There was no draft to discard.", "ok");
}

/** Answer a comment by commenting on the post it sits under. */
export async function replyOnPostAction(formData: FormData) {
  const { workspace, membership } = await requireRole("EDITOR");
  const postId = String(formData.get("postId") ?? "");
  const accountId = String(formData.get("accountId") ?? "");
  const back: Flash = (msg, kind = "err") =>
    flashTo(
      `/social/engage?post=${encodeURIComponent(postId)}&acct=${encodeURIComponent(accountId)}`,
      msg, kind,
    );

  if (!postId || !accountId) back("Couldn't tell which post that was.");
  const account = await requireOwnAccount(workspace.id, accountId, back);

  // ⚠ A public comment IS publishing. A workspace that holds non-admins'
  // scheduled posts for review would otherwise let the same person say
  // anything it likes under those posts, immediately and to the same audience
  // — the governance gate with an open side door. Direct messages are exempt:
  // they're private correspondence, not broadcast.
  if (!canAdmin(membership.role)) {
    const requireApproval =
      (await getSetting("social:require_approval", workspace.id).catch(() => "")) === "true";
    if (requireApproval) {
      back("This workspace reviews posts before they go out, so public comments are admin-only. Direct-message replies are still yours to send.");
    }
  }

  const message = requireMessage(formData.get("message"), back);

  try {
    await replyOnPost({ workspaceId: workspace.id, postId, accountId, message });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await writeAudit({
      workspaceId: workspace.id, actorId: membership.userId,
      action: "social.comment_reply_failed", entityType: "zernio_post", entityId: postId,
      meta: { platform: account.platform, chars: message.length, error: detail.slice(0, 300) },
    });
    back(`Couldn't post that comment. ${explainInboxSendError(detail)}`);
  }

  await writeAudit({
    workspaceId: workspace.id, actorId: membership.userId,
    action: "social.comment_replied", entityType: "zernio_post", entityId: postId,
    meta: { platform: account.platform, account: account.displayName ?? account.username, chars: message.length },
  });
  await markInboxStale(workspace.id);
  revalidatePath("/social", "layout");
  back(`Comment posted on ${account.platform}.`, "ok");
}

// ── Team inbox (E-SOC-17) ─────────────────────────────────────────────────────

/** Where an Engage thread lives, for links in notifications and the way back. */
function threadPath(kind: string, targetId: string, accountId: string): string {
  const acct = `&acct=${encodeURIComponent(accountId)}`;
  if (kind === "conversation") return `/social/engage?dm=${encodeURIComponent(targetId)}${acct}`;
  if (kind === "comment") return `/social/engage?post=${encodeURIComponent(targetId)}${acct}`;
  return "/social/engage";
}

/**
 * Give a thread to someone in the team (or take it back). EDITOR, like
 * answering. The assignee must be an active editor or admin here — a viewer
 * can't answer, and a former member can't be handed work. Nothing is sent to
 * the network; the assignee gets an "assigned" notification.
 */
export async function assignInboxThreadAction(formData: FormData) {
  const { workspace, membership, user } = await requireRole("EDITOR");
  const kind = String(formData.get("kind") ?? "");
  const targetId = String(formData.get("targetId") ?? "");
  const accountId = String(formData.get("accountId") ?? "");
  const assigneeId = String(formData.get("assigneeId") ?? "").trim();
  const here = threadPath(kind, targetId, accountId);
  const back: Flash = (msg, k = "err") => flashTo(here, msg, k);
  const { isAssignableKind } = await import("@/lib/inbox-team");
  if (!isAssignableKind(kind) || !targetId) back("Couldn't tell which thread that was.");
  if (!assigneeId) {
    await db.engageAssignment.deleteMany({ where: { workspaceId: workspace.id, kind, targetId } });
    await writeAudit({ workspaceId: workspace.id, actorId: membership.userId, action: "social.inbox_unassigned", entityType: `inbox_${kind}`, entityId: targetId });
    revalidatePath("/social/engage");
    back("Unassigned — it's anyone's again.", "ok");
  }
  const assignee = await db.membership.findFirst({
    where: { workspaceId: workspace.id, userId: assigneeId, status: "active", role: { in: ["ADMIN", "EDITOR"] } },
    select: { userId: true, user: { select: { name: true, email: true } } },
  });
  if (!assignee) back("Only an editor or admin of this workspace can be given a thread.");
  const name = assignee!.user.name ?? assignee!.user.email ?? "them";
  await db.engageAssignment.upsert({
    where: { workspaceId_kind_targetId: { workspaceId: workspace.id, kind, targetId } },
    create: { workspaceId: workspace.id, kind, targetId, accountId: accountId || null, assigneeId, assignedById: membership.userId },
    update: { assigneeId, assignedById: membership.userId, accountId: accountId || null },
  });
  await writeAudit({ workspaceId: workspace.id, actorId: membership.userId, action: "social.inbox_assigned", entityType: `inbox_${kind}`, entityId: targetId, meta: { assignee: name } });
  if (assigneeId !== membership.userId) {
    const { notify } = await import("@/lib/notify");
    await notify({
      workspaceId: workspace.id,
      kind: "assigned",
      title: `${user.name ?? user.email ?? "Someone"} gave you ${kind === "conversation" ? "a message thread" : kind === "comment" ? "a post's comments" : "a review"} in Engage`,
      path: here,
      entityType: `inbox_${kind}`,
      entityId: targetId,
      userIds: [assigneeId],
      excludeUserId: membership.userId,
    });
  }
  revalidatePath("/social/engage");
  back(assigneeId === membership.userId ? "It's yours now." : `Given to ${name} — they've been told.`, "ok");
}

/**
 * An editor's public reply while this workspace reviews posts: it waits as a
 * draft for an admin to release. Nothing reaches the network here. One waiting
 * reply per post — writing again replaces it (and says so).
 */
export async function submitCommentForApprovalAction(formData: FormData) {
  const { workspace, membership, user } = await requireRole("EDITOR");
  const postId = String(formData.get("postId") ?? "");
  const accountId = String(formData.get("accountId") ?? "");
  const here = threadPath("comment", postId, accountId);
  const back: Flash = (msg, k = "err") => flashTo(here, msg, k);
  if (!postId || !accountId) back("Couldn't tell which post that was.");
  await requireOwnAccount(workspace.id, accountId, back);
  const message = requireMessage(formData.get("message"), back);
  const existing = await db.inboxReplyDraft.findUnique({ where: { workspaceId_kind_targetId: { workspaceId: workspace.id, kind: "comment", targetId: postId } }, select: { id: true } });
  await db.inboxReplyDraft.upsert({
    where: { workspaceId_kind_targetId: { workspaceId: workspace.id, kind: "comment", targetId: postId } },
    create: { workspaceId: workspace.id, kind: "comment", targetId: postId, accountId, message, authorId: membership.userId, authorName: user.name ?? user.email ?? null },
    update: { accountId, message, authorId: membership.userId, authorName: user.name ?? user.email ?? null },
  });
  await writeAudit({ workspaceId: workspace.id, actorId: membership.userId, action: "social.comment_submitted", entityType: "zernio_post", entityId: postId, meta: { chars: message.length, replaced: !!existing } });
  const { notify } = await import("@/lib/notify");
  await notify({
    workspaceId: workspace.id,
    kind: "approval_needed",
    title: `${user.name ?? user.email ?? "An editor"} wrote a public comment reply for approval`,
    body: message.slice(0, 140),
    path: here,
    entityType: "zernio_post",
    entityId: postId,
    excludeUserId: membership.userId,
  });
  revalidatePath("/social/engage");
  back(existing ? "Updated — the reply waiting for approval is now this text." : "Sent for approval — an admin will see it on this post. Nothing is public yet.", "ok");
}

/** ADMIN: release an editor's waiting reply — the text as the admin leaves it. */
export async function approveCommentReplyAction(formData: FormData) {
  const { workspace, membership } = await requireRole("ADMIN");
  const draftId = String(formData.get("draftId") ?? "");
  const draft = await db.inboxReplyDraft.findFirst({ where: { id: draftId, workspaceId: workspace.id, kind: "comment" } });
  if (!draft) redirect("/social/engage?err=" + encodeURIComponent("That reply isn't waiting any more."));
  const here = threadPath("comment", draft.targetId, draft.accountId);
  const back: Flash = (msg, k = "err") => flashTo(here, msg, k);
  // Re-resolved now: a waiting reply is not a licence to post as an account the workspace has since lost.
  const account = await requireOwnAccount(workspace.id, draft.accountId, back);
  const message = requireMessage(formData.get("message") ?? draft.message, back);
  try {
    await replyOnPost({ workspaceId: workspace.id, postId: draft.targetId, accountId: draft.accountId, message });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await writeAudit({
      workspaceId: workspace.id, actorId: membership.userId,
      action: "social.comment_reply_failed", entityType: "zernio_post", entityId: draft.targetId,
      meta: { platform: account.platform, chars: message.length, approvedFor: draft.authorName, error: detail.slice(0, 300) },
    });
    back(`Couldn't post that comment — it's still waiting. ${explainInboxSendError(detail)}`);
  }
  await db.inboxReplyDraft.deleteMany({ where: { id: draft.id, workspaceId: workspace.id } });
  await writeAudit({
    workspaceId: workspace.id, actorId: membership.userId,
    action: "social.comment_replied", entityType: "zernio_post", entityId: draft.targetId,
    meta: { platform: account.platform, account: account.displayName ?? account.username, chars: message.length, approvedFor: draft.authorName, edited: message !== draft.message },
  });
  if (draft.authorId && draft.authorId !== membership.userId) {
    const { notify } = await import("@/lib/notify");
    await notify({ workspaceId: workspace.id, kind: "approval_decided", title: `Your comment reply was approved and posted${message !== draft.message ? " (with edits)" : ""}`, path: here, entityType: "zernio_post", entityId: draft.targetId, userIds: [draft.authorId] });
  }
  await markInboxStale(workspace.id);
  revalidatePath("/social", "layout");
  back(`Approved — comment posted on ${account.platform}.`, "ok");
}

/** ADMIN: send a waiting reply back. Nothing is posted; the author is told why. */
export async function declineCommentReplyAction(formData: FormData) {
  const { workspace, membership } = await requireRole("ADMIN");
  const draftId = String(formData.get("draftId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 300);
  const draft = await db.inboxReplyDraft.findFirst({ where: { id: draftId, workspaceId: workspace.id, kind: "comment" } });
  if (!draft) redirect("/social/engage?err=" + encodeURIComponent("That reply isn't waiting any more."));
  const here = threadPath("comment", draft.targetId, draft.accountId);
  await db.inboxReplyDraft.deleteMany({ where: { id: draft.id, workspaceId: workspace.id } });
  await writeAudit({ workspaceId: workspace.id, actorId: membership.userId, action: "social.comment_declined", entityType: "zernio_post", entityId: draft.targetId, meta: { author: draft.authorName, reason: reason || null } });
  if (draft.authorId && draft.authorId !== membership.userId) {
    const { notify } = await import("@/lib/notify");
    await notify({ workspaceId: workspace.id, kind: "approval_decided", title: "Your comment reply wasn't approved", body: reason ? `Why: ${reason}` : "No reason given.", path: here, entityType: "zernio_post", entityId: draft.targetId, userIds: [draft.authorId] });
  }
  revalidatePath("/social/engage");
  flashTo(here, "Declined — nothing was posted, and the author has been told.", "ok");
}
