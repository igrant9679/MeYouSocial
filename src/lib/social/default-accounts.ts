import { db } from "@/lib/db";

/** A person's own starting selection in the composer (tracker #32) — a WorkspaceSetting per person. */
export const defaultAccountsKey = (userId: string) => `social:default_accounts:${userId}`;

/** Their saved accounts that are still connected here; [] when none are saved. Read directly, never cached. */
export async function myDefaultAccounts(workspaceId: string, userId: string, connectedIds: string[]): Promise<string[]> {
  const row = await db.workspaceSetting.findUnique({ where: { workspaceId_key: { workspaceId, key: defaultAccountsKey(userId) } } });
  if (!row) return [];
  try {
    const ids = JSON.parse(row.value) as unknown;
    const live = new Set(connectedIds);
    return Array.isArray(ids) ? ids.map(String).filter((id) => live.has(id)) : [];
  } catch {
    return [];
  }
}
