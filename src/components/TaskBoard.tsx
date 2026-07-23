"use client";

import { useState, useTransition } from "react";
import { moveTaskAction } from "@/app/actions/production";

/**
 * Drag-and-drop task kanban. Native HTML5 DnD (no library): drag a card onto a
 * column, the move is optimistic and the server action confirms it. Every card
 * also carries a fallback <select> so keyboard and touch users can move tasks
 * without dragging — DnD is an enhancement, never the only path.
 */

export type BoardTask = {
  id: string;
  title: string;
  assignee: string | null;
  due: string | null;
  overdue: boolean;
  aging: boolean; // untouched for 3+ days while not done
  status: string;
  project: string | null;
};

const COLUMNS = [
  { key: "todo", label: "To do", hue: "amber" },
  { key: "in_progress", label: "In progress", hue: "blue" },
  { key: "done", label: "Done", hue: "green" },
] as const;

export function TaskBoard({ tasks: initial, wipLimit }: { tasks: BoardTask[]; wipLimit: number }) {
  const [tasks, setTasks] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const move = (id: string, status: string) => {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, status } : t)));
    startTransition(() => {
      void moveTaskAction(id, status);
    });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {COLUMNS.map((col) => {
        const items = tasks.filter((t) => t.status === col.key);
        const overWip = col.key === "in_progress" && items.length > wipLimit;
        return (
          <section
            key={col.key}
            onDragOver={(e) => {
              e.preventDefault();
              setOverCol(col.key);
            }}
            onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain") || dragId;
              if (id) move(id, col.key);
              setDragId(null);
              setOverCol(null);
            }}
            className="rounded-xl border p-2 min-h-[200px] transition-colors"
            style={{
              borderColor: overCol === col.key ? `var(--${col.hue})` : "var(--line)",
              background: overCol === col.key ? `var(--${col.hue}-soft)` : "var(--zebra)",
            }}
            aria-label={`${col.label} column`}
          >
            <h3
              className="flex items-center justify-between text-[11px] font-mono font-bold uppercase tracking-wider mb-2 px-1"
              style={{ color: `var(--${col.hue}-on)` }}
            >
              <span>
                {col.label} · {items.length}
                {col.key === "in_progress" && (
                  <span
                    className="ml-2 font-mono text-[9px] px-1.5 py-0.5 rounded-full normal-case"
                    style={overWip ? { background: "var(--rose-soft)", color: "var(--rose-on)" } : { background: "var(--panel)", color: "var(--mute)" }}
                  >
                    WIP {items.length}/{wipLimit}{overWip ? " over!" : ""}
                  </span>
                )}
              </span>
            </h3>
            <div className="flex flex-col gap-2">
              {items.map((t) => (
                <div
                  key={t.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", t.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragId(t.id);
                  }}
                  onDragEnd={() => setDragId(null)}
                  className="card !p-2.5 cursor-grab active:cursor-grabbing lift"
                  style={{
                    opacity: dragId === t.id ? 0.5 : 1,
                    borderLeft: t.aging && t.status !== "done" ? "3px solid var(--amber)" : undefined,
                  }}
                >
                  <div className="text-[12.5px] font-semibold leading-snug mb-1">{t.title}</div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {t.assignee && (
                      <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "var(--blue-soft)", color: "var(--blue-on)" }}>
                        @{t.assignee}
                      </span>
                    )}
                    {t.due && (
                      <span
                        className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                        style={t.overdue ? { background: "var(--rose-soft)", color: "var(--rose-on)" } : { background: "var(--panel)", color: "var(--mute)" }}
                      >
                        {t.due}{t.overdue ? " ⚠" : ""}
                      </span>
                    )}
                    {t.aging && t.status !== "done" && (
                      <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
                        stale
                      </span>
                    )}
                    {t.project && <span className="text-[9.5px] text-[var(--mute)] truncate">{t.project}</span>}
                    <span className="flex-1" />
                    <label className="sr-only" htmlFor={`mv-${t.id}`}>Move task</label>
                    <select
                      id={`mv-${t.id}`}
                      value={t.status}
                      onChange={(e) => move(t.id, e.target.value)}
                      className="text-[9.5px] !p-0.5 rounded border border-[var(--line)] bg-transparent"
                    >
                      {COLUMNS.map((c) => (
                        <option key={c.key} value={c.key}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
              {items.length === 0 && (
                <div className="text-center text-[11px] text-[var(--mute)] py-6 rounded-lg border border-dashed border-[var(--line)]">
                  Drop tasks here
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
