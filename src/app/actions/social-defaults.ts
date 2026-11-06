"use server";

import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { defaultAccountsKey } from "@/lib/social/default-accounts";

/**
 * "Make this my default" in the composer (tracker #32: choosing the same
 * networks for every post). Per PERSON, per workspace — one teammate's habit
 * isn't imposed on another. Only this workspace's own accounts are kept; an
 * empty selection clears it. Called from the composer directly, so the post
 * being written isn't lost to a page reload.
 */
export async function saveMyDefaultAccountsAction(ids: string[]): Promise<{ ok: boolean; message: string }> {
  const { workspace, user } = await requireRole("EDITOR");
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(String))].slice(0, 50);
  const own = wanted.length
    ? await db.zernioAccount.findMany({ where: { workspaceId: workspace.id, id: { in: wanted } }, select: { id: true } })
    : [];
  const value = JSON.stringify(own.map((a) => a.id));
  const key = defaultAccountsKey(user.id);
  if (own.length) {
    await db.workspaceSetting.upsert({
      where: { workspaceId_key: { workspaceId: workspace.id, key } },
      update: { value },
      create: { workspaceId: workspace.id, key, value },
    });
  } else {
    await db.workspaceSetting.deleteMany({ where: { workspaceId: workspace.id, key } });
  }
  return own.length
    ? { ok: true, message: `Saved — new posts start with ${own.length === 1 ? "this account" : `these ${own.length} accounts`} ticked, for you.` }
    : { ok: true, message: "Default cleared — new posts start with nothing ticked." };
}
