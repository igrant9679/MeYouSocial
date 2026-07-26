"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Pencil, CalendarClock } from "lucide-react";
import { rescheduleSocialPostAction } from "@/app/actions/social";
import { networkFor } from "@/lib/social/networks";

/**
 * Month + week calendar for the scheduling queue — the views the original
 * scheduler deferred in favour of the agenda.
 *
 * **Month** answers "what does my coverage look like"; **week** answers "what
 * goes out when", so it is a TIME GRID (day columns × hour rows) rather than a
 * denser month. That is the whole reason it earns its place: a month cell can
 * only place a post on a day, while a week cell places it at an hour — and
 * dropping into one sets the time, snapped to the half hour.
 *
 * All date maths happens HERE, in the browser, from ISO strings. The server
 * runs in UTC and the user very likely doesn't, so a server-rendered grid would
 * put posts on the wrong day for anyone west of Greenwich in the evening.
 *
 * Drag-and-drop follows the production board's rule: it is an ENHANCEMENT, never
 * the only path. Every chip also carries a date input, so keyboard and touch
 * users can reschedule without dragging.
 *
 * Free QUEUE SLOTS are drawn as dashed ghost chips. Their instants are computed
 * on the server (only it knows the workspace's posting timezone) and arrive as
 * ISO strings, which the browser then buckets by LOCAL day exactly like posts —
 * so resolution happens where the timezone lives and display happens where the
 * viewer lives. Dropping onto a ghost takes that slot's exact time; the
 * always-available path to the same result is the "Queue" button on a draft.
 */

export type CalendarPost = {
  id: string;
  text: string;
  scheduledAt: string | null; // ISO; null = draft (lives in the tray)
  providers: string[];
  status: string;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Local YYYY-MM-DD — the key everything is bucketed by. */
function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local wall clock as a `datetime-local` value. */
function localInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Monday-first offset for a month's first cell. */
function leadingBlanks(first: Date): number {
  return (first.getDay() + 6) % 7;
}

/** Bucket key for one day+hour cell of the week grid. */
function cellKey(d: Date): string {
  return `${dayKey(d)}#${d.getHours()}`;
}

/** Local midnight on the Monday of `d`'s week. */
function startOfWeek(d: Date): Date {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  return s;
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

/**
 * A clock reading in the VIEWER's locale — 12- or 24-hour as they prefer.
 * Everything in the grid goes through this: the hour gutter, chips, ghost slots
 * and the drop hint. Hard-coding 24h here put "15:00" in the gutter next to a
 * "03:00 PM" chip in the same cell.
 */
function timeLabel(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** The gutter reading for an hour row, on an arbitrary (DST-free) day. */
function hourLabel(hour: number, minute = 0): string {
  return timeLabel(new Date(2000, 0, 1, hour, minute));
}

/**
 * "20 Jul – 26 Jul 2026". The month is repeated on both sides on purpose:
 * dropping it when the week doesn't span a month boundary reads fine in
 * day-first locales but produces "20 – Jul 26, 2026" in month-first ones.
 */
function weekRangeLabel(start: Date): string {
  const end = addDays(start, 6);
  return `${start.toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ` +
    `${end.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}

/** One step forward or back, in whichever unit the current view is measured in. */
function stepCursor(cursor: Date, mode: Mode, delta: number): Date {
  return mode === "month"
    ? new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1)
    : addDays(cursor, 7 * delta);
}

/** Bucket a sorted ISO list by whatever key the caller derives from its date. */
function groupIso(isos: string[], keyOf: (d: Date) => string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const iso of isos) {
    const k = keyOf(new Date(iso));
    map.set(k, [...(map.get(k) ?? []), iso]);
  }
  return map;
}

/** Hours the week grid opens on before content widens it. */
const DEFAULT_FIRST_HOUR = 7;
const DEFAULT_LAST_HOUR = 20;

/** Time gutter + seven day columns. The gutter fits a 12-hour "12:00 AM". */
const WEEK_COLUMNS = "4.5rem repeat(7, minmax(0, 1fr))";

/**
 * An empty queue slot. Drop a post on it to take that EXACT time — the day cell
 * underneath would only give the post's existing time (or 09:00 for a draft).
 *
 * Declared at module scope, not inside SocialCalendar: it holds hook state, and
 * a component defined in the parent's body is a fresh type on every parent
 * render, so React would unmount it and drop that state mid-drag.
 */
function GhostSlot({ iso, onTake }: { iso: string; onTake: (at: Date) => void }) {
  const [over, setOver] = useState(false);
  const at = new Date(iso);
  const time = timeLabel(at);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        // Stop the day cell handling this too and overwriting the exact time.
        e.stopPropagation();
        setOver(false);
        onTake(at);
      }}
      className="rounded-md px-1.5 py-0.5 text-[9px] font-mono border border-dashed flex items-center gap-1"
      style={{
        borderColor: over ? "var(--accent)" : "var(--line-2)",
        background: over ? "var(--accent-soft)" : "transparent",
        color: "var(--mute)",
      }}
      title={`Free queue slot — drop a post here to take ${time}`}
    >
      <span className="w-1.5 h-1.5 rounded-full border border-dashed shrink-0" style={{ borderColor: "var(--mute)" }} />
      {time}
    </div>
  );
}

type Mode = "month" | "week";
/** Which half-hour of a week cell the pointer is over. */
type CellTarget = { key: string; half: 0 | 30 };

export function SocialCalendar({ posts, freeSlots = [] }: { posts: CalendarPost[]; freeSlots?: string[] }) {
  // `cursor` is a plain anchor date: month view reads its month, week view reads
  // the Monday-start week containing it. One piece of state, two framings.
  const [cursor, setCursor] = useState(() => new Date());
  const [mode, setMode] = useState<Mode>("month");
  const [allHours, setAllHours] = useState(false);
  const [items, setItems] = useState(posts);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const [overCell, setOverCell] = useState<CellTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const scheduled = items.filter((p) => p.scheduledAt);
  const drafts = items.filter((p) => !p.scheduledAt);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarPost[]>();
    for (const p of scheduled) {
      const k = dayKey(new Date(p.scheduledAt!));
      const list = map.get(k) ?? [];
      list.push(p);
      map.set(k, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime());
    }
    return map;
  }, [scheduled]);

  /** Posts bucketed by day+hour — the week grid's cells. */
  const byCell = useMemo(() => {
    const map = new Map<string, CalendarPost[]>();
    for (const p of scheduled) {
      const k = cellKey(new Date(p.scheduledAt!));
      map.set(k, [...(map.get(k) ?? []), p]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime());
    }
    return map;
  }, [scheduled]);

  /**
   * Free slots still worth offering. A slot that something has since been moved
   * into (optimistically, this session) drops out — otherwise the grid would
   * show a free slot and an occupying post in the same minute.
   */
  const freeAvailable = useMemo(() => {
    const claimed = new Set(
      items.filter((p) => p.scheduledAt).map((p) => Math.floor(new Date(p.scheduledAt!).getTime() / 60_000)),
    );
    return freeSlots.filter((iso) => !claimed.has(Math.floor(new Date(iso).getTime() / 60_000))).sort();
  }, [freeSlots, items]);

  const freeByDay = useMemo(() => groupIso(freeAvailable, (d) => dayKey(d)), [freeAvailable]);
  const freeByCell = useMemo(() => groupIso(freeAvailable, (d) => cellKey(d)), [freeAvailable]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const blanks = leadingBlanks(new Date(year, month, 1));
  const todayKey = dayKey(new Date());

  const weekStart = useMemo(() => startOfWeek(cursor), [cursor]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  /**
   * The hours the week grid shows. Opens on a working day and WIDENS to fit
   * whatever is actually scheduled — an 06:00 post must never be hidden by the
   * default window. "All 24h" overrides it for scheduling into the quiet hours.
   */
  const [firstHour, lastHour] = useMemo(() => {
    if (allHours) return [0, 23];
    let lo = DEFAULT_FIRST_HOUR;
    let hi = DEFAULT_LAST_HOUR;
    const weekEnd = addDays(weekStart, 7).getTime();
    const widen = (d: Date) => {
      if (d.getTime() < weekStart.getTime() || d.getTime() >= weekEnd) return;
      lo = Math.min(lo, d.getHours());
      hi = Math.max(hi, d.getHours());
    };
    for (const p of scheduled) widen(new Date(p.scheduledAt!));
    for (const iso of freeAvailable) widen(new Date(iso));
    return [lo, hi];
  }, [allHours, weekStart, scheduled, freeAvailable]);

  /** Commit a post to an exact instant, optimistically, with server confirmation. */
  const commit = (id: string, target: Date) => {
    const post = items.find((p) => p.id === id);
    if (!post) return;
    if (target.getTime() < Date.now() - 60_000) {
      setError("That time has already passed — pick a future one.");
      return;
    }
    setError(null);
    const iso = target.toISOString();
    // Optimistic: the grid moves immediately, the server confirms.
    setItems((list) => list.map((p) => (p.id === id ? { ...p, scheduledAt: iso, status: "scheduled" } : p)));
    startTransition(() => {
      void rescheduleSocialPostAction(id, iso).then((res) => {
        if (res && !res.ok) {
          setError(res.message);
          // Put it back where it was rather than leave a lie on screen.
          setItems((list) => list.map((p) => (p.id === id ? { ...p, scheduledAt: post.scheduledAt, status: post.status } : p)));
        }
      });
    });
  };

  /** Move a post to `key` (YYYY-MM-DD), preserving its time of day. */
  const moveTo = (id: string, key: string) => {
    const post = items.find((p) => p.id === id);
    if (!post) return;
    const [y, m, d] = key.split("-").map(Number);
    const existing = post.scheduledAt ? new Date(post.scheduledAt) : null;
    // A draft has no time yet — 09:00 local is a sane, obvious default.
    commit(id, new Date(y, m - 1, d, existing ? existing.getHours() : 9, existing ? existing.getMinutes() : 0, 0, 0));
  };

  /** Move a post to an exact local wall clock — the week grid's typed path. */
  const moveToDateTime = (id: string, value: string) => {
    // `datetime-local` has no zone, so `new Date(value)` reads it as local — which
    // is exactly right here: the viewer typed their own clock.
    const at = new Date(value);
    if (!Number.isNaN(at.getTime())) commit(id, at);
  };

  /**
   * Which half hour of a week cell the pointer sits in. Snapping to :00/:30
   * matches how calendars behave and keeps a drop predictable; the exact-minute
   * path is dropping onto a ghost slot, or typing into the chip's own control.
   */
  const halfFor = (e: React.DragEvent<HTMLElement>): 0 | 30 => {
    const r = e.currentTarget.getBoundingClientRect();
    return r.height > 0 && (e.clientY - r.top) / r.height >= 0.5 ? 30 : 0;
  };

  /**
   * `control` is the ALWAYS-AVAILABLE path, not a decoration — DnD stays an
   * enhancement (the TaskBoard rule). Month and the drafts tray only need a day,
   * so they get a date input; the week grid is about time, so it gets a
   * datetime-local — otherwise week view would add a capability that keyboard
   * and touch users couldn't reach.
   */
  const Chip = ({ p, control = "date" }: { p: CalendarPost; control?: "date" | "datetime" }) => {
    const time = p.scheduledAt ? timeLabel(new Date(p.scheduledAt)) : null;
    return (
      <div
        draggable
        onDragStart={() => setDragId(p.id)}
        onDragEnd={() => setDragId(null)}
        className="rounded-md px-1.5 py-1 text-[10px] leading-tight cursor-grab active:cursor-grabbing border"
        style={{
          background: "var(--panel)",
          borderColor: dragId === p.id ? "var(--accent)" : "var(--line)",
          opacity: dragId === p.id ? 0.5 : 1,
        }}
        title={p.text || "(image only)"}
      >
        <div className="flex items-center gap-1">
          {p.providers.map((prov) => (
            <span key={prov} className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: networkFor(prov)?.color ?? "var(--mute)" }} />
          ))}
          {time && <span className="font-mono text-[9px] text-[var(--mute)]">{time}</span>}
          <Link href={`/social/${p.id}/edit`} className="ml-auto text-[var(--mute)] hover:text-[var(--accent)]" title="Edit">
            <Pencil className="w-2.5 h-2.5" />
          </Link>
        </div>
        <div className="truncate">{p.text || <span className="italic text-[var(--mute)]">image only</span>}</div>
        {/* Accessible path: DnD is an enhancement, this always works. */}
        {control === "datetime" ? (
          <input
            type="datetime-local"
            aria-label={`Reschedule "${(p.text || "post").slice(0, 40)}"`}
            value={p.scheduledAt ? localInput(new Date(p.scheduledAt)) : ""}
            onChange={(e) => e.target.value && moveToDateTime(p.id, e.target.value)}
            className="w-full mt-1 text-[9px] font-mono border border-[var(--line-2)] rounded px-1 py-0.5"
          />
        ) : (
          <input
            type="date"
            aria-label={`Reschedule "${(p.text || "post").slice(0, 40)}"`}
            value={p.scheduledAt ? dayKey(new Date(p.scheduledAt)) : ""}
            onChange={(e) => e.target.value && moveTo(p.id, e.target.value)}
            className="w-full mt-1 text-[9px] font-mono border border-[var(--line-2)] rounded px-1 py-0.5"
          />
        )}
      </div>
    );
  };

  return (
    <div className="mb-6" data-elsie="social-calendar">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <CalendarClock className="w-4 h-4" style={{ color: "var(--blue-on)" }} />
        <h2 className="font-mono font-bold text-sm">
          {mode === "month"
            ? cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
            : weekRangeLabel(weekStart)}
        </h2>
        <span className="flex-1" />
        {/* Client-side, not a route change: switching framing shouldn't cost a
            round trip or lose an in-flight optimistic move. */}
        <div className="flex gap-1">
          <button type="button" className={`btn sm ${mode === "month" ? "primary" : ""}`} onClick={() => setMode("month")}>Month</button>
          <button type="button" className={`btn sm ${mode === "week" ? "primary" : ""}`} onClick={() => setMode("week")}>Week</button>
        </div>
        {mode === "week" && (
          <button type="button" className="btn sm" onClick={() => setAllHours((v) => !v)}
            title={allHours ? "Show only the hours in use" : "Show all 24 hours"}>
            {allHours ? "Busy hours" : "All 24h"}
          </button>
        )}
        <button type="button" className="btn sm" onClick={() => setCursor(stepCursor(cursor, mode, -1))}
          aria-label={mode === "month" ? "Previous month" : "Previous week"}>
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <button type="button" className="btn sm" onClick={() => setCursor(new Date())}>Today</button>
        <button type="button" className="btn sm" onClick={() => setCursor(stepCursor(cursor, mode, 1))}
          aria-label={mode === "month" ? "Next month" : "Next week"}>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {error && (
        <p className="text-xs mb-2 px-2.5 py-1.5 rounded-lg" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>
          {error}
        </p>
      )}

      {mode === "month" && (
      <div className="card !p-2">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAYS.map((d) => (
            <div key={d} className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] text-center py-1">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: blanks }).map((_, i) => <div key={`b${i}`} />)}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const key = dayKey(new Date(year, month, day));
            const dayPosts = byDay.get(key) ?? [];
            const isToday = key === todayKey;
            const isOver = overDay === key;
            const isPast = new Date(year, month, day, 23, 59, 59).getTime() < Date.now();
            return (
              <div
                key={key}
                onDragOver={(e) => { e.preventDefault(); setOverDay(key); }}
                onDragLeave={() => setOverDay((k) => (k === key ? null : k))}
                onDrop={(e) => { e.preventDefault(); setOverDay(null); if (dragId) moveTo(dragId, key); setDragId(null); }}
                className="min-h-20 rounded-lg border p-1 flex flex-col gap-1"
                style={{
                  borderColor: isOver ? "var(--accent)" : isToday ? "var(--blue)" : "var(--line)",
                  background: isOver ? "var(--accent-soft)" : isPast ? "var(--zebra)" : "transparent",
                }}
              >
                <span className={`font-mono text-[10px] ${isToday ? "font-bold" : "text-[var(--mute)]"}`}>{day}</span>
                {dayPosts.map((p) => <Chip key={p.id} p={p} />)}
                {(freeByDay.get(key) ?? []).map((iso) => (
                  <GhostSlot
                    key={iso}
                    iso={iso}
                    onTake={(at) => {
                      setOverDay(null);
                      if (dragId) commit(dragId, at);
                      setDragId(null);
                    }}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
      )}

      {mode === "week" && (
        // Seven columns plus a time gutter won't compress onto a phone, so the
        // grid keeps its width and scrolls horizontally — the same call the week
        // ribbon already makes. The page body must never scroll sideways.
        <div className="card !p-2 overflow-x-auto">
          <div style={{ minWidth: "62rem" }}>
            {/* Day headers */}
            <div className="grid gap-1 mb-1" style={{ gridTemplateColumns: WEEK_COLUMNS }}>
              <div />
              {weekDays.map((d) => {
                const isToday = dayKey(d) === todayKey;
                return (
                  <div key={dayKey(d)} className="text-center py-1 rounded-md"
                    style={{ background: isToday ? "var(--blue-soft)" : "transparent" }}>
                    <div className="text-[10px] font-mono uppercase tracking-wider" style={{ color: isToday ? "var(--blue-on)" : "var(--mute)" }}>
                      {WEEKDAYS[(d.getDay() + 6) % 7]}
                    </div>
                    <div className={`font-mono text-[11px] ${isToday ? "font-bold" : "text-[var(--mute)]"}`}>
                      {d.getDate()}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Hour rows */}
            <div className="grid gap-1" style={{ gridTemplateColumns: WEEK_COLUMNS }}>
              {Array.from({ length: lastHour - firstHour + 1 }, (_, i) => firstHour + i).flatMap((hour) => [
                <div key={`h${hour}`} className="font-mono text-[10px] text-[var(--mute)] text-right pr-1 pt-0.5">
                  {hourLabel(hour)}
                </div>,
                ...weekDays.map((d) => {
                  const key = `${dayKey(d)}#${hour}`;
                  const cellPosts = byCell.get(key) ?? [];
                  const cellFree = freeByCell.get(key) ?? [];
                  const over = overCell?.key === key ? overCell : null;
                  // The whole hour is gone, so a drop here could only be a mistake.
                  const isPast = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour + 1).getTime() <= Date.now();
                  return (
                    <div
                      key={key}
                      onDragOver={(e) => { e.preventDefault(); if (!isPast) setOverCell({ key, half: halfFor(e) }); }}
                      onDragLeave={() => setOverCell((c) => (c?.key === key ? null : c))}
                      onDrop={(e) => {
                        e.preventDefault();
                        const half = halfFor(e);
                        setOverCell(null);
                        if (dragId) commit(dragId, new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, half));
                        setDragId(null);
                      }}
                      className="min-h-11 rounded-md border p-0.5 flex flex-col gap-0.5"
                      style={{
                        borderColor: over ? "var(--accent)" : "var(--line)",
                        background: over ? "var(--accent-soft)" : isPast ? "var(--zebra)" : "transparent",
                      }}
                    >
                      {/* Say where the drop will actually land, since it snaps. */}
                      {over && (
                        <span className="font-mono text-[9px] self-end" style={{ color: "var(--accent-on)" }}>
                          {hourLabel(hour, over.half)}
                        </span>
                      )}
                      {cellPosts.map((p) => <Chip key={p.id} p={p} control="datetime" />)}
                      {cellFree.map((iso) => (
                        <GhostSlot key={iso} iso={iso} onTake={(at) => { setOverCell(null); if (dragId) commit(dragId, at); setDragId(null); }} />
                      ))}
                    </div>
                  );
                }),
              ])}
            </div>
          </div>
          {!allHours && (firstHour > 0 || lastHour < 23) && (
            <p className="text-[10px] text-[var(--mute)] mt-1.5">
              Showing {hourLabel(firstHour)}–{hourLabel(lastHour)}. Nothing is hidden — the window widens to fit
              whatever is scheduled. Use <b>All 24h</b> to schedule outside it.
            </p>
          )}
        </div>
      )}

      {/* Drafts tray — drag one onto a day to schedule it. */}
      {drafts.length > 0 && (
        <div className="card mt-3">
          <h3 className="font-mono text-[11px] font-bold mb-1.5">
            Unscheduled drafts{" "}
            <span className="text-[var(--mute)] font-normal">
              {mode === "week"
                ? "— drag onto an hour to schedule it there (snaps to the half hour), or onto a free slot for its exact time"
                : "— drag onto a free slot to take that time, or onto a day (09:00 by default)"}
            </span>
          </h3>
          <div className="grid grid-cols-2 @2xl:grid-cols-4 @5xl:grid-cols-6 gap-2">
            {drafts.map((p) => <Chip key={p.id} p={p} />)}
          </div>
        </div>
      )}
    </div>
  );
}
