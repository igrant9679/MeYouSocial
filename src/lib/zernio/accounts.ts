import { db } from "@/lib/db";
import { createZernioProfile, listZernioAccounts, type ZernioAccountInfo } from "@/lib/zernio";

/**
 * DB-side resolvers for a workspace's Zernio profile and connected accounts.
 * Kept apart from the HTTP client so that stays a thin wrapper (same split as
 * the old unipile/accounts.ts).
 */

/**
 * This workspace's Zernio profile id, creating it on first use.
 *
 * The profile NAME is the workspace id, not its display name: Zernio requires
 * names unique per team, and two customers called "Acme" would otherwise
 * collide. The human-readable name goes in `description`.
 */
export async function ensureZernioProfile(workspaceId: string): Promise<string> {
  const ws = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true, zernioProfileId: true },
  });
  if (!ws) throw new Error("Workspace not found");
  if (ws.zernioProfileId) return ws.zernioProfileId;

  const profile = await createZernioProfile(`ws_${ws.id}`, ws.name);
  if (!profile.id) throw new Error("Zernio created a profile but returned no id.");
  await db.workspace.update({ where: { id: ws.id }, data: { zernioProfileId: profile.id } });
  return profile.id;
}

/** The account a workspace posts to for a given platform. */
export async function resolveSocialAccount(
  workspaceId: string,
  platform: string,
): Promise<{ accountId: string; name: string | null } | null> {
  const row = await db.zernioAccount.findFirst({
    where: { workspaceId, platform: platform.toLowerCase(), status: "connected" },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  return row ? { accountId: row.accountId, name: row.displayName ?? row.username } : null;
}

/** Upsert one account into a workspace. Used by the webhook and by reconcile. */
export async function saveZernioAccount(workspaceId: string, a: ZernioAccountInfo) {
  const data = {
    platform: a.platform,
    username: a.username,
    displayName: a.displayName,
    profileUrl: a.profileUrl,
    status: a.isActive ? "connected" : "disconnected",
  };
  await db.zernioAccount.upsert({
    where: { workspaceId_accountId: { workspaceId, accountId: a.id } },
    update: data,
    create: { workspaceId, accountId: a.id, ...data },
  });
}

/**
 * Re-read this workspace's accounts from Zernio and mirror them locally.
 *
 * The reconcile path Unipile never had. A missed `account.connected` webhook is
 * no longer unrecoverable — accounts are listable by `profileId` at any time,
 * so the local mirror can always be rebuilt from the source of truth.
 *
 * Accounts that have vanished from Zernio are marked `disconnected` rather than
 * deleted: existing SocialPostTarget rows reference them, and history must stay
 * readable.
 */
export async function syncZernioAccounts(workspaceId: string): Promise<{ found: number; removed: number }> {
  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { zernioProfileId: true } });
  if (!ws?.zernioProfileId) return { found: 0, removed: 0 };

  const remote = await listZernioAccounts({ profileId: ws.zernioProfileId });
  for (const a of remote) await saveZernioAccount(workspaceId, a);

  const keep = remote.map((a) => a.id);
  const { count } = await db.zernioAccount.updateMany({
    where: { workspaceId, accountId: { notIn: keep.length ? keep : ["__none__"] }, status: "connected" },
    data: { status: "disconnected" },
  });
  return { found: remote.length, removed: count };
}
