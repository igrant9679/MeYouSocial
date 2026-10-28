"use client";

import { useState, useTransition } from "react";
import { DeleteButton } from "@/components/DeleteButton";
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

// The page keys this board on the tasks it was given, so a task added (or moved
// elsewhere) on the server shows without a reload (VID-16).
export function TaskBoard({ tasks: initial, wipLimit }: { tasks: BoardTask[]; wipLimit: number }) {
  const [tasks, setTasks] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Optimistic, then confirmed: a move the server refuses (or that fails) goes
  // back where it was and says so, instead of looking done.
  const move = (id: string, status: string) => {
    const before = tasks.find((t) => t.id === id)?.status;
    if (!before || before === status) return;
    setError(null);
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, status } : t)));
    startTransition(async () => {
      const ok = await moveTaskAction(id, status).then((r) => r?.ok === true, () => false);
      if (!ok) {
        setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, status: before } : t)));
        setError("That move didn't save — the task is back where it was. Reload if it keeps happening.");
      }
    });
  };

  return (
    // 3 columns only when each gets ≥~215px of real width (container query =
    // zoom-aware) — md: viewport used to force 3×150px columns beside the rail.
    <div className="grid grid-cols-1 @2xl:grid-cols-3 gap-3">
      {error && (
        <p role="alert" className="@2xl:col-span-3 text-xs px-3 py-2 rounded-lg" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>{error}</p>
      )}
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
                    {/* draggable={false} on the wrapper: without it, grabbing
                        the delete control starts a card drag instead. */}
                    <span draggable={false} onDragStart={(e) => e.preventDefault()}>
                      <DeleteButton kind="task" id={t.id} name={t.title} returnTo="/production/tasks" iconOnly className="btn !px-1 !py-0.5" />
                    </span>
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
