import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { notify } from "@/lib/notify";

/**
 * The review decisions on a held social post — approve, or send back with a
 * note. Moved out of the actions file (E-SOC-03) so a client's answer on an
 * approval link goes through the SAME path as the Approve and Request changes
 * buttons. ⚠ Plain functions, never server actions: they take a userId and a
 * workspaceId as arguments, so exporting them from a "use server" file would
 * let any browser call them with someone else's. Callers check who may decide.
 */

/** What one review decision did — the single buttons flash it, the bulk one counts it. */
export type Decided = { ok: boolean; message: string; outcome?: "scheduled" | "queued" | "draft"; reason?: string };

/**
 * Approve one held post. The Approve button, "Approve for a time" and the bulk
 * Approve all come through here (E-SOC-02). `at` is a moment the reviewer
 * picked: it must be ahead of now, and it wins over the author's requested time
 * and the queue — it's kept as the post's chosen time even when a network rule
 * keeps the post a draft. `from` is the review states it may decide: the bulk
 * bar passes only "pending", so a stale tick can't approve a post a reviewer
 * has just sent back.
 */
export async function approvePost(workspaceId: string, userId: string, id: string, at: Date | null = null, from: string[] = ["pending", "changes"]): Promise<Decided> {
  const post = await db.socialPost.findFirst({ where: { id, workspaceId } });
  if (!post) return { ok: false, message: "Post not found." };
  if (!post.approval || !from.includes(post.approval)) return { ok: false, message: "That post isn't waiting for approval." };
  if (at && at.getTime() <= Date.now()) return { ok: false, message: "That time has already passed — pick one ahead of now." };

  // Honor the time the author asked for, if it's still ahead of us. A past
  // requested time doesn't auto-send — approval means "may go", not "goes now".
  // …but a post its networks would certainly reject is approved and stays a
  // draft, with the reason (SOC-14) — scheduled, it would only fail at send.
  const { scheduleRefusal } = await import("@/lib/social/validate");
  const refusal = await scheduleRefusal(post.id);
  const requested = !at && post.scheduledAt && post.scheduledAt.getTime() > Date.now() - 60_000;
  const scheduleIt = !refusal && (at !== null || Boolean(requested));

  /**
   * Auto-queue: an approved post with no time of its own takes the next free
   * slot, instead of landing back in the draft pile.
   *
   * ⚠ THIS EXISTS BECAUSE APPROVAL IS NOT QUEUEING, and that cost a week of
   * silence. On 2026-08-17 LSI held five approved posts — one approved six days
   * earlier — and nothing had gone out since 10 Aug, because autogen mints
   * drafts, a human approves them, and then a THIRD click ("Queue all") was
   * still required with nothing anywhere saying so.
   *
   * OPT-IN per workspace (`social:autoqueue` = "true", default OFF) — same
   * convention as `social:evergreen_fill`, and for the same reason: turning it
   * on means approving a post is the last human act before it reaches an
   * audience, which is a decision the owner makes deliberately, not a default
   * they discover afterwards.
   */
  const { getSetting } = await import("@/lib/settings");
  const autoqueueOn = (await getSetting("social:autoqueue", workspaceId).catch(() => "")) === "true";
  let queuedAt: Date | null = null;
  if (!scheduleIt && !refusal && !at && autoqueueOn) {
    const { nextFreeSlot } = await import("@/lib/social/slots");
    // Category rules are honored by nextFreeSlot — a categorized post prefers
    // its own lane. A full calendar leaves it a draft and SAYS so below,
    // rather than inventing a time no slot asked for.
    queuedAt = await nextFreeSlot(workspaceId, post.id, post.category);
  }

  // Claimed in the write: a second reviewer (or a second bulk press) finds it
  // already decided and changes nothing.
  const r = await db.socialPost.updateMany({
    where: { id: post.id, workspaceId, approval: { in: from } },
    data: {
      approval: "approved",
      approvedById: userId,
      approvedAt: new Date(),
      reviewNote: null,
      ...(at ? { scheduledAt: at, timeChosen: true } : {}),
      ...(queuedAt ? { scheduledAt: queuedAt, timeChosen: false } : {}),
      status: scheduleIt || queuedAt ? "scheduled" : "draft",
    },
  });
  if (!r.count) return { ok: false, message: "That post isn't waiting for approval." };
  await writeAudit({
    workspaceId, actorId: userId, action: "social.approved",
    entityType: "social_post", entityId: post.id,
    meta: { ...(queuedAt ? { autoQueuedAt: queuedAt.toISOString() } : {}), ...(at ? { approvedFor: at.toISOString() } : {}) },
  });
  if (post.createdById && post.createdById !== userId) {
    await notify({
      workspaceId,
      kind: "approval_decided",
      title: scheduleIt || queuedAt ? "Your post was approved and scheduled" : "Your post was approved",
      body: post.text.slice(0, 140),
      path: "/social",
      entityType: "social_post",
      entityId: post.id,
      userIds: [post.createdById],
    });
  }

  const { formatInZone, resolveTimeZone } = await import("@/lib/social/slots");
  const { timeZone } = await resolveTimeZone(workspaceId);
  if (refusal) return { ok: true, outcome: "draft", reason: refusal, message: `Approved, but kept as a draft: ${refusal}` };
  if (at) return { ok: true, outcome: "scheduled", message: `Approved and scheduled for ${formatInZone(at, timeZone)}.` };
  if (scheduleIt) return { ok: true, outcome: "scheduled", message: "Approved — it keeps its scheduled time." };
  if (queuedAt) return { ok: true, outcome: "queued", message: `Approved and queued for ${formatInZone(queuedAt, timeZone)}.` };
  // Auto-queue on and still a draft: name the actual cause. ⚠ These are two
  // different faults and they were one message until a fixture run caught it —
  // slots RECUR, so `free` spans weeks ahead and is essentially never empty.
  // In practice "nothing was queued" means NO SLOTS EXIST, and telling that
  // owner the calendar is full sends them looking for a queue to clear.
  if (autoqueueOn) {
    const slots = await db.postingSlot.count({ where: { workspaceId, enabled: true } });
    const reason = slots === 0 ? "this workspace has no posting slots" : "every upcoming slot is taken";
    return {
      ok: true, outcome: "draft", reason,
      message: slots === 0
        ? "Approved — but this workspace has no posting slots, so there was nowhere to queue it. Add slots under Settings → Schedule."
        : "Approved — but every upcoming slot is taken, so it's still a draft. Add slots under Settings → Schedule.",
    };
  }
  return { ok: true, outcome: "draft", message: "Approved — it's a draft, ready to queue or send." };
}

/** Send one pending post back to its author. A note is also the first entry on its review thread. */
export async function requestChanges(workspaceId: string, userId: string, id: string, note: string): Promise<Decided> {
  const post = await db.socialPost.findFirst({ where: { id, workspaceId }, select: { id: true, approval: true, createdById: true, text: true } });
  if (!post) return { ok: false, message: "Post not found." };
  if (post.approval !== "pending") return { ok: false, message: "That post isn't waiting for approval." };
  const r = await db.socialPost.updateMany({
    where: { id: post.id, workspaceId, approval: "pending" },
    data: { approval: "changes", reviewNote: note || null, status: "draft" },
  });
  if (!r.count) return { ok: false, message: "That post isn't waiting for approval." };
  if (note) await db.socialPostComment.create({ data: { postId: post.id, authorId: userId, body: note, kind: "changes" } });
  await writeAudit({
    workspaceId, actorId: userId, action: "social.changes_requested",
    entityType: "social_post", entityId: post.id, meta: note ? { note } : {},
  });
  if (post.createdById && post.createdById !== userId) {
    await notify({
      workspaceId,
      kind: "approval_decided",
      title: "Changes requested on your post",
      body: note || post.text.slice(0, 140),
      path: "/social",
      entityType: "social_post",
      entityId: post.id,
      userIds: [post.createdById],
    });
  }
  return { ok: true, message: "Changes requested — the author has been notified." };
}
