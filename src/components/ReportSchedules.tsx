import { Mail, Pause, Play, Send } from "lucide-react";
import { db } from "@/lib/db";
import { SubmitButton } from "@/components/SubmitButton";
import { DeleteButton } from "@/components/DeleteButton";
import { getPostingTimeZone, formatInZone } from "@/lib/social/slots";
import { describeScheduleTime, isCadence, parseRecipients, WEEKDAY_NAMES } from "@/lib/report-schedules";
import { saveReportScheduleAction, sendReportScheduleNowAction, toggleReportScheduleAction } from "@/app/actions/report-schedules";

/**
 * E-MEA-03: the report page's "Email this report on a schedule" card. Admins
 * set it up; everyone sees who gets it and what the last send did.
 */

type Member = { userId: string; role: string; name: string | null; email: string | null };
type Defaults = { id?: string; cadence: string; weekday: number; monthDay: number; hour: number; recipients: string[] };

const ROLE_WORD: Record<string, string> = { ADMIN: "Admin", EDITOR: "Editor", VIEWER: "Viewer" };

function ScheduleForm({ reportKey, members, d, submit }: { reportKey: string; members: Member[]; d: Defaults; submit: string }) {
  return (
    <form action={saveReportScheduleAction} className="flex flex-col gap-2 text-xs" data-schedule-form={d.id ?? "new"}>
      <input type="hidden" name="reportKey" value={reportKey} />
      {d.id && <input type="hidden" name="id" value={d.id} />}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[var(--mute)]">How often</span>
          <select key={`cadence:${d.cadence}`} name="cadence" defaultValue={d.cadence}>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[var(--mute)]">Weekly, on</span>
          <select key={`weekday:${String(d.weekday)}`} name="weekday" defaultValue={String(d.weekday)}>
            {[1, 2, 3, 4, 5, 6, 0].map((w) => <option key={w} value={w}>{WEEKDAY_NAMES[w]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[var(--mute)]">Monthly, on the</span>
          <select key={`monthDay:${String(d.monthDay)}`} name="monthDay" defaultValue={String(d.monthDay)}>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[var(--mute)]">At</span>
          <select key={`hour:${String(d.hour)}`} name="hour" defaultValue={String(d.hour)}>
            {Array.from({ length: 24 }, (_, h) => h).map((h) => <option key={h} value={h}>{`${String(h).padStart(2, "0")}:00`}</option>)}
          </select>
        </label>
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-[var(--mute)] mb-0.5">Send it to</legend>
        {members.map((m) => (
          <label key={m.userId} className="flex items-center gap-1.5">
            <input type="checkbox" name="recipient" value={m.userId} defaultChecked={d.recipients.includes(m.userId)} />
            <span>{m.name ?? m.email ?? m.userId}</span>
            {m.email && m.name && <span className="text-[var(--mute)]">· {m.email}</span>}
            <span className="font-mono text-micro px-1.5 rounded-full" style={{ background: "var(--panel)", color: "var(--mute)" }}>{ROLE_WORD[m.role] ?? m.role}</span>
          </label>
        ))}
      </fieldset>
      <p className="text-2xs text-[var(--mute)]">
        Only members of this workspace can receive it — to send it to a client, invite them as a Viewer (Settings → People).
      </p>
      <div><SubmitButton className="btn primary sm">{submit}</SubmitButton></div>
    </form>
  );
}

export async function ReportSchedules({ workspaceId, reportKey, admin }: { workspaceId: string; reportKey: string; admin: boolean }) {
  const [schedules, memberships, tz] = await Promise.all([
    db.reportSchedule.findMany({ where: { workspaceId, reportKey }, orderBy: { createdAt: "asc" } }),
    db.membership.findMany({ where: { workspaceId, status: "active" }, select: { userId: true, role: true, user: { select: { name: true, email: true } } }, orderBy: { createdAt: "asc" } }),
    getPostingTimeZone(workspaceId),
  ]);
  const members: Member[] = memberships.map((m) => ({ userId: m.userId, role: m.role, name: m.user.name, email: m.user.email }));
  const nameOf = new Map(members.map((m) => [m.userId, m.name ?? m.email ?? "someone"]));
  const active = schedules.filter((s) => s.enabled);
  const soonest = active.reduce<Date | null>((a, s) => (!a || s.nextAt < a ? s.nextAt : a), null);
  if (!admin && schedules.length === 0) return null;

  return (
    <details className="card mb-4" id="schedule" data-report-schedules="" open={schedules.length > 0}>
      <summary className="cursor-pointer select-none text-sm font-semibold flex items-center gap-2 flex-wrap">
        <Mail className="w-4 h-4" /> Email this report on a schedule
        <span className="font-mono text-micro font-normal text-[var(--mute)]">
          {schedules.length === 0 ? "none yet" : `${schedules.length} schedule${schedules.length === 1 ? "" : "s"}${soonest ? ` · next ${formatInZone(soonest, tz)}` : " · all paused"}`}
        </span>
      </summary>
      <p className="text-xs text-[var(--mute)] mt-2">
        The report&apos;s numbers as an email — the same text as the PDF, with links to the report and the PDF — sent from this
        workspace&apos;s connected mailbox. Times are {tz}, this workspace&apos;s posting zone.
      </p>
      {schedules.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {schedules.map((s) => {
            const time = { cadence: isCadence(s.cadence) ? s.cadence : "weekly", weekday: s.weekday, monthDay: s.monthDay, hour: s.hour } as const;
            const recipients = parseRecipients(s.recipients);
            const current = recipients.filter((r) => nameOf.has(r));
            return (
              <li key={s.id} className="border border-[var(--line)] rounded-lg p-2.5 text-xs" data-schedule={s.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{describeScheduleTime(time)}</span>
                  <span className="font-mono text-micro px-1.5 py-0.5 rounded-full" style={s.enabled ? { background: "var(--green-soft)", color: "var(--green-on)" } : { background: "var(--panel)", color: "var(--mute)" }}>
                    {s.enabled ? `next ${formatInZone(s.nextAt, tz)}` : "paused"}
                  </span>
                </div>
                <p className="mt-1">
                  To {current.length ? current.map((r) => nameOf.get(r)).join(", ") : "nobody who is still a member"}
                  {recipients.length > current.length && <span className="text-[var(--mute)]"> · {recipients.length - current.length} no longer a member</span>}
                </p>
                {s.lastResult && (
                  <p className="mt-1 text-[var(--mute)]" data-last-result="">
                    Last: {s.lastAttemptAt ? `${formatInZone(s.lastAttemptAt, tz)} — ` : ""}{s.lastResult}
                  </p>
                )}
                {admin && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <form action={sendReportScheduleNowAction}>
                      <input type="hidden" name="id" value={s.id} />
                      <SubmitButton className="btn sm"><Send className="w-3 h-3" /> Send now</SubmitButton>
                    </form>
                    <form action={toggleReportScheduleAction}>
                      <input type="hidden" name="id" value={s.id} />
                      <SubmitButton className="btn sm">{s.enabled ? <><Pause className="w-3 h-3" /> Pause</> : <><Play className="w-3 h-3" /> Resume</>}</SubmitButton>
                    </form>
                    <DeleteButton kind="reportSchedule" id={s.id} name="report schedule" returnTo={`/reports/${reportKey}`} label="Remove" className="btn sm" />
                    <details className="w-full mt-1">
                      <summary className="cursor-pointer text-[var(--mute)]">Change</summary>
                      <div className="mt-2">
                        <ScheduleForm reportKey={reportKey} members={members} d={{ id: s.id, cadence: s.cadence, weekday: s.weekday, monthDay: s.monthDay, hour: s.hour, recipients }} submit="Save changes" />
                      </div>
                    </details>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {admin && (
        <details className="mt-3" open={schedules.length === 0}>
          <summary className="cursor-pointer text-xs font-semibold">Add a schedule</summary>
          <div className="mt-2">
            <ScheduleForm reportKey={reportKey} members={members} d={{ cadence: "weekly", weekday: 1, monthDay: 1, hour: 9, recipients: [] }} submit="Start sending" />
          </div>
        </details>
      )}
    </details>
  );
}
