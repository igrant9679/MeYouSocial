"use server";

import { redirect } from "next/navigation";

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

/** Admin: cap how many articles the autopilot drafts per rolling 7 days.
 *  0 / empty clears the cap (pool- and budget-bounded, as before). */
export async function saveWeeklyArticleTargetAction(formData: FormData) {
  const { user, workspace } = await requireRole("ADMIN");
  const raw = parseInt(String(formData.get("weeklyArticles") ?? ""), 10);
  const value = Number.isFinite(raw) && raw > 0 ? String(Math.min(50, raw)) : "";
  const { setWorkspaceSetting } = await import("@/lib/settings");
  await setWorkspaceSetting(workspace.id, "autopilot:weekly_articles", value);
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "governance.weekly_articles_set",
    entityType: "workspace",
    meta: { weeklyArticles: value || "unlimited" },
  });
  revalidatePath("/blog/automation");
}

/**
 * Admin: the autonomous-SEO switch. ON = every autopilot draft gets its meta
 * title, description and slug generated (fill-only — a human's hand-tuned
 * values are never overwritten). Stored in the auto_image convention: the row
 * holds "false" to switch off, and is CLEARED to switch on, so absent = on
 * and a stale row can't shadow the default.
 */
export async function toggleAutoSeoAction(formData: FormData) {
  const { user, workspace } = await requireRole("ADMIN");
  const enable = String(formData.get("enable")) === "true";
  const { setWorkspaceSetting } = await import("@/lib/settings");
  await setWorkspaceSetting(workspace.id, "blog:auto_seo", enable ? "" : "false");
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "governance.auto_seo_set",
    entityType: "workspace",
    meta: { enabled: enable },
  });
  revalidatePath("/blog/automation");
}

/**
 * The full-autonomy switch: social posting and blog generation run end to end
 * with nobody clicking.
 *
 * ADMIN, and confirmed by a typed word, because of what it means rather than
 * what it costs: with it on, text this app wrote reaches a real audience with
 * no person in between. Every other destructive-ish control in the app asks for
 * the same deliberateness, and this one deserves it more than most.
 */
export async function toggleFullAutonomyAction(formData: FormData) {
  const { user, workspace } = await requireRole("ADMIN");
  const { isFullyAutonomous, enableFullAutonomy, disableFullAutonomy } = await import("@/lib/autonomy");
  const on = await isFullyAutonomous(workspace.id);

  if (!on) {
    // Turning it ON is the one direction that needs the typed confirmation —
    // switching it off is always safe and must never be obstructed.
    const typed = String(formData.get("confirm") ?? "").trim().toUpperCase();
    if (typed !== "AUTONOMOUS") {
      redirect(`/blog/automation?err=${encodeURIComponent('Type AUTONOMOUS to confirm — with this on, posts and articles go out with nobody reviewing them.')}`);
    }
    await enableFullAutonomy(workspace.id, user.id);
  } else {
    await disableFullAutonomy(workspace.id, user.id);
  }

  revalidatePath("/blog/automation");
  revalidatePath("/social", "layout");
  redirect(`/blog/automation?ok=${encodeURIComponent(on
    ? "Full autonomy is OFF. Your previous automation settings are back."
    : "Full autonomy is ON. Ideas, drafts, images, SEO, queueing and publishing now run unattended — the truthfulness gates still hold.")}`);
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
