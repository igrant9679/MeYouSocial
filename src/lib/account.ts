import { db } from "@/lib/db";

/**
 * Account helpers for Settings → Profile (E-SHL-09). Kept out of the actions
 * file on purpose: every async export of a "use server" module is callable from
 * a browser, and these take a user id.
 */

export const EMAIL_CHANGE_PREFIX = "email:";

/** The pending sign-in email change for a user, if any: identifier "email:<userId>:<new address>". */
export async function pendingEmailChange(userId: string): Promise<{ email: string; expires: Date } | null> {
  const row = await db.verificationToken.findFirst({ where: { identifier: { startsWith: `${EMAIL_CHANGE_PREFIX}${userId}:` }, expires: { gt: new Date() } } });
  return row ? { email: row.identifier.slice(`${EMAIL_CHANGE_PREFIX}${userId}:`.length), expires: row.expires } : null;
}

/** Workspaces where this person is the only active admin — they must hand it over first. */
export async function soleAdminOf(userId: string): Promise<string[]> {
  const mine = await db.membership.findMany({ where: { userId, status: "active", role: "ADMIN", workspace: { deletedAt: null } }, select: { workspaceId: true, workspace: { select: { name: true } } } });
  const out: string[] = [];
  for (const m of mine) {
    const others = await db.membership.count({ where: { workspaceId: m.workspaceId, status: "active", role: "ADMIN", userId: { not: userId } } });
    if (!others) out.push(m.workspace.name);
  }
  return out;
}

