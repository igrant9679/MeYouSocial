import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { isPlatformOperator } from "@/lib/acl";

// Password-reset tokens ride Auth.js's VerificationToken table with the
// identifier "reset:<email>" (actions/auth-flows.ts redeems them). Kept out of
// that "use server" file on purpose: an exported helper there would be a
// server action anyone could call.

export const PURPOSE_RESET = "reset:";
export const RESET_TTL_MS = 1000 * 60 * 60; // 1 hour

export async function createResetToken(email: string): Promise<string> {
  const token = nanoid(40);
  await db.verificationToken.create({
    data: { identifier: PURPOSE_RESET + email.toLowerCase(), token, expires: new Date(Date.now() + RESET_TTL_MS) },
  });
  return token;
}

/**
 * May this admin hand a reset link for `targetUserId` to someone? A reset link
 * IS the account, so the admin must already govern every workspace the person
 * can reach — otherwise one company's admin could take over a member who also
 * belongs to another company (or the platform operator) and walk into theirs.
 */
export async function canIssueResetLink(actorUserId: string, workspaceId: string, targetUserId: string): Promise<{ ok: true; email: string } | { ok: false; reason: string }> {
  if (actorUserId === targetUserId) return { ok: false, reason: "Use “Forgot password” on the sign-in page for your own account." };
  const target = await db.user.findUnique({ where: { id: targetUserId }, select: { email: true, memberships: { where: { status: "active" }, select: { workspaceId: true } } } });
  if (!target) return { ok: false, reason: "No such member." };
  const here = await db.membership.findFirst({ where: { workspaceId, userId: targetUserId }, select: { id: true } });
  if (!here) return { ok: false, reason: "That person isn't a member of this workspace." };
  if (isPlatformOperator(target.email)) return { ok: false, reason: "The platform operator's password can't be reset from a workspace." };
  const governed = new Set(
    (await db.membership.findMany({ where: { userId: actorUserId, status: "active", role: "ADMIN" }, select: { workspaceId: true } })).map((m) => m.workspaceId),
  );
  if (target.memberships.some((m) => !governed.has(m.workspaceId))) {
    return { ok: false, reason: "This person also belongs to a workspace you don't administer — an admin of every workspace they're in has to issue it, or they can use “Forgot password”." };
  }
  return { ok: true, email: target.email };
}
