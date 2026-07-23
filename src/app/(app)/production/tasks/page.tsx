import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { Plus } from "lucide-react";
import { requireMembership, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { createTaskAction, saveAutoTaskRulesAction } from "@/app/actions/production";
import { TaskBoard } from "@/components/TaskBoard";
import { getAutoTaskRules } from "@/lib/auto-tasks";

// The production task board: drag-and-drop kanban with a WIP limit, aging
// flags, per-person capacity, and the auto-task rules that turn pipeline
// events into work items.

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ mine?: string }> }) {
  const { workspace, user, membership } = await requireMembership();
  const { mine } = await searchParams;
  const admin = canAdmin(membership.role);
  const where = {
    workspaceId: workspace.id,
    ...(mine === "1" ? { assigneeId: user.id } : {}),
  };

  const [tasks, members, projects, rules] = await Promise.all([
    db.task.findMany({
      where,
      include: { assignee: { select: { email: true, name: true } }, contentProject: { select: { id: true, title: true } } },
      orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }],
    }),
    db.membership.findMany({ where: { workspaceId: workspace.id, status: "active" }, include: { user: { select: { id: true, email: true, name: true } } } }),
    db.contentProject.findMany({ where: { channel: { workspaceId: workspace.id } }, select: { id: true, title: true }, orderBy: { updatedAt: "desc" }, take: 50 }),
    getAutoTaskRules(workspace.id),
  ]);

  // Open (not-done) tasks per assignee — the capacity strip.
  const open = tasks.filter((t) => t.status !== "done" && t.assignee);
  const byPerson = new Map<string, number>();
  for (const t of open) {
    const name = (t.assignee!.name ?? t.assignee!.email ?? "?").split(/[@\s]/)[0];
    byPerson.set(name, (byPerson.get(name) ?? 0) + 1);
  }
  const capacity = [...byPerson.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  const capacityMax = Math.max(1, ...capacity.map((c) => c.count));

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
        <SubmitButton className="btn primary flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add</SubmitButton>
      </form>

      {/* Drag-and-drop board (select fallback on every card for keyboard/touch) */}
      <TaskBoard
        wipLimit={rules.wipLimit}
        tasks={tasks.map((t) => ({
          id: t.id,
          title: t.title,
          assignee: t.assignee ? (t.assignee.name ?? t.assignee.email ?? "").split(/[@\s]/)[0] : null,
          due: t.dueDate ? t.dueDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : null,
          overdue: !!t.dueDate && t.dueDate.getTime() < Date.now() && t.status !== "done",
          aging: t.status !== "done" && Date.now() - t.updatedAt.getTime() > 3 * 86400000,
          status: t.status,
          project: t.contentProject?.title ?? null,
        }))}
      />

      {/* Capacity + auto-task rules */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-4">
        <section className="card">
          <h3 className="font-mono text-[13px] font-bold mb-2">Capacity — open tasks per person</h3>
          {capacity.length === 0 ? (
            <p className="text-xs text-[var(--mute)]">No open tasks assigned.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {capacity.map((c) => (
                <div key={c.name} className="grid grid-cols-[90px_1fr_26px] items-center gap-2 text-xs">
                  <span className="truncate font-mono">@{c.name}</span>
                  <span className="h-[10px] rounded-full bg-[var(--panel)] overflow-hidden">
                    <span
                      className="block h-full rounded-full anim-grow"
                      style={{
                        width: `${Math.min(100, (c.count / Math.max(1, capacityMax)) * 100)}%`,
                        background: c.count >= rules.wipLimit ? "var(--rose)" : c.count >= rules.wipLimit - 1 ? "var(--amber)" : "var(--green)",
                      }}
                    />
                  </span>
                  <b className="font-mono text-right tabular-nums">{c.count}</b>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h3 className="font-mono text-[13px] font-bold mb-1">Auto-created tasks</h3>
          <p className="text-[11px] text-[var(--mute)] mb-2">
            Pipeline events become work items automatically, deduped against open tasks. Assignment: the post&apos;s
            reviewer or author when set, else the first admin.
          </p>
          {admin ? (
            <form action={saveAutoTaskRulesAction} className="flex flex-col gap-1.5">
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" name="reviewTask" defaultChecked={rules.reviewTask} />
                Draft parks at review → task for the reviewer (due 2d)
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" name="assetTask" defaultChecked={rules.assetTask} />
                Post reaches approval missing images → task for the author (due 1d)
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" name="renderFailTask" defaultChecked={rules.renderFailTask} />
                Video render fails → task for an admin (due 1d)
              </label>
              <label className="flex items-center gap-2 text-xs mt-1">
                WIP limit for In progress:
                <input type="number" name="wipLimit" min={1} max={20} defaultValue={rules.wipLimit} className="w-16 font-mono text-xs border border-[var(--line-2)] rounded-lg p-1" />
              </label>
              <div className="mt-1"><SubmitButton className="btn sm primary">Save rules</SubmitButton></div>
            </form>
          ) : (
            <ul className="text-xs text-[var(--mute)] pl-4 list-disc">
              <li>Review task: {rules.reviewTask ? "on" : "off"}</li>
              <li>Missing-images task: {rules.assetTask ? "on" : "off"}</li>
              <li>Render-failure task: {rules.renderFailTask ? "on" : "off"}</li>
              <li>WIP limit: {rules.wipLimit} (admins can change these)</li>
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
