import { db } from "@/lib/db";

/**
 * The unclaimed-accounts queue (E-SEC-15): mailboxes on the platform's Unipile
 * team and profiles on the platform's Zernio key that no workspace owns. They
 * used to be adopted by whichever admin refreshed first; now nothing takes them
 * by itself — the operator assigns each one (actions/unclaimed-accounts.ts).
 */
export type UnclaimedMailbox = { accountId: string; provider: string; address: string | null };

/**
 * A profile on the platform key. `madeFor` is the workspace this app named it
 * after (`ws_<id>`); `deletedWorkspace` means that workspace is gone — its
 * company's pages may still be connected, so it is never assignable.
 */
export type PlatformProfile = { id: string; name: string; claimedBy: string | null; madeFor: string | null; deletedWorkspace: boolean };

export type UnclaimedView = {
  mailboxes: UnclaimedMailbox[];
  mailNote: string | null;
  profiles: PlatformProfile[];
  zernioNote: string | null;
};

export async function readUnclaimed(): Promise<UnclaimedView> {
  const workspaces = await db.workspace.findMany({ select: { id: true, name: true, zernioProfileId: true } });
  const nameOf = new Map(workspaces.map((w) => [w.id, w.name]));
  const view: UnclaimedView = { mailboxes: [], mailNote: null, profiles: [], zernioNote: null };

  const { unipileConfigured, listUnipileAccounts } = await import("@/lib/unipile");
  if (!(await unipileConfigured())) view.mailNote = "Unipile isn't set up for the platform, so there are no shared mailboxes.";
  else {
    const { MAIL_TYPES } = await import("@/lib/unipile/accounts");
    const remote = (await listUnipileAccounts()).filter((a) => a.id && MAIL_TYPES.has(a.type.toUpperCase()));
    const claimed = new Set((await db.unipileAccount.findMany({ where: { accountId: { in: remote.map((a) => a.id) } }, select: { accountId: true } })).map((r) => r.accountId));
    view.mailboxes = remote.filter((a) => !claimed.has(a.id)).map((a) => ({ accountId: a.id, provider: a.type, address: a.name }));
    if (!remote.length) view.mailNote = "Unipile answered with no mailboxes (or couldn't be read).";
  }

  const { getZernioConfig, listZernioProfiles } = await import("@/lib/zernio");
  if (!(await getZernioConfig(null))) view.zernioNote = "There's no platform Zernio key — each workspace's profiles live under its own key.";
  else {
    try {
      const owner = new Map(workspaces.filter((w) => w.zernioProfileId).map((w) => [w.zernioProfileId as string, w.id]));
      view.profiles = (await listZernioProfiles(null)).filter((p) => p.id).map((p) => {
        const madeFor = p.name.startsWith("ws_") ? p.name.slice(3) : null;
        return { id: p.id, name: p.name, claimedBy: owner.get(p.id) ?? null, madeFor, deletedWorkspace: Boolean(madeFor && !nameOf.has(madeFor)) };
      });
    } catch (e) {
      view.zernioNote = `Zernio couldn't be read: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return view;
}

/**
 * Why `profile` can't go to `workspaceId`, or null when it can. Re-read at assign
 * time — the page may be stale. A workspace with its own Zernio key posts under
 * that key, where a platform profile isn't its user's (sends 403).
 */
export async function profileAssignProblem(profile: PlatformProfile | undefined, workspaceId: string): Promise<string | null> {
  if (!profile) return "That profile isn't on the platform's Zernio key any more.";
  if (profile.claimedBy) return "That profile already belongs to a workspace.";
  if (profile.deletedWorkspace) return "That profile was made for a workspace that's been deleted — its pages may still be connected. Remove it in Zernio instead.";
  if (profile.madeFor && profile.madeFor !== workspaceId) return "That profile was made for another workspace — it can only go back to that one.";
  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { zernioProfileId: true } });
  if (!ws) return "That workspace doesn't exist.";
  if (ws.zernioProfileId) return "That workspace already has a Zernio profile.";
  const ownKey = await db.workspaceSetting.findUnique({ where: { workspaceId_key: { workspaceId, key: "zernio:api_key" } } });
  if (ownKey?.value?.trim()) return "That workspace posts with its own Zernio key; a profile on the platform key isn't its account.";
  return null;
}
