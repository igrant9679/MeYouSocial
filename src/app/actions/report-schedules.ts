"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { getReport } from "@/lib/report-defs";
import { getPostingTimeZone, formatInZone } from "@/lib/social/slots";
import { describeScheduleTime, isCadence, MAX_SCHEDULES, nextRunAt, parseRecipients, parseScheduleTime, sendReportSchedule } from "@/lib/report-schedules";

/**
 * E-MEA-03: emailing a report on a schedule. ADMIN — it sends the workspace's
 * numbers to people, so it's the same bar as inviting them. Recipients must be
 * active members (a client is invited as a Viewer); the sweep re-checks that
 * at every send. Deleting a schedule goes through the shared DeleteButton.
 */

function back(key: string, msg: string, ok = false): never {
  redirect(`/reports/${encodeURIComponent(key)}?${ok ? "flash" : "flashErr"}=${encodeURIComponent(msg)}#schedule`);
}

export async function saveReportScheduleAction(formData: FormData) {
  const key = String(formData.get("reportKey") ?? "");
  const id = String(formData.get("id") ?? "").trim();
  const { workspace, user } = await requireRole("ADMIN");
  if (!(await getReport(workspace.id, key))) back(key, "That report doesn't exist.");
  const time = parseScheduleTime({
    cadence: String(formData.get("cadence") ?? ""),
    weekday: String(formData.get("weekday") ?? ""),
    monthDay: String(formData.get("monthDay") ?? ""),
    hour: String(formData.get("hour") ?? ""),
  });
  if ("error" in time) back(key, time.error);
  const picked = [...new Set(formData.getAll("recipient").map(String).filter(Boolean))];
  const members = await db.membership.findMany({ where: { workspaceId: workspace.id, status: "active", userId: { in: picked } }, select: { userId: true } });
  const recipients = members.map((m) => m.userId);
  if (recipients.length === 0) back(key, "Choose at least one person to send it to.");
  if (recipients.length < picked.length) back(key, "Only members of this workspace can receive a report — invite a client as a Viewer first.");

  const tz = await getPostingTimeZone(workspace.id);
  const nextAt = nextRunAt(time, tz, new Date());
  const data = { cadence: time.cadence, weekday: time.weekday, monthDay: time.monthDay, hour: time.hour, recipients: JSON.stringify(recipients), nextAt };
  if (id) {
    const done = await db.reportSchedule.updateMany({ where: { id, workspaceId: workspace.id, reportKey: key }, data });
    if (done.count !== 1) back(key, "That schedule is gone.");
  } else {
    if ((await db.reportSchedule.count({ where: { workspaceId: workspace.id } })) >= MAX_SCHEDULES) back(key, `A workspace can have ${MAX_SCHEDULES} report schedules — remove one first.`);
    await db.reportSchedule.create({ data: { ...data, workspaceId: workspace.id, reportKey: key, createdById: user.id } });
  }
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: id ? "report.schedule_changed" : "report.schedule_created", entityType: "report_schedule", entityId: id || null, meta: { report: key, ...time, recipients: recipients.length } });
  revalidatePath(`/reports/${key}`);
  back(key, `${describeScheduleTime(time)} to ${recipients.length} ${recipients.length === 1 ? "person" : "people"} — first send ${formatInZone(nextAt, tz)} (${tz}).`, true);
}

export async function toggleReportScheduleAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const { workspace, user } = await requireRole("ADMIN");
  const s = await db.reportSchedule.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!s) redirect("/reports");
  const enabled = !s.enabled;
  const tz = await getPostingTimeZone(workspace.id);
  // Resuming starts from now: no burst of the sends missed while paused.
  const nextAt = enabled ? nextRunAt({ cadence: isCadence(s.cadence) ? s.cadence : "weekly", weekday: s.weekday, monthDay: s.monthDay, hour: s.hour }, tz, new Date()) : s.nextAt;
  await db.reportSchedule.updateMany({ where: { id, workspaceId: workspace.id }, data: { enabled, nextAt } });
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: enabled ? "report.schedule_resumed" : "report.schedule_paused", entityType: "report_schedule", entityId: id, meta: { report: s.reportKey } });
  revalidatePath(`/reports/${s.reportKey}`);
  back(s.reportKey, enabled ? `Resumed — next send ${formatInZone(nextAt, tz)}.` : "Paused — nothing is sent until it's resumed.", true);
}

export async function sendReportScheduleNowAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const { workspace, user } = await requireRole("ADMIN");
  const s = await db.reportSchedule.findFirst({ where: { id, workspaceId: workspace.id }, select: { id: true, reportKey: true, recipients: true } });
  if (!s) redirect("/reports");
  if (parseRecipients(s.recipients).length === 0) back(s.reportKey, "This schedule has nobody to send to.");
  const o = await sendReportSchedule(s.id, { manual: true, actorId: user.id });
  revalidatePath(`/reports/${s.reportKey}`);
  if (!o) back(s.reportKey, "That schedule is gone.");
  back(s.reportKey, o.result, o.delivered > 0);
}
