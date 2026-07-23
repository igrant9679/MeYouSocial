"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { isGloballyPaused } from "@/lib/governance";
import { runContentAuditCore } from "@/lib/content-audit";

/**
 * FR-15 actions. Nothing here changes the live site — the strongest action is
 * turning a finding into an idea for a human to pick up.
 */

export async function runContentAuditAction() {
  const { workspace } = await requireRole("EDITOR");
  if (await isGloballyPaused(workspace.id)) return;
  await runContentAuditCore(workspace.id);
  revalidatePath("/blog/audit");
}

export async function setAuditItemStatusAction(formData: FormData) {
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  if (!["open", "actioned", "dismissed"].includes(status)) return;
  const { workspace } = await requireRole("EDITOR");
  await db.contentAuditItem.updateMany({ where: { id, workspaceId: workspace.id }, data: { status } });
  revalidatePath("/blog/audit");
}

/** Turn an audit finding into a tracked idea so the fix enters the pipeline. */
export async function auditItemToIdeaAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  const item = await db.contentAuditItem.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!item || item.recommendation === "keep") return;

  const verb = item.recommendation === "merge" ? "Merge" : item.recommendation === "retire" ? "Retire" : "Rewrite";
  const title = `${verb}: ${item.title}`.slice(0, 200);
  const exists = await db.blogIdea.count({ where: { workspaceId: workspace.id, title } });
  if (!exists) {
    await db.blogIdea.create({
      data: {
        workspaceId: workspace.id,
        title,
        angle: item.reason?.slice(0, 500) ?? null,
        source: "refresh",
        targetPage: item.mergeTargetUrl,
      },
    });
  }
  await db.contentAuditItem.update({ where: { id }, data: { status: "actioned" } });
  revalidatePath("/blog/audit");
  revalidatePath("/blog/ideas");
}

export async function clearContentAuditAction() {
  const { workspace } = await requireRole("ADMIN");
  await db.contentAuditItem.deleteMany({ where: { workspaceId: workspace.id } });
  revalidatePath("/blog/audit");
}
