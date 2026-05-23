import Link from "next/link";
import { CheckSquare, Square, Circle, Plus } from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { createTaskAction, setTaskStatusAction } from "@/app/actions/production";

// FR-TASK-01 — Tasks with assignee, due date, status, optional project link; per-user task list.

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ mine?: string }> }) {
  const { workspace, user } = await requireMembership();
  const { mine } = await searchParams;
  const where = {
    workspaceId: workspace.id,
    ...(mine === "1" ? { assigneeId: user.id } : {}),
  };

  const [tasks, members, projects] = await Promise.all([
    db.task.findMany({
      where,
      include: { assignee: { select: { email: true, name: true } }, contentProject: { select: { id: true, title: true } } },
      orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }],
    }),
    db.membership.findMany({ where: { workspaceId: workspace.id, status: "active" }, include: { user: { select: { id: true, email: true, name: true } } } }),
    db.contentProject.findMany({ where: { channel: { workspaceId: workspace.id } }, select: { id: true, title: true }, orderBy: { updatedAt: "desc" }, take: 50 }),
  ]);

  const buckets = {
    todo: tasks.filter((t) => t.status === "todo"),
    in_progress: tasks.filter((t) => t.status === "in_progress"),
    done: tasks.filter((t) => t.status === "done"),
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="font-mono font-bold text-lg">Tasks</h2>
        <span className="text-xs text-[var(--mute)]">({tasks.length})</span>
        <span className="flex-1" />
        <Link href={mine === "1" ? "/production/tasks" : "/production/tasks?mine=1"} className="btn sm">{mine === "1" ? "All" : "My tasks"}</Link>
      </div>

      {/* New-task form */}
      <form action={createTaskAction} className="card flex flex-wrap items-end gap-2 mb-5">
        <label className="flex-1 min-w-[220px] flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">New task</span>
          <input name="title" required placeholder="Title" className="border border-[var(--line-2)] rounded-lg p-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Assignee</span>
          <select name="assigneeId" className="border border-[var(--line-2)] rounded-lg p-2 text-sm">
            <option value="">Unassigned</option>
            {members.map((m) => (<option key={m.user.id} value={m.user.id}>{m.user.name ?? m.user.email}</option>))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Due</span>
          <input type="date" name="dueDate" className="border border-[var(--line-2)] rounded-lg p-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Project (optional)</span>
          <select name="contentProjectId" className="border border-[var(--line-2)] rounded-lg p-2 text-sm">
            <option value="">—</option>
            {projects.map((p) => (<option key={p.id} value={p.id}>{p.title}</option>))}
          </select>
        </label>
        <button type="submit" className="btn primary flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add</button>
      </form>

      {/* Buckets */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {(["todo", "in_progress", "done"] as const).map((b) => (
          <section key={b} className="card">
            <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--mute)] mb-2">{b.replace("_", " ")} ({buckets[b].length})</h3>
            <ul className="m-0 p-0 flex flex-col gap-2">
              {buckets[b].map((t) => {
                const overdue = t.dueDate && t.dueDate.getTime() < Date.now() && t.status !== "done";
                return (
                  <li key={t.id} className="border border-[var(--line)] rounded-lg p-2.5">
                    <div className="flex items-start gap-2">
                      <form action={setTaskStatusAction} className="mt-0.5">
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="status" value={t.status === "done" ? "todo" : t.status === "in_progress" ? "done" : "in_progress"} />
                        <button type="submit" title="Advance status">
                          {t.status === "done" ? <CheckSquare className="w-4 h-4" style={{ color: "var(--green)" }} /> : t.status === "in_progress" ? <Circle className="w-4 h-4" style={{ color: "var(--amber)" }} /> : <Square className="w-4 h-4 text-[var(--mute)]" />}
                        </button>
                      </form>
                      <div className="flex-1 min-w-0">
                        <div className={"text-sm font-semibold " + (t.status === "done" ? "line-through text-[var(--mute)]" : "")}>{t.title}</div>
                        <div className="text-[11px] text-[var(--mute)] flex items-center gap-1.5 flex-wrap">
                          {t.assignee && <span className="font-mono">{t.assignee.name ?? t.assignee.email}</span>}
                          {t.dueDate && <span className={overdue ? "text-[var(--brand)] font-semibold" : ""}>· due {new Date(t.dueDate).toLocaleDateString()}</span>}
                          {t.contentProject && <span>· <Link href={`/production?focus=${t.contentProject.id}`} className="hover:text-[var(--accent)]">{t.contentProject.title}</Link></span>}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
              {buckets[b].length === 0 && <li className="text-[11px] text-[var(--mute)] py-2 text-center">—</li>}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
