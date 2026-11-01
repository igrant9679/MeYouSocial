"use server";

import { revalidatePath } from "next/cache";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { NOTIFICATION_KINDS, isNotificationKind } from "@/lib/notify";

/** FR-16 — reading and tuning your own notifications. Always self-scoped. */

/**
 * The workspaces a bulk action reaches (E-SHL-08): this one, or — from the
 * all-workspaces view — every one this person is an active member of. Never a
 * workspace id from the form; the list is always their own memberships.
 */
async function scopeFor(formData: FormData) {
  const { user, workspace } = await requireMembership();
  const workspaceIds = formData.get("scope") === "all"
    ? user.memberships.filter((m) => m.status === "active").map((m) => m.workspaceId)
    : [workspace.id];
  const kind = String(formData.get("kind") ?? "");
  return { userId: user.id, workspaceId: { in: workspaceIds }, ...(isNotificationKind(kind) ? { kind } : {}) };
}

export async function markNotificationReadAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { user } = await requireMembership();
  // Any of your own, in any workspace you're still in — the all-workspaces view lists them together.
  const memberOf = user.memberships.filter((m) => m.status === "active").map((m) => m.workspaceId);
  await db.notification.updateMany({
    where: { id, userId: user.id, workspaceId: { in: memberOf }, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/notifications");
}

/** Marks read what the page is showing: this workspace or all of them, one kind or every kind. */
export async function markAllNotificationsReadAction(formData: FormData) {
  await db.notification.updateMany({
    where: { ...(await scopeFor(formData)), readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/notifications");
}

export async function clearReadNotificationsAction(formData: FormData) {
  await db.notification.deleteMany({
    where: { ...(await scopeFor(formData)), readAt: { not: null } },
  });
  revalidatePath("/notifications");
}

export async function saveNotificationPreferencesAction(formData: FormData) {
  const { user, workspace } = await requireMembership();
  for (const kind of NOTIFICATION_KINDS) {
    if (!isNotificationKind(kind)) continue;
    // The digest renders no in-app checkbox (it has no in-app form), so the
    // field is absent from the form — don't let that absence write `false`.
    const inApp = kind === "daily_digest" ? true : formData.get(`inapp_${kind}`) === "on";
    const emailOn = formData.get(`email_${kind}`) === "on";
    await db.notificationPreference.upsert({
      where: { workspaceId_userId_kind: { workspaceId: workspace.id, userId: user.id, kind } },
      update: { inApp, email: emailOn },
      create: { workspaceId: workspace.id, userId: user.id, kind, inApp, email: emailOn },
    });
  }
  revalidatePath("/notifications");
}
