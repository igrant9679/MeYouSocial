"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";

/**
 * Marking inbox events as seen.
 *
 * ⚠ Deliberately an EXPLICIT action, never a side effect of rendering. The
 * obvious design — mark a thread read when its page renders — is wrong here:
 * Next prefetches links on hover, so an unread comment could be silently
 * cleared by a mouse passing over it, and the one thing an unread badge must
 * never do is lie about what you've seen.
 */
export async function markInboxEventsReadAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const threadId = String(formData.get("threadId") ?? "").trim();
  const back = String(formData.get("back") ?? "/social/engage");

  const { count } = await db.socialInboxEvent.updateMany({
    // Tenancy in the WHERE, not just the lookup — a threadId from another
    // workspace must match nothing.
    where: { workspaceId: workspace.id, readAt: null, ...(threadId ? { threadId } : {}) },
    data: { readAt: new Date() },
  });

  revalidatePath("/social", "layout");
  const target = back.startsWith("/social") ? back : "/social/engage";
  const sep = target.includes("?") ? "&" : "?";
  redirect(`${target}${sep}ok=${encodeURIComponent(count === 1 ? "Marked 1 item as seen." : `Marked ${count} items as seen.`)}`);
}

function backTo(back: string, ok: string): never {
  const target = back.startsWith("/social") ? back : "/social/engage";
  const sep = target.includes("?") ? "&" : "?";
  redirect(`${target}${sep}ok=${encodeURIComponent(ok)}`);
}

/**
 * The two local states an Engage item can carry, and the one thing they share:
 * NEITHER TOUCHES THE NETWORK.
 *
 * A review stays public, a DM stays in the other person's thread, a comment
 * stays on the post. All this records is what the workspace has decided about
 * the item, so Engage can stop presenting a settled thing as work. The UI must
 * never imply otherwise.
 *
 *   read  — "I have seen this." Stays in the normal list.
 *   aside — "I have decided not to act on it." Moves to a collapsed group and
 *           stops counting. On 2026-08-12 the owner decided not to answer two
 *           Facebook reviews from 2020/21; for five weeks Engage kept offering
 *           them with an open reply box, because there was nowhere to put that
 *           decision (audit A5).
 *
 * Both also mark the item's webhook events read. An event is "something
 * arrived"; once you have read or settled the thing it announced, the arrival
 * is no longer news, and leaving it unread would keep the Engage badge lit for
 * work already done.
 */
async function setItemState(formData: FormData, state: "read" | "aside") {
  const { user, workspace } = await requireRole("EDITOR");
  const kind = String(formData.get("kind") ?? "review").trim();
  const targetId = String(formData.get("targetId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 300);
  const back = String(formData.get("back") ?? "/social/engage");
  if (!targetId) return { back, ok: null as string | null };

  await db.socialInboxItemState.upsert({
    where: { workspaceId_kind_targetId: { workspaceId: workspace.id, kind, targetId } },
    update: { state, reason: reason || null, actorId: user.id, actorName: user.name ?? user.email },
    create: {
      workspaceId: workspace.id,
      kind,
      targetId,
      state,
      reason: reason || null,
      actorId: user.id,
      actorName: user.name ?? user.email,
    },
  });

  // The arrival that announced this item is no longer news.
  await db.socialInboxEvent.updateMany({
    where: { workspaceId: workspace.id, readAt: null, threadId: targetId },
    data: { readAt: new Date() },
  });

  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: state === "read" ? "social.inbox_read" : "social.inbox_dismissed",
    entityType: "social_inbox_item",
    entityId: targetId,
    meta: { kind, reason: reason || null },
  });

  revalidatePath("/social", "layout");
  return {
    back,
    ok: state === "read"
      ? "Marked as read."
      : kind === "review"
        ? "Review set aside — it stays public, it just stops asking."
        : "Set aside.",
  };
}

/** "I have seen this." */
export async function markInboxItemReadAction(formData: FormData) {
  const { back, ok } = await setItemState(formData, "read");
  if (ok) backTo(back, ok);
}

/** "I have decided not to act on this." */
export async function dismissInboxItemAction(formData: FormData) {
  const { back, ok } = await setItemState(formData, "aside");
  if (ok) backTo(back, ok);
}

/** Undo either: the item goes back to being something waiting on a person. */
export async function restoreInboxItemAction(formData: FormData) {
  const { user, workspace } = await requireRole("EDITOR");
  const kind = String(formData.get("kind") ?? "review").trim();
  const targetId = String(formData.get("targetId") ?? "").trim();
  const back = String(formData.get("back") ?? "/social/engage");
  if (!targetId) return;

  await db.socialInboxItemState.deleteMany({ where: { workspaceId: workspace.id, kind, targetId } });
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "social.inbox_restored",
    entityType: "social_inbox_item",
    entityId: targetId,
    meta: { kind },
  });

  revalidatePath("/social", "layout");
  backTo(back, "Back in the queue.");
}
