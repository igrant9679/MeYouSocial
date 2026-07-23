"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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
