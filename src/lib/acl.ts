import { auth } from "@/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
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

/**
 * The PLATFORM operator — the one super-admin who runs this install, as opposed
 * to a workspace ADMIN who only runs their own company.
 *
 * Identified by `BOOTSTRAP_ADMIN_EMAIL`. This gate already guarded storage, the
 * shared API keys and the Zernio/Unipile credentials, but as an inline
 * comparison copy-pasted into four files. Centralised here so there's one
 * definition to audit — and so the comparison is case-insensitive on BOTH
 * sides: `env.BOOTSTRAP_ADMIN_EMAIL` is lowercased at load, while `user.email`
 * is whatever was typed at signup, so the old `!==` checks would silently deny
 * the operator if their stored address had any capitals.
 */
export function isPlatformOperator(email: string | null | undefined): boolean {
  const configured = env.BOOTSTRAP_ADMIN_EMAIL;
  if (!configured || !email) return false;
  return email.trim().toLowerCase() === configured;
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
