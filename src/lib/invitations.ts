import type { Invitation, Role } from "@prisma/client";
import { db } from "@/lib/db";

// Claiming an invitation — the ONE place membership is granted from one.
//
// Three doors lead here: signing up with an invitation link, pressing Accept
// on /invitations/<token>, and verifying an email address (which claims
// invitations addressed to it). Each used to upsert the membership itself, and
// each had the same two holes:
//
// - It overwrote the role. An admin who opened a Viewer link to see what the
//   invitee sees demoted themselves — and a sole admin locked the workspace.
//   Now an existing ACTIVE membership keeps the higher of the two roles.
// - Sign-up claimed invitations by typed email with no proof the person owned
//   the address, so whoever registered an invited address first joined with
//   its role (possibly ADMIN). Now an invitation is claimed only with its token
//   (which travelled to the invitee) or after the address is verified.

const RANK: Record<Role, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2 };

export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Join `invite.workspaceId`. Atomic on the invitation (a token works once, even
 * under a double submit) and never lowers an existing active role. A revoked
 * membership is reactivated — revoking a member deletes their pending
 * invitations, so a live invitation here is an admin's fresh decision.
 * Returns false when the invitation was already used or has expired.
 */
export async function claimInvitation(
  userId: string,
  invite: Pick<Invitation, "id" | "workspaceId" | "role">,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const claimed = await tx.invitation.updateMany({
      where: { id: invite.id, acceptedAt: null, expiresAt: { gt: new Date() } },
      data: { acceptedAt: new Date() },
    });
    if (claimed.count === 0) return false;
    const existing = await tx.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: invite.workspaceId } },
      select: { role: true, status: true },
    });
    const role =
      existing && existing.status === "active" && RANK[existing.role] > RANK[invite.role]
        ? existing.role
        : invite.role;
    await tx.membership.upsert({
      where: { userId_workspaceId: { userId, workspaceId: invite.workspaceId } },
      update: { role, status: "active" },
      create: { userId, workspaceId: invite.workspaceId, role },
    });
    return true;
  });
}

/** Live invitations addressed to `email` (any case). */
export function pendingInvitationsFor(email: string) {
  return db.invitation.findMany({
    where: {
      email: { equals: email.trim(), mode: "insensitive" },
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: { workspace: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Claim every live invitation for a VERIFIED address. Callers must have proof
 * of the mailbox (a clicked verification link) — never call this with an
 * email someone merely typed. Returns the workspace ids joined.
 */
export async function claimInvitationsForVerifiedEmail(userId: string, email: string): Promise<string[]> {
  const joined: string[] = [];
  for (const invite of await pendingInvitationsFor(email)) {
    if (await claimInvitation(userId, invite)) joined.push(invite.workspaceId);
  }
  return joined;
}

/** Revoking or removing a member also withdraws invitations still waiting for them. */
export async function withdrawInvitationsFor(workspaceId: string, email: string | null | undefined) {
  if (!email) return;
  await db.invitation.deleteMany({
    where: { workspaceId, acceptedAt: null, email: { equals: email.trim(), mode: "insensitive" } },
  });
}
