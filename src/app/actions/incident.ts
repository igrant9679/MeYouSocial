"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole, isPlatformOperator } from "@/lib/acl";
import { writeAudit } from "@/lib/governance";
import { setPlatformSetting } from "@/lib/settings";
import { INCIDENT_SETTING, SESSIONS_AFTER_SETTING, INCIDENT_STEPS, RECONNECT_KEYS, currentIncident, type IncidentStep } from "@/lib/incident";

async function requireOperator() {
  const ctx = await requireRole("ADMIN");
  if (!isPlatformOperator(ctx.user.email)) redirect("/forbidden?why=operator");
  return ctx;
}

const back = (q: string) => redirect(`/admin/incident?${q}`);

/**
 * Declare an incident (E-SEC-06): the chosen steps run across EVERY workspace,
 * each workspace's audit log records what happened to it (which tells its admins,
 * E-SEC-12), and its admins see a banner until the operator ends it. "Sign
 * everyone out" runs last, so this request finishes — the operator is signed out
 * with everyone else.
 */
export async function declareIncidentAction(formData: FormData) {
  const { user } = await requireOperator();
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  if (!note) back("flashErr=" + encodeURIComponent("Say what happened — every admin will read it."));
  if (formData.get("confirm") !== "yes") back("flashErr=" + encodeURIComponent("Tick the confirmation — these steps can't be undone."));
  const steps = INCIDENT_STEPS.filter((s) => formData.get(`step_${s}`) === "on");
  if (!steps.length) back("flashErr=" + encodeURIComponent("Choose at least one step."));

  const now = new Date();
  const workspaces = await db.workspace.findMany({ select: { id: true } });
  const per = new Map<string, Partial<Record<IncidentStep, number>>>(workspaces.map((w) => [w.id, {}]));
  const bump = (ws: string, step: IncidentStep, n: number) => { const m = per.get(ws); if (m) m[step] = (m[step] ?? 0) + n; };

  if (steps.includes("invitations")) {
    // Expired, not deleted: the rows stay as the record of who was invited.
    const open = await db.invitation.findMany({ where: { acceptedAt: null, expiresAt: { gt: now } }, select: { id: true, workspaceId: true } });
    await db.invitation.updateMany({ where: { id: { in: open.map((i) => i.id) } }, data: { expiresAt: now } });
    for (const i of open) bump(i.workspaceId, "invitations", 1);
  }
  if (steps.includes("tokens")) {
    const live = await db.apiToken.findMany({ where: { revokedAt: null }, select: { id: true, workspaceId: true } });
    await db.apiToken.updateMany({ where: { id: { in: live.map((t) => t.id) } }, data: { revokedAt: now } });
    for (const t of live) bump(t.workspaceId, "tokens", 1);
  }
  if (steps.includes("oauth")) {
    // YouTube and Analytics sign-ins, per workspace — each must be reconnected.
    // Drive storage is the platform's and is left alone (disconnect it on Keys).
    const rows = await db.workspaceSetting.findMany({ where: { key: { in: [...RECONNECT_KEYS] }, NOT: { value: "" } }, select: { workspaceId: true, key: true } });
    const { disconnectYoutubeOauth } = await import("@/lib/youtube/oauth");
    const { disconnectAnalyticsOauth } = await import("@/lib/google/analytics-oauth");
    for (const r of rows) {
      if (r.key === "youtube_oauth:refresh_token") await disconnectYoutubeOauth(r.workspaceId);
      else await disconnectAnalyticsOauth(r.workspaceId);
      bump(r.workspaceId, "oauth", 1);
    }
  }

  await setPlatformSetting(INCIDENT_SETTING, JSON.stringify({ since: now.toISOString(), note, by: user.email, steps }));
  for (const w of workspaces) {
    await writeAudit({ workspaceId: w.id, actorId: user.id, action: "security.incident_declared", entityType: "platform", entityId: null, meta: { note, steps, ...per.get(w.id) } });
  }
  if (steps.includes("sessions")) await setPlatformSetting(SESSIONS_AFTER_SETTING, now.toISOString());
  revalidatePath("/", "layout");
  back("flash=" + encodeURIComponent(`Incident declared across ${workspaces.length} workspaces.${steps.includes("sessions") ? " Everyone is signed out — you too; sign in again." : ""}`));
}

/** End incident mode: the banner goes. Nothing the steps did is undone. */
export async function endIncidentAction() {
  const { user } = await requireOperator();
  const incident = await currentIncident();
  if (!incident) back("flash=" + encodeURIComponent("No incident is open."));
  await setPlatformSetting(INCIDENT_SETTING, "");
  const workspaces = await db.workspace.findMany({ select: { id: true } });
  for (const w of workspaces) {
    await writeAudit({ workspaceId: w.id, actorId: user.id, action: "security.incident_ended", entityType: "platform", entityId: null, meta: { since: incident?.since ?? null } });
  }
  revalidatePath("/", "layout");
  back("flash=" + encodeURIComponent("Incident mode ended. The banner is gone; nothing the steps did was undone."));
}
