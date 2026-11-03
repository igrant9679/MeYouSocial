import { cookies } from "next/headers";
import { db } from "@/lib/db";

/**
 * Read-only "view as" for support (E-SET-10): the platform operator can look at
 * a tenant the way a viewer does — no membership made, nothing writable —
 * beside "Enter", which joins as admin.
 *
 * How it holds: a short-lived cookie names the workspace, and requireMembership
 * (lib/acl.ts) answers for the operator ONLY with a synthetic VIEWER membership
 * of it. Every write in the app already requires EDITOR or ADMIN, so the view is
 * read-only without a single new check. Nothing is added to People, and nothing
 * outlives the cookie.
 *
 * Visible to the tenant: starting it is audited (and its admins get a security
 * notice), and while it lasts every member sees a line in the shell saying the
 * operator is looking, until when — the `support:viewing` setting below.
 */

export const SUPPORT_COOKIE = "mys_support_view";
export const SUPPORT_HOURS = 4;
export const SUPPORT_SETTING = "support:viewing";
/** The synthetic membership's id — how a page can tell a support view from a real viewer. */
export const SUPPORT_MEMBERSHIP_ID = "support-view";

export type SupportView = { email: string; since: string; until: string };

/** The workspace the operator's support cookie names, if any. */
export async function supportCookieWorkspace(): Promise<string | null> {
  try {
    return (await cookies()).get(SUPPORT_COOKIE)?.value || null;
  } catch {
    return null; // no request (a sweep)
  }
}

/** The support view running on a workspace, for its members' banner — null when none, or when it has run out. */
export async function activeSupportView(workspaceId: string, now = Date.now()): Promise<SupportView | null> {
  const row = await db.workspaceSetting.findUnique({ where: { workspaceId_key: { workspaceId, key: SUPPORT_SETTING } } }).catch(() => null);
  if (!row?.value) return null;
  try {
    const v = JSON.parse(row.value) as SupportView;
    return Date.parse(v.until) > now ? v : null;
  } catch {
    return null;
  }
}
