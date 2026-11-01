"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { isRejectReason } from "@/lib/reject-reasons";

// The board's "just rejected" bar (E-IDE-18): say why, or take it back. Both
// act only on an idea that is still rejected.

const formatOf = (v: FormDataEntryValue | null) => (v === "social" ? "social" : "article");

export async function setRejectReasonAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (!isRejectReason(reason)) return;
  const where = { id, workspaceId: workspace.id, status: "rejected" };
  if (formatOf(formData.get("format")) === "social") await db.socialIdea.updateMany({ where, data: { rejectReason: reason } });
  else await db.blogIdea.updateMany({ where, data: { rejectReason: reason } });
  revalidatePath("/ideas", "layout");
}

export async function undoRejectAction(formData: FormData) {
  const { workspace, user } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  const to = formData.get("from") === "approved" ? "approved" : "discovered";
  const where = { id, workspaceId: workspace.id, status: "rejected" };
  const social = formatOf(formData.get("format")) === "social";
  const { count } = social
    ? await db.socialIdea.updateMany({ where, data: { status: to, rejectReason: null, ...(to === "approved" ? { approvedAt: new Date() } : {}) } })
    : await db.blogIdea.updateMany({ where, data: { status: to, rejectReason: null } });
  if (count) {
    await writeAudit({
      workspaceId: workspace.id, actorId: user.id,
      action: social ? "social.idea_restored" : "ideas.restored",
      entityType: social ? "social_idea" : "blog_idea", entityId: id, meta: { undo: true, to },
    });
  }
  revalidatePath("/ideas", "layout");
}
