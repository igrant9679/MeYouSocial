"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole, isPlatformOperator } from "@/lib/acl";
import { writeAudit } from "@/lib/governance";
import { readUnclaimed, profileAssignProblem } from "@/lib/unclaimed-accounts";

const back = (q: string) => redirect(`/admin/unclaimed?${q}`);
const err = (m: string) => back("flashErr=" + encodeURIComponent(m));

async function requireOperator() {
  const ctx = await requireRole("ADMIN");
  if (!isPlatformOperator(ctx.user.email)) redirect("/forbidden?why=operator");
  return ctx;
}

/**
 * Give a shared mailbox nobody owns to one workspace (E-SEC-15). Re-read from
 * Unipile first — a forged or stale id assigns nothing — and audited, so the
 * workspace's admins are told a mailbox arrived (E-SEC-12).
 */
export async function assignMailboxAction(formData: FormData) {
  const { user } = await requireOperator();
  const accountId = String(formData.get("accountId") ?? "");
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true, name: true } });
  if (!ws) err("Choose a workspace.");
  const box = (await readUnclaimed()).mailboxes.find((m) => m.accountId === accountId);
  if (!box) err("That mailbox isn't unclaimed any more — the list was refreshed.");
  const hasDefault = await db.unipileAccount.findFirst({ where: { workspaceId, kind: "email", isDefault: true } });
  await db.unipileAccount.create({ data: { workspaceId, accountId, kind: "email", provider: box!.provider, name: box!.address, status: "connected", isDefault: !hasDefault } });
  await writeAudit({ workspaceId, actorId: user.id, action: "integration.adopted", entityType: "unipile_account", entityId: accountId, meta: { kind: "mailbox", address: box!.address, via: "operator_queue" } });
  revalidatePath("/admin/unclaimed");
  back("flash=" + encodeURIComponent(`${box!.address ?? "The mailbox"} now belongs to ${ws!.name}${hasDefault ? "" : " and is its default sender"}.`));
}

/** Give a platform-key Zernio profile nobody owns to one workspace (E-SEC-15). */
export async function assignProfileAction(formData: FormData) {
  const { user } = await requireOperator();
  const profileId = String(formData.get("profileId") ?? "");
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const view = await readUnclaimed();
  if (view.zernioNote) err(view.zernioNote);
  const profile = view.profiles.find((p) => p.id === profileId);
  const problem = await profileAssignProblem(profile, workspaceId);
  if (problem) err(problem);
  // Conditional: a workspace that gained a profile meanwhile keeps its own.
  const { count } = await db.workspace.updateMany({ where: { id: workspaceId, zernioProfileId: null }, data: { zernioProfileId: profileId } });
  if (!count) err("That workspace got a Zernio profile in the meantime.");
  await writeAudit({ workspaceId, actorId: user.id, action: "integration.adopted", entityType: "zernio_profile", entityId: profileId, meta: { kind: "zernio_profile", name: profile!.name, via: "operator_queue" } });
  revalidatePath("/admin/unclaimed");
  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } });
  back("flash=" + encodeURIComponent(`The Zernio profile now belongs to ${ws?.name ?? "that workspace"} — reconcile its accounts on Settings → Connections.`));
}
