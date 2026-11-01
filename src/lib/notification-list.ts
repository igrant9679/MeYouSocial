import { db } from "@/lib/db";
import { isNotificationKind, type NotificationKind } from "@/lib/notify";

/**
 * The Notifications page's list (E-SHL-08): a kind filter, unread-only, pages,
 * and an "every workspace" view for people in more than one. Everything is
 * self-scoped — the recipient is always the signed-in user, and the workspaces
 * are their own active memberships (a deleted workspace is nobody's to read).
 */

export const NOTIFICATIONS_PER_PAGE = 30;

export type NotificationQuery = {
  kind: NotificationKind | null;
  unread: boolean;
  /** "all" = every workspace this person is an active member of. */
  scope: "here" | "all";
  page: number;
};

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseNotificationQuery(sp: Params): NotificationQuery {
  const kind = one(sp.kind);
  const page = Math.floor(Number(one(sp.page)));
  return {
    kind: isNotificationKind(kind) ? kind : null,
    unread: one(sp.unread) === "1",
    scope: one(sp.scope) === "all" ? "all" : "here",
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
}

/** The page's own URL for a query, with the defaults left out. */
export function notificationsHref(q: NotificationQuery, patch: Partial<NotificationQuery> = {}): string {
  const next = { ...q, ...patch };
  const sp = new URLSearchParams();
  if (next.scope === "all") sp.set("scope", "all");
  if (next.kind) sp.set("kind", next.kind);
  if (next.unread) sp.set("unread", "1");
  if (next.page > 1) sp.set("page", String(next.page));
  const s = sp.toString();
  return s ? `/notifications?${s}` : "/notifications";
}

/**
 * Where opening a notification may send someone: a path on this site, never
 * another origin. `url` is written by notify() as a path, so anything else is
 * a row this code didn't write — it opens the Notifications page instead.
 */
export function safeNotificationTarget(url: string | null | undefined): string | null {
  if (!url || !url.startsWith("/") || url.startsWith("//") || url.startsWith("/\\")) return null;
  return url;
}

export async function listNotifications(userId: string, workspaceIds: string[], q: NotificationQuery) {
  const base = { userId, workspaceId: { in: workspaceIds } };
  const where = { ...base, ...(q.unread ? { readAt: null } : {}), ...(q.kind ? { kind: q.kind } : {}) };
  const [items, total, byKind, unreadHere, anyRead] = await Promise.all([
    db.notification.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (q.page - 1) * NOTIFICATIONS_PER_PAGE,
      take: NOTIFICATIONS_PER_PAGE,
    }),
    db.notification.count({ where }),
    // The kind chips count within the scope and the unread toggle, not the kind itself.
    db.notification.groupBy({ by: ["kind"], where: { ...base, ...(q.unread ? { readAt: null } : {}) }, _count: { _all: true } }),
    db.notification.count({ where: { ...base, readAt: null, ...(q.kind ? { kind: q.kind } : {}) } }),
    db.notification.count({ where: { ...base, readAt: { not: null }, ...(q.kind ? { kind: q.kind } : {}) } }),
  ]);
  const kinds = byKind
    .filter((k) => isNotificationKind(k.kind))
    .map((k) => ({ kind: k.kind as NotificationKind, count: k._count._all }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
  const pages = Math.max(1, Math.ceil(total / NOTIFICATIONS_PER_PAGE));
  return { items, total, pages, kinds, unread: unreadHere, anyRead: anyRead > 0 };
}

/** Unread items in this person's OTHER workspaces — the hint that the all-workspaces view has something. */
export async function unreadElsewhere(userId: string, otherWorkspaceIds: string[]): Promise<number> {
  if (!otherWorkspaceIds.length) return 0;
  return db.notification.count({ where: { userId, workspaceId: { in: otherWorkspaceIds }, readAt: null } });
}
