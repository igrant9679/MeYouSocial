import { db } from "@/lib/db";
import { emailFor as mailerFor } from "@/lib/email";
import { getPublicUrl } from "@/lib/public-url";

/**
 * FR-16 — notifications.
 *
 * In-app is the default and always on; email is opt-in per user per kind and
 * rides the SMTP layer the workspace already configured. Nothing here is
 * allowed to throw: a notification failing must never take down the publish or
 * approval it was reporting on.
 *
 * Slack is listed in FR-16 as a third channel — it needs an app registration
 * and an OAuth flow, so it stays a connector to build, not a stub to pretend
 * with.
 */

export const NOTIFICATION_KINDS = [
  "approval_needed",
  "published",
  "publish_failed",
  "scheduled",
  "assigned",
  "comment",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const KIND_LABELS: Record<NotificationKind, string> = {
  approval_needed: "Something needs approval",
  published: "A post was published",
  publish_failed: "A publish failed",
  scheduled: "A post was scheduled",
  assigned: "I was assigned a review",
  comment: "A comment on something I'm on",
};

/** Email defaults to off for the chatty kinds, on for the ones that need a human. */
const EMAIL_DEFAULT: Record<NotificationKind, boolean> = {
  approval_needed: true,
  published: false,
  publish_failed: true,
  scheduled: false,
  assigned: true,
  comment: false,
};

export function isNotificationKind(k: string): k is NotificationKind {
  return (NOTIFICATION_KINDS as readonly string[]).includes(k);
}

type NotifyInput = {
  workspaceId: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  /** Path (not absolute URL) — the origin is resolved at send time. */
  path?: string | null;
  entityType?: string;
  entityId?: string | null;
  /** Explicit recipients. Omit to notify everyone who can act in the workspace. */
  userIds?: string[];
  /** Never notify the person who caused the event. */
  excludeUserId?: string | null;
};

/** Who can actually act on a workspace event. */
async function defaultRecipients(workspaceId: string, kind: NotificationKind): Promise<string[]> {
  const roles = kind === "approval_needed" ? ["ADMIN"] : ["ADMIN", "EDITOR"];
  const rows = await db.membership.findMany({
    where: { workspaceId, status: "active", role: { in: roles as Array<"ADMIN" | "EDITOR"> } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

async function preferencesFor(
  workspaceId: string,
  userIds: string[],
  kind: NotificationKind,
): Promise<Map<string, { inApp: boolean; email: boolean }>> {
  const rows = await db.notificationPreference.findMany({
    where: { workspaceId, kind, userId: { in: userIds } },
  });
  const out = new Map<string, { inApp: boolean; email: boolean }>();
  for (const id of userIds) out.set(id, { inApp: true, email: EMAIL_DEFAULT[kind] });
  for (const r of rows) out.set(r.userId, { inApp: r.inApp, email: r.email });
  return out;
}

/** Fire a notification. Returns how many in-app rows were written. */
export async function notify(input: NotifyInput): Promise<number> {
  try {
    let recipients = input.userIds?.length
      ? input.userIds
      : await defaultRecipients(input.workspaceId, input.kind);
    if (input.excludeUserId) recipients = recipients.filter((id) => id !== input.excludeUserId);
    recipients = [...new Set(recipients)];
    if (!recipients.length) return 0;

    const prefs = await preferencesFor(input.workspaceId, recipients, input.kind);
    const inAppFor = recipients.filter((id) => prefs.get(id)?.inApp !== false);
    const emailFor = recipients.filter((id) => prefs.get(id)?.email);

    if (inAppFor.length) {
      await db.notification.createMany({
        data: inAppFor.map((userId) => ({
          workspaceId: input.workspaceId,
          userId,
          kind: input.kind,
          title: input.title.slice(0, 200),
          body: input.body?.slice(0, 1000) ?? null,
          url: input.path ?? null,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          emailedAt: emailFor.length ? new Date() : null,
        })),
      });
    }

    if (emailFor.length) {
      const users = await db.user.findMany({
        where: { id: { in: emailFor } },
        select: { id: true, email: true, name: true },
      });
      const origin = await getPublicUrl();
      const link = input.path ? `${origin.replace(/\/+$/, "")}${input.path}` : origin;
      await Promise.all(
        users
          .filter((u) => !!u.email)
          .map((u) =>
            mailerFor(input.workspaceId)
              .send({
                to: u.email!,
                subject: input.title.slice(0, 150),
                html: [
                  `<p>${escapeHtml(input.title)}</p>`,
                  input.body ? `<p style="color:#555">${escapeHtml(input.body)}</p>` : "",
                  `<p><a href="${link}">Open in MeYouSocial</a></p>`,
                  `<p style="color:#888;font-size:12px">You can turn this email off under Notifications.</p>`,
                ].join("\n"),
                text: `${input.title}\n\n${input.body ?? ""}\n\n${link}`,
              })
              .catch(() => undefined),
          ),
      );
    }
    return inAppFor.length;
  } catch {
    // A notification must never break the thing it reports on.
    return 0;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function unreadCount(workspaceId: string, userId: string): Promise<number> {
  try {
    return await db.notification.count({ where: { workspaceId, userId, readAt: null } });
  } catch {
    return 0;
  }
}
