"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser, ACTIVE_WS_COOKIE } from "@/lib/acl";

/**
 * Multi-company users: switch the active workspace. Validated against the
 * user's own active memberships — you can never switch into a workspace
 * you're not a member of.
 */
export async function setActiveWorkspaceAction(formData: FormData) {
  const user = await requireUser();
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const member = user.memberships.some((m) => m.workspaceId === workspaceId && m.status === "active");
  if (!member) redirect("/forbidden");
  (await cookies()).set(ACTIVE_WS_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/dashboard");
}

/** Set the active-workspace cookie without the membership re-check — only for
 *  a workspace we just created for this user in the same request. */
async function setActive(workspaceId: string) {
  (await cookies()).set(ACTIVE_WS_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

/**
 * Create a workspace and switch into it.
 *
 * Until now there was NO way to make one from inside the app: workspaces only
 * ever appeared at signup (one per new user) or by being invited into someone
 * else's. Worse, `requireMembership` redirects a user with zero memberships to
 * `/onboarding/workspace`, and that route didn't exist — so anyone in that
 * state (a revoked last membership, say) hit a dead end they couldn't escape.
 * This action backs that route as well as the button in Settings.
 *
 * The creator becomes ADMIN, matching what signup does.
 */
export async function createWorkspaceAction(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const back = String(formData.get("returnTo") ?? "/settings");

  if (name.length < 2) {
    redirect(`${back}?error=${encodeURIComponent("Give the workspace a name of at least 2 characters.")}`);
  }
  if (name.length > 60) {
    redirect(`${back}?error=${encodeURIComponent("That name is too long — 60 characters maximum.")}`);
  }
  // Names aren't globally unique (two customers may both be "Acme"), but a
  // duplicate within the user's OWN list is almost always a double-submit.
  const clash = user.memberships.some(
    (m) => m.status === "active" && m.workspace.name.toLowerCase() === name.toLowerCase(),
  );
  if (clash) {
    redirect(`${back}?error=${encodeURIComponent(`You're already in a workspace called “${name}”.`)}`);
  }

  const workspace = await db.workspace.create({ data: { name } });
  await db.membership.create({ data: { userId: user.id, workspaceId: workspace.id, role: "ADMIN" } });
  await setActive(workspace.id);
  redirect("/dashboard");
}
