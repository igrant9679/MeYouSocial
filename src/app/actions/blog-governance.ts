"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { GOVERNED_FUNCTIONS, MODES, writeAudit } from "@/lib/governance";
import { runAutopilotCycle } from "@/lib/blog-autopilot";

/** Admin: run this workspace's autopilot cycle immediately (testing / catch-up). */
export async function runAutopilotNowAction() {
  const { user, workspace } = await requireRole("ADMIN");
  const report = await runAutopilotCycle(workspace.id);
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "autopilot.manual_run",
    entityType: "workspace",
    meta: report as unknown as Record<string, unknown>,
  });
  revalidatePath("/blog/automation");
}

export async function setFunctionModeAction(formData: FormData) {
  const fn = String(formData.get("function"));
  const mode = String(formData.get("mode"));
  if (!(GOVERNED_FUNCTIONS as readonly string[]).includes(fn)) return;
  if (!(MODES as readonly string[]).includes(mode)) return;
  const { user, workspace } = await requireRole("ADMIN");
  await db.functionMode.upsert({
    where: { workspaceId_function: { workspaceId: workspace.id, function: fn } },
    update: { mode },
    create: { workspaceId: workspace.id, function: fn, mode },
  });
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "governance.mode_set",
    entityType: "function_mode",
    meta: { function: fn, mode },
  });
  revalidatePath("/blog/automation");
}

export async function toggleGlobalPauseAction() {
  const { user, workspace } = await requireRole("ADMIN");
  const current = await db.automationState.findUnique({ where: { workspaceId: workspace.id } });
  const next = !(current?.globalPause ?? false);
  await db.automationState.upsert({
    where: { workspaceId: workspace.id },
    update: { globalPause: next },
    create: { workspaceId: workspace.id, globalPause: next },
  });
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: next ? "governance.global_pause_on" : "governance.global_pause_off",
    entityType: "workspace",
  });
  revalidatePath("/blog/automation");
  revalidatePath("/blog");
}
