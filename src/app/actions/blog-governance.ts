"use server";

import { redirect } from "next/navigation";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { FUNCTION_LABELS, GOVERNED_FUNCTIONS, MODES, writeAudit } from "@/lib/governance";
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
  revalidatePath("/setup/automation");
  // Say what happened — a click that silently did nothing (busy, paused) read
  // as a broken button.
  const said =
    report.skipped === "busy" ? "A cycle is already running for this workspace — nothing was started. Try again in a minute."
    : report.skipped === "paused" ? "The global pause is on, so the cycle didn't run."
    : `Cycle ran: ${report.drafted} drafted, ${report.autoAdvanced} advanced, ${report.autoQueued} queued, ${report.published} published.` +
      (report.budgetReached ? " Today's unattended AI budget is spent, so nothing new was generated." : "") +
      (report.failedSteps?.length ? ` Failed: ${report.failedSteps.map((f) => `${f.step} (${f.message})`).join("; ")}.` : "");
  redirect(`/setup/automation?${report.skipped || report.failedSteps?.length ? "err" : "ok"}=${encodeURIComponent(said.slice(0, 600))}`);
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
  revalidatePath("/setup/automation");
  // Every change on this page says it happened (SET-13).
  redirect(`/setup/automation?ok=${encodeURIComponent(`${FUNCTION_LABELS[fn as keyof typeof FUNCTION_LABELS] ?? fn} is now ${mode}.`)}`);
}

/** Admin: cap how many articles the autopilot drafts per rolling 7 days
 *  (0 / empty clears the cap — pool- and budget-bounded, as before), and pick
 *  the day auto-publishing fires (empty = any day). One form saves both. */
export async function saveWeeklyArticleTargetAction(formData: FormData) {
  const { user, workspace } = await requireRole("ADMIN");
  const raw = parseInt(String(formData.get("weeklyArticles") ?? ""), 10);
  const value = Number.isFinite(raw) && raw > 0 ? String(Math.min(50, raw)) : "";
  const rawDay = String(formData.get("publishDay") ?? "").trim();
  const publishDay = /^[0-6]$/.test(rawDay) ? rawDay : "";
  const { setWorkspaceSetting } = await import("@/lib/settings");
  await setWorkspaceSetting(workspace.id, "autopilot:weekly_articles", value);
  await setWorkspaceSetting(workspace.id, "autopilot:publish_day", publishDay);
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "governance.weekly_articles_set",
    entityType: "workspace",
    meta: { weeklyArticles: value || "unlimited", publishDay: publishDay || "any day" },
  });
  revalidatePath("/setup/automation");
  redirect(`/setup/automation?ok=${encodeURIComponent(`Saved: ${value ? `${value} article${value === "1" ? "" : "s"} a week` : "no weekly article cap"}, publishing ${publishDay ? ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"][Number(publishDay)] : "on any day"}.`)}`);
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
  revalidatePath("/setup/automation");
  redirect(`/setup/automation?ok=${encodeURIComponent(enable ? "Automatic SEO is on." : "Automatic SEO is off.")}`);
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
  // The form says which way it means; a stale tab or a double click used to
  // flip it back the other way (audit ENG-24). Asking for the state it is
  // already in changes nothing.
  const want = String(formData.get("intent") ?? "");
  if ((want === "on" && on) || (want === "off" && !on)) {
    redirect(`/setup/automation?ok=${encodeURIComponent(on ? "Full autonomy was already ON — nothing changed." : "Full autonomy was already off — nothing changed.")}`);
  }

  if (!on) {
    // Turning it ON is the one direction that needs the typed confirmation —
    // switching it off is always safe and must never be obstructed.
    const typed = String(formData.get("confirm") ?? "").trim().toUpperCase();
    if (typed !== "AUTONOMOUS") {
      redirect(`/setup/automation?err=${encodeURIComponent('Type AUTONOMOUS to confirm — with this on, posts and articles go out with nobody reviewing them.')}`);
    }
    await enableFullAutonomy(workspace.id, user.id);
  } else {
    await disableFullAutonomy(workspace.id, user.id);
  }

  revalidatePath("/setup/automation");
  revalidatePath("/social", "layout");
  redirect(`/setup/automation?ok=${encodeURIComponent(on
    ? "Full autonomy is OFF. Your previous automation settings are back."
    : "Full autonomy is ON. Ideas, drafts, images, SEO, queueing and publishing now run unattended — the truthfulness gates still hold.")}`);
}

export async function toggleGlobalPauseAction(formData?: FormData) {
  const { user, workspace } = await requireRole("ADMIN");
  const current = await db.automationState.findUnique({ where: { workspaceId: workspace.id } });
  const now = current?.globalPause ?? false;
  // Explicit, like the autonomy switch: "pause" from a stale tab must not
  // resume a workspace someone else just paused.
  const want = String(formData?.get("intent") ?? "");
  const next = want === "pause" ? true : want === "resume" ? false : !now;
  if (next === now) {
    revalidatePath("/setup/automation");
  redirect(`/setup/automation?ok=${encodeURIComponent(now ? "Already paused — nothing changed." : "Already running — nothing changed.")}`);
  }
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
  revalidatePath("/setup/automation");
  revalidatePath("/blog");
  redirect(`/setup/automation?ok=${encodeURIComponent(next ? "Paused — nothing generates, queues or publishes until you resume." : "Resumed.")}`);
}
