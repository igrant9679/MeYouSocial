import Link from "next/link";
import { Clock, PenLine, ArrowRight } from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { setProjectStatusAction } from "@/app/actions/production";

// FR-PIPE-02 — Writer's Room. Projects in Research/Writing, due-soon, per-assignee filter.

export default async function WritersRoomPage({ searchParams }: { searchParams: Promise<{ mine?: string }> }) {
  const { workspace, user } = await requireMembership();
  const { mine } = await searchParams;

  const projects = await db.contentProject.findMany({
    where: {
      channel: { workspaceId: workspace.id },
      status: "research_writing",
      ...(mine === "1" ? { assignees: { some: { userId: user.id } } } : {}),
    },
    include: {
      channel: { select: { name: true, accentColor: true } },
      script: { select: { id: true, wordCount: true, body: true } },
      assignees: { include: { user: { select: { email: true, name: true } } } },
    },
    orderBy: { publishDate: { sort: "asc", nulls: "last" } },
  });

  const soon = (date: Date | null) => date && date.getTime() - Date.now() < 5 * 24 * 60 * 60 * 1000;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="font-mono font-bold text-lg">Writer&apos;s Room</h2>
        <span className="text-xs text-[var(--mute)]">({projects.length})</span>
        <span className="flex-1" />
        <Link href={mine === "1" ? "/production/writers-room" : "/production/writers-room?mine=1"} className="btn sm">
          {mine === "1" ? "All" : "My work"}
        </Link>
      </div>

      {projects.length === 0 && <div className="card text-center py-12"><p className="text-sm text-[var(--mute)]">No projects in writing right now.</p></div>}

      <ul className="m-0 p-0 grid grid-cols-1 md:grid-cols-2 gap-3">
        {projects.map((p) => (
          <li key={p.id} className="card">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-8 h-8 rounded-lg text-white grid place-items-center text-[11px] font-mono font-bold" style={{ background: p.channel.accentColor ?? "var(--accent)" }}>{p.channel.name.slice(0, 2).toUpperCase()}</span>
              <span className="flex-1 min-w-0">
                {p.script ? (
                  <Link href={`/scripts/${p.script.id}`} className="font-semibold text-sm leading-tight hover:text-[var(--accent)]">{p.title}</Link>
                ) : (
                  <span className="font-semibold text-sm leading-tight">{p.title}</span>
                )}
                <div className="text-[11px] text-[var(--mute)]">{p.channel.name}{p.script ? ` · ${p.script.wordCount}w` : ""}</div>
              </span>
              {soon(p.publishDate) && (
                <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}><Clock className="inline w-3 h-3 mr-0.5" />Due soon</span>
              )}
            </div>
            {p.publishDate && <div className="text-[11px] text-[var(--mute)] mb-1">Target: {new Date(p.publishDate).toLocaleDateString()}</div>}
            {p.assignees.length > 0 && (
              <div className="text-[11px] text-[var(--mute)] mb-2 flex items-center gap-1 flex-wrap">
                Assigned:
                {p.assignees.map((a) => <span key={a.id} className="font-mono">{a.user.name ?? a.user.email}{a.role ? ` (${a.role})` : ""}</span>)}
              </div>
            )}
            <div className="flex items-center gap-2">
              {p.script && (
                <Link href={`/scripts/${p.script.id}`} className="btn sm flex items-center gap-1.5"><PenLine className="w-3.5 h-3.5" /> Edit script</Link>
              )}
              <form action={setProjectStatusAction} className="ml-auto">
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="status" value="recording" />
                <button type="submit" className="btn primary sm flex items-center gap-1.5">Move to recording <ArrowRight className="w-3.5 h-3.5" /></button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
