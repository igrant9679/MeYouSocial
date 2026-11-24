"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, isPlatformOperator } from "@/lib/acl";
import { writeAudit } from "@/lib/governance";

/**
 * Settings → File owners → Give them owners (2026-11-24): the platform operator's button, never an agent's. Writes an
 * owner row for every file exactly one workspace uses and no row names (lib/storage/owner-backfill.ts), after
 * re-planning, and audits it in each workspace. From then on those files open only for their workspace's members.
 */
export async function applyFileOwnersAction(formData: FormData) {
  const { user } = await requireRole("ADMIN");
  if (!isPlatformOperator(user.email)) redirect("/forbidden?why=operator");
  if (String(formData.get("confirm") ?? "") !== "on") {
    redirect(`/admin/file-owners?flashErr=${encodeURIComponent("Tick the box first: this changes who can open those files.")}`);
  }
  const { applyOwnerBackfill } = await import("@/lib/storage/owner-backfill");
  const res = await applyOwnerBackfill();
  for (const [workspaceId, count] of Object.entries(res.byWorkspace)) {
    await writeAudit({ workspaceId, actorId: user.id, action: "storage.owners_backfilled", entityType: "workspace", entityId: workspaceId, meta: { files: count } });
  }
  revalidatePath("/admin/file-owners");
  redirect(`/admin/file-owners?flash=${encodeURIComponent(res.written === 1 ? "1 file now has an owner." : `${res.written} files now have an owner.`)}`);
}
