"use server";

import { revalidatePath } from "next/cache";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { NOTIFICATION_KINDS, isNotificationKind } from "@/lib/notify";

/** FR-16 — reading and tuning your own notifications. Always self-scoped. */

export async function markNotificationReadAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { user, workspace } = await requireMembership();
  await db.notification.updateMany({
    where: { id, workspaceId: workspace.id, userId: user.id },
    data: { readAt: new Date() },
  });
  revalidatePath("/notifications");
}

export async function markAllNotificationsReadAction() {
  const { user, workspace } = await requireMembership();
  await db.notification.updateMany({
    where: { workspaceId: workspace.id, userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/notifications");
}

export async function clearReadNotificationsAction() {
  const { user, workspace } = await requireMembership();
  await db.notification.deleteMany({
    where: { workspaceId: workspace.id, userId: user.id, readAt: { not: null } },
  });
  revalidatePath("/notifications");
}

export async function saveNotificationPreferencesAction(formData: FormData) {
  const { user, workspace } = await requireMembership();
  for (const kind of NOTIFICATION_KINDS) {
    if (!isNotificationKind(kind)) continue;
    const inApp = formData.get(`inapp_${kind}`) === "on";
    const emailOn = formData.get(`email_${kind}`) === "on";
    await db.notificationPreference.upsert({
      where: { workspaceId_userId_kind: { workspaceId: workspace.id, userId: user.id, kind } },
      update: { inApp, email: emailOn },
      create: { workspaceId: workspace.id, userId: user.id, kind, inApp, email: emailOn },
    });
  }
  revalidatePath("/notifications");
}
