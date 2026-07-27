import { db } from "@/lib/db";
import { createZernioProfile, listZernioProfiles, listZernioAccounts, type ZernioAccountInfo } from "@/lib/zernio";

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

  const claim = async (id: string) => {
    await db.workspace.update({ where: { id: ws.id }, data: { zernioProfileId: id } });
    return id;
  };

  // ⚠ ADOPT BEFORE CREATING. This used to create unconditionally, which is
  // wrong in two situations that both really happen:
  //   • the local row was lost (restore, re-seed) but the profile still exists;
  //   • the team already connected accounts in Zernio's own dashboard before
  //     ever using this app — the accounts sit under their existing profile,
  //     and minting `ws_<id>` strands them where the reconcile can't see them,
  //     then asks the user to re-authorise accounts they already authorised.
  // Both leave the app permanently unable to see real, connected accounts.
  const existing = await listZernioProfiles().catch(() => []);
  const byName = existing.find((p) => p.name === `ws_${ws.id}`);
  if (byName?.id) return claim(byName.id);

  // A single unclaimed profile on the team is unambiguous — adopt it. More than
  // one is a real choice and guessing could bind a tenant to another tenant's
  // accounts, so fall through to creating our own.
  const claimed = new Set(
    (await db.workspace.findMany({ where: { NOT: { zernioProfileId: null } }, select: { zernioProfileId: true } }))
      .map((w) => w.zernioProfileId as string),
  );
  const unclaimed = existing.filter((p) => p.id && !claimed.has(p.id));
  if (unclaimed.length === 1) return claim(unclaimed[0].id!);

  const profile = await createZernioProfile(`ws_${ws.id}`, ws.name);
  if (!profile.id) throw new Error("Zernio created a profile but returned no id.");
  return claim(profile.id);
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
export async function syncZernioAccounts(
  workspaceId: string,
): Promise<{ found: number; removed: number; profileId: string; adopted: boolean }> {
  // Resolve (and if necessary adopt) the profile rather than giving up when
  // none is stored. Refusing to bind here made Refresh a no-op for exactly the
  // workspace that most needs it: one whose accounts were connected in Zernio's
  // dashboard and never mirrored locally.
  const before = await db.workspace.findUnique({ where: { id: workspaceId }, select: { zernioProfileId: true } });
  const profileId = await ensureZernioProfile(workspaceId);
  // Binding is the consequential half of this action — it decides which
  // workspace owns a team's accounts, and on a multi-workspace install the
  // wrong active workspace silently claims them. Report it so a mis-bind is
  // visible at the moment it happens rather than days later.
  const adopted = before?.zernioProfileId !== profileId;

  const remote = await listZernioAccounts({ profileId });
  for (const a of remote) await saveZernioAccount(workspaceId, a);

  const keep = remote.map((a) => a.id);
  const { count } = await db.zernioAccount.updateMany({
    where: { workspaceId, accountId: { notIn: keep.length ? keep : ["__none__"] }, status: "connected" },
    data: { status: "disconnected" },
  });
  return { found: remote.length, removed: count, profileId, adopted };
}
