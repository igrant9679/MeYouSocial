"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { writeAudit } from "@/lib/governance";
import { DELETABLE, isDeletableKind, type DeletableKind } from "@/lib/deletable";

/**
 * The one delete action. Every deletable kind is declared in
 * src/lib/deletable.ts; this enforces role, tenancy, confirmation and auditing
 * once, for all of them.
 *
 * Deletions are AUDITED (`entity.deleted`) with the record's name captured
 * BEFORE it disappears — an audit row naming only an id nobody can look up any
 * more answers none of the questions you have after an accidental delete.
 */
export async function deleteEntityAction(formData: FormData) {
  const kindRaw = String(formData.get("kind") ?? "");
  const id = String(formData.get("id") ?? "").trim();
  const confirm = String(formData.get("confirm") ?? "").trim();
  const returnTo = String(formData.get("returnTo") ?? "").trim();

  if (!isDeletableKind(kindRaw) || !id) return;
  const kind: DeletableKind = kindRaw;
  const spec = DELETABLE[kind];

  // A workspace is deleted BY ITS OWN admins, so the role check is scoped to
  // the workspace being deleted rather than the one the user happens to be
  // viewing. For everything else the active workspace IS the tenant boundary.
  const { workspace, user } = await requireRole(spec.role, kind === "workspace" ? id : undefined);

  const back = (msg: string, ok = false) => {
    const target = returnTo || spec.redirectTo?.({ id, name: "" }) || "/";
    const sep = target.includes("?") ? "&" : "?";
    redirect(`${target}${sep}${ok ? "ok" : "err"}=${encodeURIComponent(msg)}`);
  };

  const target = await spec.find(id, workspace.id);
  // Same response whether it never existed or belongs to another company —
  // a distinct "not yours" would confirm the id is real to someone probing.
  if (!target) back(`That ${spec.label} no longer exists.`);

  if (spec.typeToConfirm) {
    const expected = target!.name.trim().toLowerCase();
    if (confirm.toLowerCase() !== expected) {
      back(`Type the ${spec.label}'s name exactly to confirm deletion.`);
    }
  }

  try {
    await spec.remove(id, workspace.id);
  } catch (e) {
    // Guards inside `remove` (e.g. refusing to strand a workspace with no
    // admin) speak to the user through their own message.
    back(e instanceof Error ? e.message : `Could not delete that ${spec.label}.`);
  }

  await writeAudit({
    workspaceId: kind === "workspace" ? id : workspace.id,
    actorId: user.id,
    action: "entity.deleted",
    entityType: kind,
    entityId: id,
    meta: { name: target!.name },
  });

  for (const path of spec.revalidate) revalidatePath(path);
  if (returnTo) revalidatePath(returnTo);

  const dest = returnTo || spec.redirectTo?.(target!) || "/";
  const sep = dest.includes("?") ? "&" : "?";
  redirect(`${dest}${sep}ok=${encodeURIComponent(`Deleted ${spec.label} “${target!.name}”.`)}`);
}
