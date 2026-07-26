"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarRange, Plus, Trash2, Pause, Play, Globe } from "lucide-react";
import { SubmitButton } from "@/components/SubmitButton";
import {
  addPostingSlotsAction,
  clearWeekdaySlotsAction,
  deletePostingSlotAction,
  savePostingTimeZoneAction,
  togglePostingSlotAction,
} from "@/app/actions/social-slots";

/**
 * The posting schedule editor — the recurring slots "add to queue" fills.
 *
 * Client-side for two reasons: adding a time across several weekdays at once
 * needs local state, and the timezone picker reads the BROWSER's zone list and
 * detected zone. The server can't detect the user's zone (Railway is UTC), so
 * detection has to happen here and be saved explicitly.
 */

export type ScheduleSlot = { id: string; weekday: number; minute: number; enabled: boolean };

const WEEKDAYS = [
  { n: 1, label: "Mon" }, { n: 2, label: "Tue" }, { n: 3, label: "Wed" }, { n: 4, label: "Thu" },
  { n: 5, label: "Fri" }, { n: 6, label: "Sat" }, { n: 0, label: "Sun" },
];
const WEEKDAY_NUMS = [1, 2, 3, 4, 5];
const WEEKEND_NUMS = [6, 0];

function fmt(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export function PostingSchedule({
  slots,
  timeZone,
  timeZoneConfigured,
  canEdit,
  nextFree,
}: {
  slots: ScheduleSlot[];
  timeZone: string;
  /** False when we're falling back to UTC because nobody chose a zone. */
  timeZoneConfigured: boolean;
  canEdit: boolean;
  /** Pre-formatted in `timeZone` by the server, or null when there's nothing free. */
  nextFree: string | null;
}) {
  const [days, setDays] = useState<Set<number>>(new Set(WEEKDAY_NUMS));
  const [time, setTime] = useState("09:00");
  const [detected, setDetected] = useState<string | null>(null);
  const [zones, setZones] = useState<string[]>([]);

  useEffect(() => {
    try {
      setDetected(Intl.DateTimeFormat().resolvedOptions().timeZone || null);
      // Not in every runtime's typings yet; absent = fall back to a free-text input.
      const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
      if (supported) setZones(supported("timeZone"));
    } catch {
      /* zone list is a convenience — the text input still works without it */
    }
  }, []);

  const byDay = useMemo(() => {
    const map = new Map<number, ScheduleSlot[]>();
    for (const s of slots) {
      const list = map.get(s.weekday) ?? [];
      list.push(s);
      map.set(s.weekday, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.minute - b.minute);
    return map;
  }, [slots]);

  const activeCount = slots.filter((s) => s.enabled).length;
  const perWeek = activeCount;
  const mismatch = detected && detected !== timeZone;

  const toggleDay = (n: number) =>
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n); else next.add(n);
      return next;
    });

  return (
    // Set-once config, so it collapses like the UTM card — but stays OPEN while
    // there's no schedule, because that's the state that needs the user's hands.
    <details data-elsie="posting-schedule" className="card mb-6" open={activeCount === 0}>
      <summary className="cursor-pointer flex items-center gap-2 flex-wrap">
        <CalendarRange className="w-4 h-4" style={{ color: "var(--violet-on)" }} />
        <h2 className="font-mono font-bold text-sm">Posting schedule</h2>
        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full"
          style={{ background: activeCount ? "var(--violet-soft)" : "var(--zebra)", color: activeCount ? "var(--violet-on)" : "var(--mute)" }}>
          {perWeek} slot{perWeek === 1 ? "" : "s"}/week
        </span>
        <span className="flex-1" />
        <span className="text-[11px] text-[var(--mute)]">
          {nextFree ? <>next free slot <b className="font-mono">{nextFree}</b></> : activeCount ? "no free slots ahead" : "no slots yet"}
        </span>
      </summary>

      <p className="text-[11px] text-[var(--mute)] mt-2 mb-3 leading-relaxed">
        Recurring times you publish at. “Add to queue” drops a post into the next free one, so the
        usual case never needs a date picker. Slots are wall-clock times in the posting timezone —
        <b> 09:00 stays 09:00 across a daylight-saving change</b>.
      </p>

      {/* Timezone — the schedule means nothing without it, so it leads. */}
      <div className="rounded-lg border p-2 mb-3" style={{ borderColor: timeZoneConfigured ? "var(--line)" : "var(--amber)" }}>
        <form action={savePostingTimeZoneAction} className="flex flex-wrap items-end gap-2">
          <label className="text-[11px] text-[var(--mute)]">
            <span className="inline-flex items-center gap-1"><Globe className="w-3 h-3" /> Posting timezone</span>
            <input
              name="timezone"
              list="tz-list"
              defaultValue={timeZoneConfigured ? timeZone : (detected ?? timeZone)}
              disabled={!canEdit}
              className="block mt-0.5 w-56 text-xs font-mono"
            />
            <datalist id="tz-list">{zones.map((z) => <option key={z} value={z} />)}</datalist>
          </label>
          {canEdit && <SubmitButton className="btn sm" pendingText="Saving…">Save timezone</SubmitButton>}
          <p className="text-[11px] basis-full" style={{ color: timeZoneConfigured ? "var(--mute)" : "var(--amber-on)" }}>
            {!timeZoneConfigured ? (
              <>Not set — slot times are being read as <b>UTC</b>, which is almost certainly not what you meant.
                {detected && <> Your browser says <b className="font-mono">{detected}</b>.</>}</>
            ) : mismatch ? (
              <>Saved as <b className="font-mono">{timeZone}</b>; your browser is in <b className="font-mono">{detected}</b>.
                That&apos;s fine if the schedule follows the company rather than you.</>
            ) : (
              <>Slot times are read in <b className="font-mono">{timeZone}</b>.</>
            )}
          </p>
        </form>
      </div>

      {/* The week */}
      <div className="grid grid-cols-2 @2xl:grid-cols-4 @4xl:grid-cols-7 gap-1.5 mb-3">
        {WEEKDAYS.map(({ n, label }) => {
          const list = byDay.get(n) ?? [];
          return (
            <div key={n} className="rounded-lg border border-[var(--line)] p-1.5 flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">{label}</span>
                <span className="flex-1" />
                {canEdit && list.length > 0 && (
                  <form action={clearWeekdaySlotsAction}>
                    <input type="hidden" name="weekday" value={n} />
                    <button className="text-[var(--mute)] hover:text-[var(--rose-on)]" title={`Clear every ${label} slot`}>
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </form>
                )}
              </div>
              {list.length === 0 && <span className="text-[10px] text-[var(--mute)] italic py-1">—</span>}
              {list.map((s) => (
                <div key={s.id} className="flex items-center gap-1 rounded px-1 py-0.5"
                  style={{ background: s.enabled ? "var(--violet-soft)" : "var(--zebra)" }}>
                  <span className="font-mono text-[11px]" style={{ color: s.enabled ? "var(--violet-on)" : "var(--mute)", textDecoration: s.enabled ? undefined : "line-through" }}>
                    {fmt(s.minute)}
                  </span>
                  <span className="flex-1" />
                  {canEdit && (
                    <>
                      <form action={togglePostingSlotAction}>
                        <input type="hidden" name="id" value={s.id} />
                        <button className="text-[var(--mute)] hover:text-[var(--ink)]" title={s.enabled ? "Pause this slot" : "Resume this slot"}>
                          {s.enabled ? <Pause className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
                        </button>
                      </form>
                      <form action={deletePostingSlotAction}>
                        <input type="hidden" name="id" value={s.id} />
                        <button className="text-[var(--mute)] hover:text-[var(--rose-on)]" title="Remove this slot">
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      </form>
                    </>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Add a time across several days at once — how people describe a schedule. */}
      {canEdit ? (
        <form action={addPostingSlotsAction} className="flex flex-wrap items-end gap-2 border-t border-[var(--line)] pt-3">
          <label className="text-[11px] text-[var(--mute)]">
            Time
            <input type="time" name="time" value={time} onChange={(e) => setTime(e.target.value)} required
              className="block mt-0.5 text-xs font-mono" />
          </label>
          <div>
            <div className="text-[11px] text-[var(--mute)] mb-0.5">On</div>
            <div className="flex flex-wrap gap-1">
              {WEEKDAYS.map(({ n, label }) => {
                const on = days.has(n);
                return (
                  <label key={n} className="px-1.5 py-1 rounded-md border cursor-pointer text-[11px] font-mono"
                    style={on
                      ? { borderColor: "var(--violet)", background: "var(--violet-soft)", color: "var(--violet-on)" }
                      : { borderColor: "var(--line-2)", color: "var(--mute)" }}>
                    <input type="checkbox" name="weekdays" value={n} checked={on} onChange={() => toggleDay(n)} className="sr-only" />
                    {label}
                  </label>
                );
              })}
            </div>
          </div>
          <div className="flex gap-1">
            <button type="button" className="btn sm" onClick={() => setDays(new Set(WEEKDAY_NUMS))}>Weekdays</button>
            <button type="button" className="btn sm" onClick={() => setDays(new Set(WEEKEND_NUMS))}>Weekend</button>
            <button type="button" className="btn sm" onClick={() => setDays(new Set([...WEEKDAY_NUMS, ...WEEKEND_NUMS]))}>All</button>
          </div>
          <span className="flex-1" />
          <SubmitButton className="btn primary sm" disabled={days.size === 0} pendingText="Adding…">
            <Plus className="w-3.5 h-3.5" /> Add slot{days.size > 1 ? `s (${days.size})` : ""}
          </SubmitButton>
        </form>
      ) : (
        <p className="text-[11px] text-[var(--mute)] border-t border-[var(--line)] pt-3">
          Only workspace admins can change the posting schedule.
        </p>
      )}
    </details>
  );
}
