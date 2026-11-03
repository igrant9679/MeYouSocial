import { db } from "@/lib/db";
import { emailFor as mailerFor } from "@/lib/email";
import { getPublicUrl } from "@/lib/public-url";
import { PRODUCT } from "@/lib/product";

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
  "approval_decided",
  "published",
  "publish_failed",
  "scheduled",
  "assigned",
  "comment",
  // Someone @mentioned this person in a review comment (E-ART-15).
  "mentioned",
  "account_broken",
  // An unattended AI generation failed and was refused (mock fallback /
  // provider down). The autopilot retries on its own, so this is chatty-tier.
  "generation_failed",
  // Who-can-do-what changed: a role, an admin, a key, an adopted account, the operator (E-SEC-12). Admins only.
  "security",
  // A suggestion arrived on a channel's public topic form (E-SET-08); one item per channel a day, counting repeats.
  "submission",
  // A background job used its last retry and stopped (E-ENG-17). Admins only; one item per job kind a day.
  "job_failed",
  // Email-only, sent by src/lib/digest.ts (never through notify() — Home IS
  // the in-app digest, so a bell item would be spam). Listed here so the
  // preference row and its toggle exist in the Notifications UI.
  "daily_digest",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const KIND_LABELS: Record<NotificationKind, string> = {
  approval_needed: "Something needs approval",
  approval_decided: "A decision on my submitted post",
  published: "A post was published",
  publish_failed: "A publish failed",
  scheduled: "A post was scheduled",
  assigned: "I was assigned a review",
  comment: "A comment on something I'm on",
  mentioned: "Someone @mentioned me in a comment",
  account_broken: "A connected account stopped working",
  generation_failed: "An AI generation failed and was refused",
  security: "A security change — roles, admins, keys, accounts (admins)",
  submission: "A topic suggestion arrived on a channel's public form",
  job_failed: "A background job gave up after its retries (admins)",
  daily_digest: "The morning digest of what needs me (admins, email only)",
};

/** Email defaults to off for the chatty kinds, on for the ones that need a human. */
const EMAIL_DEFAULT: Record<NotificationKind, boolean> = {
  approval_needed: true,
  approval_decided: true,
  published: false,
  publish_failed: true,
  scheduled: false,
  assigned: true,
  comment: false,
  // Emailed by default: a mention is someone asking this person by name.
  mentioned: true,
  // Emailed by default: this one is silent until a post fails, which is the
  // exact failure mode it exists to prevent.
  account_broken: true,
  // In-app only by default: the autopilot retries every cycle, and a provider
  // blip should not email anyone. Persistent failure surfaces via the digest's
  // stalled-content checks.
  generation_failed: false,
  // Emailed by default: a change nobody expected is exactly what this is for.
  security: true,
  // In-app only by default: a public form can be busy.
  submission: false,
  // In-app only: Settings → Jobs has the detail and a Retry.
  job_failed: false,
  // Default-on: it only ever sends when a warn-severity decision is waiting,
  // so the quiet-day cost is zero. digest.ts reads this preference directly.
  daily_digest: true,
};

/**
 * Kinds that repeat for the same thing until a person acts — the autopilot
 * retries a failing publish every 30 minutes, and this emailed every admin and
 * editor each time (ENG-13). One notice per thing per window; a different
 * title (held → failed) is a different notice.
 */
const DEDUPE_HOURS: Partial<Record<NotificationKind, number>> = {
  publish_failed: 24, account_broken: 24,
  // One item per kind and thing a day (E-ENG-18): the same approval, schedule,
  // publish or failed generation said again within the day is the same news.
  generation_failed: 24, approval_needed: 24, approval_decided: 24, scheduled: 24, published: 24, submission: 24, job_failed: 24,
};

/** Failures that repeat: a second one updates the first ("repeated 3 times today") instead of being dropped unseen. */
const COUNT_REPEATS: ReadonlySet<NotificationKind> = new Set(["publish_failed", "generation_failed", "account_broken", "submission", "job_failed"]);
const REPEATED = /\s*\(repeated (\d+) times today\)$/;

/** Distinct failed generations in a day past which they roll into one summary item (E-ENG-18). */
const ROLLUP_AFTER = 3;

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
  const roles = kind === "approval_needed" || kind === "security" || kind === "job_failed" ? ["ADMIN"] : ["ADMIN", "EDITOR"];
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

    // A day of failed generations about different things rolls into one item
    // once there are ROLLUP_AFTER of them, rather than one per thing.
    const dayStart = new Date(Date.now() - 24 * 3_600_000);
    if (input.kind === "generation_failed" && input.entityId && !input.entityId.startsWith("rollup:")) {
      const distinct = await db.notification.findMany({
        where: { workspaceId: input.workspaceId, kind: "generation_failed", createdAt: { gte: dayStart }, NOT: { entityId: { startsWith: "rollup:" } } },
        distinct: ["entityId"], select: { entityId: true },
      });
      if (distinct.length >= ROLLUP_AFTER && !distinct.some((d) => d.entityId === input.entityId)) {
        input = {
          ...input,
          title: "Several AI generations failed today",
          body: `The latest: ${input.title}. The autopilot retries each on its own; Settings → Usage shows which provider refused.`,
          entityId: `rollup:${new Date().toISOString().slice(0, 10)}`,
        };
      }
    }

    const dedupeHours = DEDUPE_HOURS[input.kind];
    if (dedupeHours && input.entityId) {
      const same = {
        workspaceId: input.workspaceId, kind: input.kind, entityId: input.entityId,
        title: input.title.slice(0, 200), createdAt: { gte: new Date(Date.now() - dedupeHours * 3_600_000) },
      };
      const seen = await db.notification.findMany({ where: same, select: { id: true, body: true } });
      if (seen.length) {
        // Counted on the item already there, and back to unread so the bell shows it again — no second email.
        if (COUNT_REPEATS.has(input.kind)) {
          for (const n of seen) {
            const base = (n.body ?? "").replace(REPEATED, "");
            const times = Number((n.body ?? "").match(REPEATED)?.[1] ?? 1) + 1;
            await db.notification.update({ where: { id: n.id }, data: { body: `${base} (repeated ${times} times today)`.trim(), readAt: null } });
          }
        }
        return 0;
      }
    }

    const prefs = await preferencesFor(input.workspaceId, recipients, input.kind);
    const inAppFor = recipients.filter((id) => prefs.get(id)?.inApp !== false);
    const emailFor = recipients.filter((id) => prefs.get(id)?.email);

    // Email first, so emailedAt marks mail that LEFT — a mocked send (no
    // mailbox, SMTP blocked) is not delivered and isn't stamped (ENG-20).
    const delivered = new Set<string>();
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
                  `<p><a href="${link}">Open in ${PRODUCT}</a></p>`,
                  `<p style="color:#888;font-size:12px">You can turn this email off under Notifications.</p>`,
                ].join("\n"),
                text: `${input.title}\n\n${input.body ?? ""}\n\n${link}`,
              })
              .then((r) => { if (!r.mocked) delivered.add(u.id); })
              .catch(() => undefined),
          ),
      );
    }
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
          emailedAt: delivered.has(userId) ? new Date() : null,
        })),
      });
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
