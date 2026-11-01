import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_WS_COOKIE, activeWorkspaceIdFor, getCurrentUser } from "@/lib/acl";
import { db } from "@/lib/db";
import { safeNotificationTarget } from "@/lib/notification-list";

/**
 * Opening a notification (E-SHL-08): it's read now, and you land where it
 * points. One from another of your workspaces switches you into that one
 * first — its link is a path inside it, and would otherwise open the same page
 * of whichever company you happen to be in.
 *
 * A GET, so it works from a middle-click or a new tab; the page links here with
 * a plain <a> (no prefetch), and the row must be your own in a workspace you
 * are still an active member of.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const memberOf = new Set(user.memberships.filter((m) => m.status === "active").map((m) => m.workspaceId));
  const n = await db.notification.findFirst({ where: { id, userId: user.id }, select: { id: true, workspaceId: true, url: true, readAt: true } });
  if (!n || !memberOf.has(n.workspaceId)) redirect(`/notifications?error=${encodeURIComponent("That notification isn't yours to open, or its workspace is gone.")}`);

  if (!n.readAt) await db.notification.updateMany({ where: { id: n.id, readAt: null }, data: { readAt: new Date() } });
  const target = safeNotificationTarget(n.url);
  if (!target) redirect("/notifications");
  if ((await activeWorkspaceIdFor(user.id)) !== n.workspaceId) {
    (await cookies()).set(ACTIVE_WS_COOKIE, n.workspaceId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  }
  redirect(target);
}
