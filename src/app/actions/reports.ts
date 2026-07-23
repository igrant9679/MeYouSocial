"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { getReport, isBlockKey, stockDefault } from "@/lib/report-defs";

/**
 * Reports hub actions. Customization writes a ReportConfig row; resetting a
 * stock report deletes the row so it tracks code defaults again.
 */

async function upsertConfig(
  workspaceId: string,
  key: string,
  data: { name?: string; description?: string | null; blocks?: string; dateRangeDays?: number; isCustom?: boolean },
) {
  const existing = await db.reportConfig.findUnique({ where: { workspaceId_key: { workspaceId, key } } });
  if (existing) {
    await db.reportConfig.update({ where: { id: existing.id }, data });
    return;
  }
  const report = await getReport(workspaceId, key);
  await db.reportConfig.create({
    data: {
      workspaceId,
      key,
      name: data.name ?? report?.name ?? key,
      description: data.description ?? report?.description ?? null,
      blocks: data.blocks ?? JSON.stringify(report?.blocks ?? []),
      dateRangeDays: data.dateRangeDays ?? report?.dateRangeDays ?? 56,
      isCustom: data.isCustom ?? report?.isCustom ?? false,
    },
  });
}

/** Add a block to the end of a report. */
export async function addReportBlockAction(formData: FormData) {
  const key = String(formData.get("key"));
  const block = String(formData.get("block"));
  if (!isBlockKey(block)) return;
  const { workspace } = await requireRole("EDITOR");
  const report = await getReport(workspace.id, key);
  if (!report || report.blocks.includes(block)) return;
  await upsertConfig(workspace.id, key, { blocks: JSON.stringify([...report.blocks, block]) });
  revalidatePath(`/reports/${key}`);
}

export async function removeReportBlockAction(formData: FormData) {
  const key = String(formData.get("key"));
  const block = String(formData.get("block"));
  const { workspace } = await requireRole("EDITOR");
  const report = await getReport(workspace.id, key);
  if (!report) return;
  await upsertConfig(workspace.id, key, { blocks: JSON.stringify(report.blocks.filter((b) => b !== block)) });
  revalidatePath(`/reports/${key}`);
}

/** Move a block up or down one slot. */
export async function moveReportBlockAction(formData: FormData) {
  const key = String(formData.get("key"));
  const block = String(formData.get("block"));
  const dir = String(formData.get("dir")) === "up" ? -1 : 1;
  const { workspace } = await requireRole("EDITOR");
  const report = await getReport(workspace.id, key);
  if (!report) return;
  const i = report.blocks.findIndex((b) => b === block);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= report.blocks.length) return;
  const next = [...report.blocks];
  [next[i], next[j]] = [next[j], next[i]];
  await upsertConfig(workspace.id, key, { blocks: JSON.stringify(next) });
  revalidatePath(`/reports/${key}`);
}

export async function setReportRangeAction(formData: FormData) {
  const key = String(formData.get("key"));
  const days = parseInt(String(formData.get("days")), 10);
  if (![28, 56, 84].includes(days)) return;
  const { workspace } = await requireRole("EDITOR");
  await upsertConfig(workspace.id, key, { dateRangeDays: days });
  revalidatePath(`/reports/${key}`);
}

/** Stock report only: drop the override row and track code defaults again. */
export async function resetReportAction(formData: FormData) {
  const key = String(formData.get("key"));
  if (!stockDefault(key)) return;
  const { workspace } = await requireRole("EDITOR");
  await db.reportConfig.deleteMany({ where: { workspaceId: workspace.id, key } });
  revalidatePath(`/reports/${key}`);
  revalidatePath("/reports");
}

export async function createCustomReportAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!name) return;
  const { user, workspace } = await requireRole("EDITOR");
  const key = `custom-${Math.random().toString(36).slice(2, 10)}`;
  await db.reportConfig.create({
    data: {
      workspaceId: workspace.id,
      key,
      name,
      description: String(formData.get("description") ?? "").trim().slice(0, 200) || "Custom report",
      // Start with a sensible skeleton; the customize panel does the rest.
      blocks: JSON.stringify(["kpis"]),
      isCustom: true,
    },
  });
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "report.custom_created",
    entityType: "report_config",
    meta: { key, name },
  });
  redirect(`/reports/${key}`);
}

export async function renameReportAction(formData: FormData) {
  const key = String(formData.get("key"));
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!name) return;
  const { workspace } = await requireRole("EDITOR");
  await upsertConfig(workspace.id, key, { name });
  revalidatePath(`/reports/${key}`);
  revalidatePath("/reports");
}

export async function deleteCustomReportAction(formData: FormData) {
  const key = String(formData.get("key"));
  const { workspace } = await requireRole("EDITOR");
  await db.reportConfig.deleteMany({ where: { workspaceId: workspace.id, key, isCustom: true } });
  revalidatePath("/reports");
  redirect("/reports");
}

