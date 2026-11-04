/**
 * Engage as a team inbox (E-SOC-17): who owns a thread, the answers a team
 * keeps to hand, how long a DM can still be answered, and public replies an
 * editor writes for an admin to release.
 *
 * ⚠ None of this touches the network. An assignment, a set-aside comment or a
 *   reply waiting for approval is this app's memory; the thread on Facebook is
 *   unchanged until a person presses Send (or an admin approves).
 * ⚠ A reply waiting for approval is an InboxReplyDraft of kind "comment" —
 *   never dispatched by a sweep. It goes out only when an admin approves it,
 *   through the same send as any comment, with the account re-resolved then.
 */

import { db } from "@/lib/db";
import type { SavedReply } from "@/lib/inbox-team-shared";

export * from "@/lib/inbox-team-shared";

/**
 * The workspace's saved snippets as replies — the same library the composer
 * uses (Social → Compose), with any category that says "repl…" first so the
 * answers a team writes for Engage don't have to be dug for.
 */
export async function savedRepliesFor(workspaceId: string): Promise<SavedReply[]> {
  const rows = await db.socialSnippet.findMany({ where: { workspaceId }, select: { id: true, name: true, body: true, category: true }, orderBy: { name: "asc" }, take: 80 });
  const isReply = (c: string | null) => !!c && /repl/i.test(c);
  return [...rows.filter((r) => isReply(r.category)), ...rows.filter((r) => !isReply(r.category))];
}

/** Who can be given a thread: active editors and admins (a viewer can't answer). */
export async function assignableMembers(workspaceId: string): Promise<Array<{ userId: string; name: string }>> {
  const rows = await db.membership.findMany({
    where: { workspaceId, status: "active", role: { in: ["ADMIN", "EDITOR"] } },
    select: { userId: true, user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ userId: r.userId, name: r.user.name ?? r.user.email ?? r.userId }));
}
