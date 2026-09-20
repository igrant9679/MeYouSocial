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
 * Set an Engage item aside — a review or a DM thread this workspace has
 * decided not to answer.
 *
 * ⚠ This changes NOTHING on the network, and the UI must not suggest it does.
 * A review the app sets aside is still public, still visible to everyone, and
 * still returned by the API; the app simply stops presenting it as work. That
 * distinction is the whole design: on 2026-08-12 the owner decided not to
 * answer two Facebook reviews from 2020/2021, and for five weeks Engage kept
 * offering them with an open reply box and a Send button (audit A5).
 */
export async function dismissInboxItemAction(formData: FormData) {
  const { user, workspace } = await requireRole("EDITOR");
  const kind = String(formData.get("kind") ?? "review").trim();
  const targetId = String(formData.get("targetId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 300);
  const back = String(formData.get("back") ?? "/social/engage");
  if (!targetId) return;

  await db.socialInboxDismissal.upsert({
    where: { workspaceId_kind_targetId: { workspaceId: workspace.id, kind, targetId } },
    update: { reason: reason || null, actorId: user.id, actorName: user.name ?? user.email },
    create: {
      workspaceId: workspace.id,
      kind,
      targetId,
      reason: reason || null,
      actorId: user.id,
      actorName: user.name ?? user.email,
    },
  });
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "social.inbox_dismissed",
    entityType: "social_inbox_item",
    entityId: targetId,
    meta: { kind, reason: reason || null },
  });

  revalidatePath("/social", "layout");
  backTo(back, kind === "review" ? "Review set aside — it stays public, it just stops asking." : "Set aside.");
}

/** Undo the above: the item goes back to being something waiting on a person. */
export async function restoreInboxItemAction(formData: FormData) {
  const { user, workspace } = await requireRole("EDITOR");
  const kind = String(formData.get("kind") ?? "review").trim();
  const targetId = String(formData.get("targetId") ?? "").trim();
  const back = String(formData.get("back") ?? "/social/engage");
  if (!targetId) return;

  await db.socialInboxDismissal.deleteMany({ where: { workspaceId: workspace.id, kind, targetId } });
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
