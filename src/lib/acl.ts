import { auth } from "@/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { Role } from "@prisma/client";

/** Cookie holding the user's chosen workspace (multi-company users). */
export const ACTIVE_WS_COOKIE = "meyousocial_ws";

// Per / / N: enforce role + workspace scoping
// server-side on every endpoint. Helpers below are the only way the app
// resolves "who is the current user, what workspace, what role."

export async function getCurrentUser() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: { memberships: { include: { workspace: true } } },
  });
  return user;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  return user;
}

export async function requireMembership(workspaceId?: string) {
  const user = await requireUser();
  const memberships = user.memberships.filter((m) => m.status === "active");
  if (memberships.length === 0) redirect("/onboarding/workspace");
  let target;
  if (workspaceId) {
    target = memberships.find((m) => m.workspaceId === workspaceId);
  } else {
    // Multi-company users: honor the workspace they switched to (cookie set by
    // setActiveWorkspaceAction); an invalid/stale cookie falls back silently.
    const chosen = (await cookies()).get(ACTIVE_WS_COOKIE)?.value;
    target = (chosen && memberships.find((m) => m.workspaceId === chosen)) || memberships[0];
  }
  if (!target) redirect("/forbidden");
  return { user, membership: target, workspace: target.workspace };
}

export function canEdit(role: Role): boolean {
  return role === "ADMIN" || role === "EDITOR";
}

export function canAdmin(role: Role): boolean {
  return role === "ADMIN";
}

export async function requireRole(needed: Role, workspaceId?: string) {
  const ctx = await requireMembership(workspaceId);
  const rank: Record<Role, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2 };
  if (rank[ctx.membership.role] < rank[needed]) redirect("/forbidden");
  return ctx;
}
