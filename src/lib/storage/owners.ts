import { db } from "@/lib/db";
import { isPlatformOperator } from "@/lib/acl";

/**
 * Stored files have an owner (E-SEC-11). Keys were already unguessable, but any
 * signed-in member of ANY workspace could open a file whose link reached them —
 * a link copied out of another company, or kept after leaving it. The file
 * routes now ask `mayOpen`.
 */
export async function recordOwner(key: string, workspaceId: string): Promise<void> {
  try {
    await db.storedObject.upsert({ where: { key }, update: {}, create: { key, workspaceId } });
  } catch (e) {
    // The file is stored either way; without its row it falls back to the old rule.
    console.warn(`[storage] couldn't record the owner of ${key}:`, e instanceof Error ? e.message : e);
  }
}

/**
 * May this person open the file? Yes when it has no owner row (stored before
 * owners were recorded — the old rule), when they're an active member of the
 * owning workspace, or when they're the platform operator.
 */
export async function mayOpen(key: string, user: { email?: string | null; memberships: { workspaceId: string; status: string }[] }): Promise<boolean> {
  const row = await db.storedObject.findUnique({ where: { key }, select: { workspaceId: true } });
  if (!row) return true;
  if (user.memberships.some((m) => m.status === "active" && m.workspaceId === row.workspaceId)) return true;
  return isPlatformOperator(user.email);
}
