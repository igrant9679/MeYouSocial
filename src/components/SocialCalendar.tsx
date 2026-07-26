"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Pencil, CalendarClock } from "lucide-react";
import { rescheduleSocialPostAction } from "@/app/actions/social";
import { networkFor } from "@/lib/social/networks";

/**
 * Month calendar for the scheduling queue — the view the original scheduler
 * deferred in favour of the agenda.
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

/** Monday-first offset for a month's first cell. */
function leadingBlanks(first: Date): number {
  return (first.getDay() + 6) % 7;
}

export function SocialCalendar({ posts, freeSlots = [] }: { posts: CalendarPost[]; freeSlots?: string[] }) {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [items, setItems] = useState(posts);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
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

  /**
   * Free slots bucketed by local day. A slot that something has since been
   * moved into (optimistically, this session) stops being offered — otherwise
   * the grid would show a free slot and an occupying post in the same minute.
   */
  const freeByDay = useMemo(() => {
    const claimed = new Set(
      items.filter((p) => p.scheduledAt).map((p) => Math.floor(new Date(p.scheduledAt!).getTime() / 60_000)),
    );
    const map = new Map<string, string[]>();
    for (const iso of freeSlots) {
      const at = new Date(iso);
      if (claimed.has(Math.floor(at.getTime() / 60_000))) continue;
      const k = dayKey(at);
      map.set(k, [...(map.get(k) ?? []), iso]);
    }
    for (const list of map.values()) list.sort();
    return map;
  }, [freeSlots, items]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const blanks = leadingBlanks(new Date(year, month, 1));
  const todayKey = dayKey(new Date());

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

  /**
   * An empty queue slot. Drop a post on it to take that exact time — the day
   * cell underneath would only give the post's existing time (or 09:00).
   */
  const GhostSlot = ({ iso }: { iso: string }) => {
    const [over, setOver] = useState(false);
    const at = new Date(iso);
    return (
      <div
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          // Stop the day cell from also handling this and overwriting the time.
          e.stopPropagation();
          setOver(false);
          setOverDay(null);
          if (dragId) commit(dragId, at);
          setDragId(null);
        }}
        className="rounded-md px-1.5 py-0.5 text-[9px] font-mono border border-dashed flex items-center gap-1"
        style={{
          borderColor: over ? "var(--accent)" : "var(--line-2)",
          background: over ? "var(--accent-soft)" : "transparent",
          color: "var(--mute)",
        }}
        title={`Free queue slot — drop a post here to take ${at.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit" })}`}
      >
        <span className="w-1.5 h-1.5 rounded-full border border-dashed shrink-0" style={{ borderColor: "var(--mute)" }} />
        {at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
      </div>
    );
  };

  const Chip = ({ p }: { p: CalendarPost }) => {
    const time = p.scheduledAt
      ? new Date(p.scheduledAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      : null;
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
        <input
          type="date"
          aria-label={`Reschedule "${(p.text || "post").slice(0, 40)}"`}
          value={p.scheduledAt ? dayKey(new Date(p.scheduledAt)) : ""}
          onChange={(e) => e.target.value && moveTo(p.id, e.target.value)}
          className="w-full mt-1 text-[9px] font-mono border border-[var(--line-2)] rounded px-1 py-0.5"
        />
      </div>
    );
  };

  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <CalendarClock className="w-4 h-4" style={{ color: "var(--blue-on)" }} />
        <h2 className="font-mono font-bold text-sm">
          {cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </h2>
        <span className="flex-1" />
        <button type="button" className="btn sm" onClick={() => setCursor(new Date(year, month - 1, 1))} aria-label="Previous month">
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <button type="button" className="btn sm" onClick={() => setCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
          Today
        </button>
        <button type="button" className="btn sm" onClick={() => setCursor(new Date(year, month + 1, 1))} aria-label="Next month">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {error && (
        <p className="text-xs mb-2 px-2.5 py-1.5 rounded-lg" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>
          {error}
        </p>
      )}

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
                  <GhostSlot key={iso} iso={iso} />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Drafts tray — drag one onto a day to schedule it. */}
      {drafts.length > 0 && (
        <div className="card mt-3">
          <h3 className="font-mono text-[11px] font-bold mb-1.5">
            Unscheduled drafts{" "}
            <span className="text-[var(--mute)] font-normal">
              — drag onto a free slot to take that time, or onto a day (09:00 by default)
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
