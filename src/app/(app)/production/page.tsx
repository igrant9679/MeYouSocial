import Link from "next/link";
import { ArrowRight, Plus, Tags } from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { setProjectStatusAction, createProjectAction, setProjectTopicAction } from "@/app/actions/production";
import { SubmitButton } from "@/components/SubmitButton";

// Configurable Production Board: all content by status, with click-to-advance.
// Drag-and-drop is omitted v1; the forward arrow is the supported way to advance a stage.

const STATUSES = [
  { key: "idea", label: "Idea", color: "#D97706", soft: "#FBEED5" },
  { key: "research_writing", label: "Research/Writing", color: "#2563EB", soft: "#E5EDFD" },
  { key: "recording", label: "Recording", color: "#6D28D9", soft: "#EDE7FB" },
  { key: "editing", label: "Editing", color: "#4F46E5", soft: "#E7E6FB" },
  { key: "scheduled", label: "Scheduled", color: "#0D9488", soft: "#D7F1ED" },
  { key: "published", label: "Published", color: "#15924B", soft: "#E0F2E8" },
] as const;

export default async function ProductionBoardPage() {
  const { workspace } = await requireMembership();
  const [projects, channels, topics] = await Promise.all([
    db.contentProject.findMany({
      where: { channel: { workspaceId: workspace.id } },
      include: {
        channel: { select: { id: true, name: true, accentColor: true } },
        script: { select: { id: true, wordCount: true } },
        topic: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    db.channel.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "asc" } }),
    db.topic.findMany({
      where: { workspaceId: workspace.id, status: "active" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div>
      {/* Quick-add */}
      {channels.length > 0 && (
        <form action={createProjectAction} className="card flex items-end gap-2 mb-4 max-w-2xl">
          <label className="flex-1 flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">New project</span>
            <input name="title" required placeholder="Working title" className="border border-[var(--line-2)] rounded-lg p-2 text-sm" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Channel</span>
            <select name="channelId" className="border border-[var(--line-2)] rounded-lg p-2 text-sm">
              {channels.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
          </label>
          {topics.length > 0 && (
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Topic</span>
              <select name="topicId" defaultValue="" className="border border-[var(--line-2)] rounded-lg p-2 text-sm">
                <option value="">none</option>
                {topics.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
              </select>
            </label>
          )}
          <SubmitButton className="btn primary sm" pendingText="Adding…"><Plus className="w-3.5 h-3.5" /> Add</SubmitButton>
        </form>
      )}

      {/* Kanban */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 min-h-[400px]">
        {STATUSES.map((s) => {
          const items = projects.filter((p) => p.status === s.key);
          return (
            <section key={s.key} className="card" style={{ background: s.soft + "55" }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                <h2 className="font-mono font-bold text-xs uppercase tracking-wider" style={{ color: s.color }}>{s.label}</h2>
                <span className="text-xs text-[var(--mute)]">({items.length})</span>
              </div>
              <ul className="m-0 p-0 flex flex-col gap-2">
                {items.length === 0 && <li className="text-[11px] text-[var(--mute)] py-3 text-center">—</li>}
                {items.map((p) => (
                  <li key={p.id} className="bg-[var(--bg)] border border-[var(--line)] rounded-lg p-2.5">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="w-6 h-6 rounded-md text-white grid place-items-center text-[10px] font-mono font-bold" style={{ background: p.channel.accentColor ?? "var(--accent)" }}>{p.channel.name.slice(0, 2).toUpperCase()}</span>
                      <span className="flex-1" />
                      {/* Advance */}
                      {(() => {
                        const idx = STATUSES.findIndex((x) => x.key === p.status);
                        const next = STATUSES[idx + 1];
                        if (!next) return null;
                        return (
                          <form action={setProjectStatusAction} title={`Move to ${next.label}`}>
                            <input type="hidden" name="id" value={p.id} />
                            <input type="hidden" name="status" value={next.key} />
                            <button type="submit" className="w-6 h-6 rounded-md grid place-items-center hover:bg-[var(--zebra)]"><ArrowRight className="w-3.5 h-3.5" style={{ color: next.color }} /></button>
                          </form>
                        );
                      })()}
                    </div>
                    {p.script ? (
                      <Link href={`/scripts/${p.script.id}`} className="font-semibold text-sm leading-tight hover:text-[var(--accent)]">{p.title}</Link>
                    ) : (
                      <div className="font-semibold text-sm leading-tight">{p.title}</div>
                    )}
                    <div className="text-[11px] text-[var(--mute)] mt-1">{p.channel.name}{p.script ? ` · ${p.script.wordCount}w` : ""}</div>
                    {topics.length > 0 ? (
                      <form action={setProjectTopicAction} className="flex items-center gap-1 mt-1.5">
                        <input type="hidden" name="id" value={p.id} />
                        <Tags className="w-3 h-3 shrink-0" style={{ color: "var(--indigo-on)" }} />
                        <select name="topicId" defaultValue={p.topicId ?? ""} aria-label="Topic"
                          className="text-[10px] border border-[var(--line-2)] rounded px-1 py-0.5 flex-1 min-w-0">
                          <option value="">no topic</option>
                          {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                        <SubmitButton className="btn sm !px-1.5 !py-0.5 !text-[10px]" pendingText="…">Set</SubmitButton>
                      </form>
                    ) : p.topic ? (
                      <div className="font-mono text-[10px] mt-1 inline-flex items-center gap-1" style={{ color: "var(--indigo-on)" }}>
                        <Tags className="w-3 h-3" /> {p.topic.name}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
