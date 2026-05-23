import Link from "next/link";
import { ArrowLeft, BarChart3, RefreshCw, Tag, Hash, GitBranch, FileText, BookOpen } from "lucide-react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { formatNum } from "@/lib/intel";
import {
  syncStatsAction,
  setProjectMeritAction,
  setProjectKeywordsAction,
  repurposeProjectAction,
} from "@/app/actions/growth";
import { setProjectStatusAction, setProjectPublishDateAction } from "@/app/actions/production";
import { attachChecklistAction } from "@/app/actions/final-pass";

const STATUS_LABEL: Record<string, string> = {
  idea: "Idea", research_writing: "Research/Writing", recording: "Recording", editing: "Editing", scheduled: "Scheduled", published: "Published",
};

const MERIT_COLOR: Record<string, { color: string; soft: string }> = {
  pillar:     { color: "#15924B", soft: "#E0F2E8" },
  trending:   { color: "#E5482F", soft: "#FDE7E1" },
  experiment: { color: "#6D28D9", soft: "#EDE7FB" },
};

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await requireMembership();
  const project = await db.contentProject.findFirst({
    where: { id, channel: { workspaceId: workspace.id } },
    include: {
      channel: { select: { id: true, name: true, accentColor: true } },
      script: { select: { id: true, title: true, wordCount: true, status: true } },
      parent: { select: { id: true, title: true } },
      derivatives: { select: { id: true, title: true, format: true, status: true } },
      assignees: { include: { user: { select: { name: true, email: true } } } },
      tasks: { orderBy: { dueDate: { sort: "asc", nulls: "last" } } },
    },
  });
  if (!project) notFound();

  const [stats, wikiDocs] = await Promise.all([
    db.channelStat.findMany({
      where: { channelId: project.channelId, videoYoutubeId: project.scriptId ?? undefined },
      orderBy: { capturedAt: "desc" },
      take: 1,
    }),
    db.wikiDoc.findMany({
      where: { workspaceId: workspace.id, OR: [{ channelId: null }, { channelId: project.channelId }] },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, checklist: true },
    }),
  ]);
  const stat = stats[0];

  const keywords = readJson<string[]>(project.keywords, []);

  // FR-TASK-02 — task grouping under projects with progress rollup
  const tasksDone = project.tasks.filter((t) => t.status === "done").length;
  const tasksProgress = project.tasks.length > 0 ? Math.round((tasksDone / project.tasks.length) * 100) : 0;

  return (
    <div>
      <Link href="/production" className="text-xs font-mono text-[var(--mute)] hover:text-[var(--accent)] flex items-center gap-1 mb-3"><ArrowLeft className="w-3 h-3" /> Production board</Link>

      {/* Header */}
      <div className="card mb-4">
        <div className="flex items-center gap-3 mb-2">
          <span className="w-10 h-10 rounded-xl text-white grid place-items-center font-mono font-bold" style={{ background: project.channel.accentColor ?? "var(--accent)" }}>{project.channel.name.slice(0, 2).toUpperCase()}</span>
          <div className="flex-1">
            <h1 className="font-mono font-bold text-2xl leading-tight">{project.title}</h1>
            <div className="text-xs text-[var(--mute)] flex items-center gap-2">
              <span className="font-mono uppercase tracking-wider">{STATUS_LABEL[project.status] ?? project.status}</span>
              {project.editStatus && <span>· edit: {project.editStatus.replace("_", " ")}</span>}
              {project.format && <span>· {project.format}</span>}
              <span>· {project.channel.name}</span>
            </div>
          </div>
          {project.script && (
            <Link href={`/scripts/${project.script.id}`} className="btn sm flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Script</Link>
          )}
        </div>

        {project.parent && (
          <div className="text-xs text-[var(--mute)] flex items-center gap-1 mt-2">
            <GitBranch className="w-3 h-3" /> Repurposed from <Link href={`/production/projects/${project.parent.id}`} className="text-[var(--accent)] font-semibold">{project.parent.title}</Link>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Status + publish date */}
        <section className="card">
          <h2 className="font-mono font-bold text-[14px] mb-3">Status & schedule</h2>
          <form action={setProjectStatusAction} className="flex items-end gap-2 mb-3">
            <input type="hidden" name="id" value={project.id} />
            <label className="flex flex-col gap-1 flex-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Status</span>
              <select name="status" defaultValue={project.status} className="border border-[var(--line-2)] rounded-lg p-2 text-sm">
                {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <button type="submit" className="btn sm">Save</button>
          </form>
          <form action={setProjectPublishDateAction} className="flex items-end gap-2">
            <input type="hidden" name="id" value={project.id} />
            <label className="flex flex-col gap-1 flex-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Target publish</span>
              <input type="date" name="publishDate" defaultValue={project.publishDate ? new Date(project.publishDate).toISOString().slice(0, 10) : ""} className="border border-[var(--line-2)] rounded-lg p-2 text-sm" />
            </label>
            <button type="submit" className="btn sm">Save</button>
          </form>
        </section>

        {/* Merit + Keywords */}
        <section className="card">
          <h2 className="font-mono font-bold text-[14px] mb-3 flex items-center gap-2"><Tag className="w-4 h-4" style={{ color: "#6D28D9" }} /> Strategy tags</h2>

          {/* FR-MERIT */}
          <form action={setProjectMeritAction} className="flex items-end gap-2 mb-3">
            <input type="hidden" name="id" value={project.id} />
            <label className="flex flex-col gap-1 flex-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Idea merit</span>
              <select name="merit" defaultValue={project.ideaMerit ?? ""} className="border border-[var(--line-2)] rounded-lg p-2 text-sm">
                <option value="">—</option>
                <option value="pillar">Content pillar</option>
                <option value="trending">Trending topic</option>
                <option value="experiment">Experiment</option>
              </select>
            </label>
            <button type="submit" className="btn sm">Save</button>
          </form>
          {project.ideaMerit && (
            <span className="font-mono text-[11px] font-bold px-2 py-1 rounded-md inline-block mb-3" style={{ background: MERIT_COLOR[project.ideaMerit]?.soft, color: MERIT_COLOR[project.ideaMerit]?.color }}>
              {project.ideaMerit}
            </span>
          )}

          {/* FR-KW */}
          <form action={setProjectKeywordsAction} className="flex flex-col gap-2">
            <input type="hidden" name="id" value={project.id} />
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] flex items-center gap-1"><Hash className="w-3 h-3" /> Target keywords (comma-separated)</span>
              <textarea name="keywords" defaultValue={keywords.join(", ")} rows={2} className="border border-[var(--line-2)] rounded-lg p-2 text-sm font-mono" />
            </label>
            <button type="submit" className="btn sm self-end">Save</button>
          </form>
        </section>

        {/* Performance */}
        <section className="card">
          <h2 className="font-mono font-bold text-[14px] mb-3 flex items-center gap-2"><BarChart3 className="w-4 h-4" style={{ color: "#2563EB" }} /> Performance (FR-PERF-01)</h2>
          {stat ? (
            <div className="grid grid-cols-3 gap-3 mb-3">
              <Metric label="Views" value={formatNum(stat.views)} color="#2563EB" />
              <Metric label="Retention" value={((stat.retentionProxy ?? 0) * 100).toFixed(0) + "%"} color="#15924B" />
              <Metric label="Engagement" value={((stat.engagement ?? 0) * 100).toFixed(1) + "%"} color="#D97706" />
            </div>
          ) : (
            <p className="text-xs text-[var(--mute)] mb-3">No stats yet — sync once the video is published.</p>
          )}
          <form action={syncStatsAction}>
            <input type="hidden" name="projectId" value={project.id} />
            <button type="submit" className="btn sm flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" /> Sync stats now</button>
          </form>
          {stat && <p className="text-[10px] font-mono text-[var(--mute)] mt-2">Last synced {new Date(stat.capturedAt).toLocaleString()}</p>}
        </section>

        {/* Task progress rollup (FR-TASK-02) */}
        {project.tasks.length > 0 && (
          <section className="card">
            <h2 className="font-mono font-bold text-[14px] mb-3">Tasks ({tasksDone}/{project.tasks.length} done)</h2>
            <div className="h-2 rounded-full bg-[var(--line)] overflow-hidden mb-3">
              <div className="h-full rounded-full transition-all" style={{ width: tasksProgress + "%", background: tasksProgress === 100 ? "var(--green)" : "var(--accent)" }} />
            </div>
            <ul className="m-0 p-0">
              {project.tasks.slice(0, 6).map((t) => (
                <li key={t.id} className="border-t border-[var(--line)] first:border-t-0 py-1.5 text-xs flex items-center gap-2">
                  <span className={"w-2 h-2 rounded-full"} style={{ background: t.status === "done" ? "var(--green)" : t.status === "in_progress" ? "var(--amber)" : "var(--mute)" }} />
                  <span className={"flex-1 " + (t.status === "done" ? "line-through text-[var(--mute)]" : "")}>{t.title}</span>
                  {t.dueDate && <span className="text-[10px] text-[var(--mute)]">{new Date(t.dueDate).toLocaleDateString()}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* FR-WIKI-03 — Attach an SOP checklist as project tasks */}
        {wikiDocs.length > 0 && (
          <section className="card">
            <h2 className="font-mono font-bold text-[14px] mb-3 flex items-center gap-2"><BookOpen className="w-4 h-4" style={{ color: "#4F46E5" }} /> Attach SOP checklist (FR-WIKI-03)</h2>
            <form action={attachChecklistAction} className="flex items-end gap-2">
              <input type="hidden" name="contentProjectId" value={project.id} />
              <label className="flex flex-col gap-1 flex-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Wiki page</span>
                <select name="wikiDocId" className="border border-[var(--line-2)] rounded-lg p-2 text-sm">
                  {wikiDocs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                </select>
              </label>
              <button type="submit" className="btn primary sm">Attach as tasks</button>
            </form>
            <p className="text-[11px] text-[var(--mute)] mt-2">Converts the wiki page's checklist (or `- ` bullets in the body) into assigned tasks on this project.</p>
          </section>
        )}

        {/* Repurposing */}
        <section className="card">
          <h2 className="font-mono font-bold text-[14px] mb-3 flex items-center gap-2"><GitBranch className="w-4 h-4" style={{ color: "#0D9488" }} /> Repurpose (FR-REPURP-01)</h2>
          <form action={repurposeProjectAction} className="flex items-end gap-2 mb-3">
            <input type="hidden" name="parentId" value={project.id} />
            <label className="flex flex-col gap-1 flex-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">New title (optional)</span>
              <input name="title" placeholder={`${project.title} (short)`} className="border border-[var(--line-2)] rounded-lg p-2 text-sm" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Format</span>
              <select name="format" className="border border-[var(--line-2)] rounded-lg p-2 text-sm">
                <option value="short">Short</option>
                <option value="long">Long</option>
                <option value="podcast">Podcast cut</option>
                <option value="blog">Blog</option>
              </select>
            </label>
            <button type="submit" className="btn primary sm">Create derivative</button>
          </form>
          {project.derivatives.length > 0 && (
            <ul className="m-0 p-0">
              {project.derivatives.map((d) => (
                <li key={d.id} className="border-t border-[var(--line)] py-2 text-sm flex items-center gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{d.format ?? "—"}</span>
                  <Link href={`/production/projects/${d.id}`} className="flex-1 hover:text-[var(--accent)] truncate">{d.title}</Link>
                  <span className="text-[10px] font-mono text-[var(--mute)]">{d.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="border border-[var(--line)] rounded-xl p-3 relative overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: color }} />
      <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">{label}</div>
      <div className="font-mono font-bold text-2xl" style={{ color }}>{value}</div>
    </div>
  );
}
