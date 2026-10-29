"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { rescheduleArticleAction } from "@/app/actions/article-calendar";

/**
 * The articles' publishing calendar (E-ART-07). The month is laid out on the
 * SERVER in the posting timezone — each cell's `key` is that zone's day — so a
 * drop sends a day and the server keeps the article's time of day there; the
 * browser does no zone maths. Drag is an enhancement: every movable chip also
 * has a date field and an unschedule button. Only admins move anything (the
 * same rule as the editor's Schedule).
 */

export type CalendarCell = { key: string; day: number; past: boolean; today: boolean; publishDay: boolean };
export type CalendarArticle = {
  id: string;
  title: string;
  /** YYYY-MM-DD in the posting zone; null = waiting at final approval with no time. */
  day: string | null;
  time: string | null;
  kind: "published" | "scheduled" | "ready";
  /** Why it won't publish when it falls due — failing checks, no website. */
  problems: string[];
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Chip({ a, movable, onDragStart, onDragEnd, onMove }: {
  a: CalendarArticle; movable: boolean;
  onDragStart: () => void; onDragEnd: () => void; onMove: (day: string | null) => void;
}) {
  const hue = a.kind === "published" ? "green" : a.kind === "scheduled" ? "blue" : "amber";
  return (
    <div
      draggable={movable}
      onDragStart={movable ? onDragStart : undefined}
      onDragEnd={onDragEnd}
      className={`rounded-md px-1.5 py-1 text-[10px] leading-tight border ${movable ? "cursor-grab active:cursor-grabbing" : ""}`}
      style={{ background: "var(--panel)", borderColor: a.problems.length ? "var(--rose)" : `var(--${hue})` }}
      title={a.title}
    >
      <div className="flex items-center gap-1">
        {a.time && <span className="font-mono text-[9px] text-[var(--mute)]">{a.time}</span>}
        <span className="font-mono text-[9px] uppercase" style={{ color: `var(--${hue}-on)` }}>{a.kind === "ready" ? "no time yet" : a.kind}</span>
        {movable && a.kind === "scheduled" && (
          <button type="button" onClick={() => onMove(null)} className="ml-auto text-[var(--mute)] hover:text-[var(--rose-on)]" title="Take it off the calendar — it waits at final approval" aria-label={`Unschedule “${a.title}”`}>
            <X className="w-2.5 h-2.5" />
          </button>
        )}
      </div>
      <Link href={`/blog/${a.id}`} className="block truncate hover:underline">{a.title}</Link>
      {a.problems.map((p) => <div key={p} className="text-[9px] leading-snug" style={{ color: "var(--rose-on)" }}>can&apos;t publish: {p}</div>)}
      {movable && (
        <input type="date" value={a.day ?? ""} onChange={(e) => e.target.value && onMove(e.target.value)}
          aria-label={`Schedule “${a.title.slice(0, 40)}” for a day`} className="w-full mt-1 text-[9px] font-mono border border-[var(--line-2)] rounded px-1 py-0.5" />
      )}
    </div>
  );
}

export function ArticleCalendar({ cells, blanks, articles: initial, canSchedule }: {
  cells: CalendarCell[]; blanks: number; articles: CalendarArticle[]; canSchedule: boolean;
}) {
  const [articles, setArticles] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [, startTransition] = useTransition();

  const move = (id: string, day: string | null) => {
    const before = articles.find((a) => a.id === id);
    if (!before || before.kind === "published") return;
    setArticles((list) => list.map((a) => (a.id === id ? { ...a, day, kind: day ? "scheduled" : "ready", time: day ? a.time ?? "09:00" : null } : a)));
    startTransition(() => {
      void rescheduleArticleAction(id, day).then((res) => {
        setMsg({ ok: res.ok, text: res.message });
        if (!res.ok) setArticles((list) => list.map((a) => (a.id === id ? before : a)));
      }).catch(() => {
        setMsg({ ok: false, text: "The server couldn't be reached — nothing moved." });
        setArticles((list) => list.map((a) => (a.id === id ? before : a)));
      });
    });
  };
  const movable = (a: CalendarArticle) => canSchedule && a.kind !== "published";
  const chip = (a: CalendarArticle) => (
    <Chip key={a.id} a={a} movable={movable(a)} onDragStart={() => setDragId(a.id)} onDragEnd={() => setDragId(null)} onMove={(day) => move(a.id, day)} />
  );
  const tray = articles.filter((a) => a.day === null);

  return (
    <div>
      {msg && (
        <p className="text-xs mb-2 px-2.5 py-1.5 rounded-lg" style={{ background: msg.ok ? "var(--green-soft)" : "var(--rose-soft)", color: msg.ok ? "var(--green-on)" : "var(--rose-on)" }}>{msg.text}</p>
      )}
      <div className="card !p-2 overflow-x-auto">
        <div style={{ minWidth: "44rem" }}>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAYS.map((d) => <div key={d} className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] text-center py-1">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: blanks }).map((_, i) => <div key={`b${i}`} />)}
            {cells.map((c) => {
              const here = articles.filter((a) => a.day === c.key);
              const isOver = over === c.key;
              return (
                <div
                  key={c.key}
                  data-day={c.key}
                  onDragOver={(e) => { if (!c.past && dragId) { e.preventDefault(); setOver(c.key); } }}
                  onDragLeave={() => setOver((k) => (k === c.key ? null : k))}
                  onDrop={(e) => { e.preventDefault(); setOver(null); if (dragId && !c.past) move(dragId, c.key); setDragId(null); }}
                  className="min-h-24 rounded-lg border p-1 flex flex-col gap-1"
                  style={{
                    borderColor: isOver ? "var(--accent)" : c.today ? "var(--blue)" : "var(--line)",
                    background: isOver ? "var(--accent-soft)" : c.past ? "var(--zebra)" : "transparent",
                  }}
                >
                  <div className="flex items-center gap-1">
                    <span className={`font-mono text-[10px] ${c.today ? "font-bold" : "text-[var(--mute)]"}`}>{c.day}</span>
                    {c.publishDay && <span className="font-mono text-[8px] uppercase tracking-wider px-1 rounded" style={{ background: "var(--cyan-soft)", color: "var(--cyan-on)" }} title="The workspace's publish day — the autopilot publishes gate-passing articles on it">publish day</span>}
                  </div>
                  {here.map(chip)}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div
        className="card mt-3"
        onDragOver={(e) => { if (dragId && articles.find((a) => a.id === dragId)?.kind === "scheduled") e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); if (dragId) move(dragId, null); setDragId(null); }}
      >
        <h3 className="font-mono text-[11px] font-bold mb-1.5">
          At final approval, no time yet{" "}
          <span className="text-[var(--mute)] font-normal">
            {canSchedule ? "— drag one onto a day to schedule it (09:00 unless it had a time), or drop a scheduled one here to take it off" : "— an admin schedules these"}
          </span>
        </h3>
        {tray.length === 0
          ? <p className="text-[11px] text-[var(--mute)] m-0">Nothing waiting without a time.</p>
          : <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{tray.map(chip)}</div>}
      </div>
    </div>
  );
}
