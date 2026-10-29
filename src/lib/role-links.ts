import type { Role } from "@prisma/client";

/**
 * Which links a role can follow without bouncing to /forbidden (SHL-07).
 *
 * The Inbox's condition cards, the Settings strip, Help and Elsie's setup steps
 * all linked editors and viewers to admin-only pages; a viewer's "N things need
 * you" never reached zero because none of it was theirs to do. Surfaces that
 * link across roles ask here and, when the answer is no, say who can act
 * instead of offering a button that fails.
 *
 * ⚠ Mirrors the role gates in the page files — keep the two in step:
 *   ADMIN:  app/(app)/admin/layout.tsx (every /admin/* page), setup/people.
 *   EDITOR: the social pages (not Performance — a read page, MEA-10), /assistant/<id>,
 *           onboarding/channel/new, an article idea's edit page.
 * Everything else is requireMembership and open to any member.
 */

const ADMIN_PREFIXES = ["/admin", "/setup/people"];
const EDITOR_PREFIXES = [
  "/assistant", "/onboarding/channel/new",
  "/social/approvals", "/social/calendar", "/social/compose", "/social/engage", "/ideas/article",
];
const EDITOR_PATTERNS = [/^\/social\/[^/]+\/edit$/];

/** The pages a role is needed for, as written above — Settings → Roles lists them (E-SEC-17). */
export const ROLE_PAGES = { ADMIN: ADMIN_PREFIXES, EDITOR: [...EDITOR_PREFIXES, "/social/<post>/edit"] } as const;

/** `prefix` itself or anything below it — "/admin" covers "/admin/keys", not "/administer". */
function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** The lowest role that can open `href` (paths only; query and hash ignored). */
export function roleNeededFor(href: string): Role {
  const path = href.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (ADMIN_PREFIXES.some((p) => under(path, p))) return "ADMIN";
  if (EDITOR_PREFIXES.some((p) => under(path, p)) || EDITOR_PATTERNS.some((r) => r.test(path))) return "EDITOR";
  return "VIEWER";
}

const RANK: Record<Role, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2 };

/** True when `role` can open `href`. */
export function canFollow(href: string, role: Role): boolean {
  return RANK[role] >= RANK[roleNeededFor(href)];
}

/** Who to ask, for the note shown in place of a link the role can't follow. */
export function whoCanFix(href: string): string {
  return roleNeededFor(href) === "ADMIN" ? "An admin of this workspace can fix this." : "An editor or admin can do this.";
}
