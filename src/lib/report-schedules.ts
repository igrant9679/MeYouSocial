import { db } from "@/lib/db";
import { emailFor } from "@/lib/email";
import { getPublicUrl } from "@/lib/public-url";
import { writeAudit } from "@/lib/governance";
import { getPostingTimeZone, zonedParts, zonedTimeToUtc, formatInZone } from "@/lib/social/slots";
import { reportContent, renderReportEmail } from "@/lib/report-pdf";

/**
 * Scheduled reports (E-MEA-03): a report emailed weekly or monthly to named
 * members of the workspace — client viewers included, which is how a client
 * gets one — through the workspace's own mailbox, like the morning digest.
 *
 * ⚠ MEMBERS ONLY. Recipients are user ids, re-checked against active
 *   memberships at every send: someone removed from the workspace stops
 *   receiving its numbers the same minute, and nobody can type in an outside
 *   address and have the workspace's data mailed there. To add a client,
 *   invite them as a Viewer.
 * ⚠ A MOCKED SEND IS NOT A SEND. With no mailbox connected the mailer logs to
 *   the console; the schedule then says "not delivered", never "sent".
 * ⚠ ONE SEND PER SLOT. The sweep claims a due row by moving `nextAt` on with a
 *   compare-and-set on its old value, so two replicas (or two ticks) can't both
 *   send it. A slot missed by more than LATE_HOURS (the server was down) is
 *   skipped and said so — a "weekly" report three days late misleads.
 * Times are wall clock in the workspace's posting zone, as everywhere else.
 */

export const CADENCES = ["weekly", "monthly"] as const;
export type Cadence = (typeof CADENCES)[number];
export const isCadence = (v: string): v is Cadence => (CADENCES as readonly string[]).includes(v);
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const MAX_SCHEDULES = 20;
export const LATE_HOURS = 36;

export type ScheduleTime = { cadence: Cadence; weekday: number; monthDay: number; hour: number };

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** "Every Monday at 09:00" / "On the 1st of each month at 09:00". Pure. */
export function describeScheduleTime(s: ScheduleTime): string {
  return s.cadence === "weekly" ? `Every ${WEEKDAY_NAMES[s.weekday] ?? "?"} at ${hh(s.hour)}` : `On the ${ordinal(s.monthDay)} of each month at ${hh(s.hour)}`;
}

/** The first send strictly after `after`, on the workspace's wall clock. Pure. */
export function nextRunAt(s: ScheduleTime, timeZone: string, after: Date): Date {
  const local = zonedParts(after, timeZone);
  // Walk local calendar days from today; a monthly slot is at most ~31 days off.
  for (let i = 0; i < 64; i++) {
    const day = new Date(Date.UTC(local.year, local.month - 1, local.day + i));
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    const matches = s.cadence === "weekly" ? day.getUTCDay() === s.weekday : d === s.monthDay;
    if (!matches) continue;
    const at = zonedTimeToUtc(y, m, d, s.hour, 0, timeZone);
    if (at.getTime() > after.getTime()) return at;
  }
  throw new Error("no next run within 64 days"); // unreachable for valid input
}

/** The form's fields, validated. Null with a reason when something is off. Pure. */
export function parseScheduleTime(f: { cadence: string; weekday: string; monthDay: string; hour: string }): ScheduleTime | { error: string } {
  if (!isCadence(f.cadence)) return { error: "Choose weekly or monthly." };
  const weekday = Number(f.weekday);
  const monthDay = Number(f.monthDay);
  const hour = Number(f.hour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return { error: "Choose an hour of the day." };
  if (f.cadence === "weekly" && (!Number.isInteger(weekday) || weekday < 0 || weekday > 6)) return { error: "Choose a day of the week." };
  // 28 at most, so every month has the day.
  if (f.cadence === "monthly" && (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 28)) return { error: "Choose a day of the month from 1 to 28." };
  return { cadence: f.cadence, weekday: Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? weekday : 1, monthDay: Number.isInteger(monthDay) && monthDay >= 1 && monthDay <= 28 ? monthDay : 1, hour };
}

export function parseRecipients(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export type SendOutcome = { delivered: number; mocked: number; failed: number; dropped: number; result: string };

/** The sentence a send leaves on the schedule. Pure. */
export function outcomeSentence(o: Omit<SendOutcome, "result">, opts: { manual?: boolean } = {}): string {
  const total = o.delivered + o.mocked + o.failed;
  const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
  let s: string;
  if (total === 0) s = "Not sent — none of its recipients is still a member of this workspace.";
  else if (o.delivered === 0 && o.failed === 0) s = "Not delivered — no mailbox is connected for this workspace, so it went nowhere. Connect one in Settings → Connections.";
  else if (o.delivered === total) s = `Sent to ${people(o.delivered)}.`;
  else if (o.delivered === 0) s = `Not delivered — sending failed for all ${people(o.failed)}.`;
  else s = `Sent to ${o.delivered} of ${people(total)} — ${o.failed + o.mocked} didn't go.`;
  if (o.dropped && total > 0) s += ` ${o.dropped === 1 ? "One recipient is" : `${o.dropped} recipients are`} no longer a member and ${o.dropped === 1 ? "was" : "were"} left out.`;
  return opts.manual ? `${s} (sent by hand)` : s;
}

/** Build and mail one schedule's report now. Never throws for a delivery problem; it's in the outcome. */
export async function sendReportSchedule(scheduleId: string, opts: { manual?: boolean; actorId?: string | null } = {}): Promise<SendOutcome | null> {
  const s = await db.reportSchedule.findUnique({ where: { id: scheduleId }, include: { workspace: { select: { id: true, name: true, deletedAt: true } } } });
  if (!s || s.workspace.deletedAt) return null;
  const content = await reportContent(s.workspaceId, s.workspace.name, s.reportKey);
  if (!content) {
    const result = "Paused — the report it sends no longer exists.";
    await db.reportSchedule.update({ where: { id: s.id }, data: { enabled: false, lastResult: result, lastAttemptAt: new Date() } });
    return { delivered: 0, mocked: 0, failed: 0, dropped: 0, result };
  }
  const wanted = parseRecipients(s.recipients);
  const members = await db.membership.findMany({
    where: { workspaceId: s.workspaceId, status: "active", userId: { in: wanted } },
    select: { userId: true, user: { select: { email: true } } },
  });
  const to = members.filter((m) => m.user.email);
  const origin = (await getPublicUrl()).replace(/\/+$/, "");
  const mail = renderReportEmail(content, { origin, cadence: s.cadence });
  const mailer = emailFor(s.workspaceId);
  const o = { delivered: 0, mocked: 0, failed: 0, dropped: wanted.length - to.length };
  for (const m of to) {
    try {
      const res = await mailer.send({ to: m.user.email!, subject: mail.subject, html: mail.html, text: mail.text });
      if (res.mocked) o.mocked++;
      else o.delivered++;
    } catch (e) {
      o.failed++;
      console.error(`[reports] ${s.id} to ${m.user.email} failed:`, e instanceof Error ? e.message : e);
    }
  }
  const result = outcomeSentence(o, { manual: opts.manual });
  const now = new Date();
  await db.reportSchedule.update({ where: { id: s.id }, data: { lastResult: result, lastAttemptAt: now, ...(o.delivered > 0 ? { lastSentAt: now } : {}) } });
  await writeAudit({
    workspaceId: s.workspaceId,
    actorId: opts.actorId ?? null,
    action: o.delivered > 0 ? "report.schedule_sent" : "report.schedule_undelivered",
    entityType: "report_schedule",
    entityId: s.id,
    meta: { report: s.reportKey, manual: !!opts.manual, ...o },
  }).catch(() => {});
  return { ...o, result };
}

/**
 * Send every schedule that is due. Each row is CLAIMED first (nextAt moved on,
 * compare-and-set), then sent; a slot more than LATE_HOURS late is skipped.
 */
export async function sweepScheduledReports(now = new Date()): Promise<{ due: number; sent: number; skipped: number }> {
  const due = await db.reportSchedule.findMany({
    where: { enabled: true, nextAt: { lte: now }, workspace: { deletedAt: null } },
    orderBy: { nextAt: "asc" },
    take: 50,
  });
  let sent = 0;
  let skipped = 0;
  for (const s of due) {
    try {
      const tz = await getPostingTimeZone(s.workspaceId);
      const time = { cadence: isCadence(s.cadence) ? s.cadence : "weekly", weekday: s.weekday, monthDay: s.monthDay, hour: s.hour } as ScheduleTime;
      const next = nextRunAt(time, tz, now);
      const claimed = await db.reportSchedule.updateMany({ where: { id: s.id, enabled: true, nextAt: s.nextAt }, data: { nextAt: next } });
      if (claimed.count !== 1) continue; // another tick has it
      if (now.getTime() - s.nextAt.getTime() > LATE_HOURS * 3_600_000) {
        skipped++;
        await db.reportSchedule.update({
          where: { id: s.id },
          data: { lastResult: `Skipped the ${formatInZone(s.nextAt, tz)} send — the app was down then, and a report that late would mislead. Next: ${formatInZone(next, tz)}.`, lastAttemptAt: now },
        });
        continue;
      }
      const o = await sendReportSchedule(s.id);
      if (o && o.delivered > 0) sent++;
    } catch (e) {
      // One schedule's failure must not starve the rest; name it.
      console.error(`[reports] schedule ${s.id} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return { due: due.length, sent, skipped };
}
