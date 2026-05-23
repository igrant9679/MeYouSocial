import Link from "next/link";
import { Clapperboard, ArrowRight, Film } from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { setProjectStatusAction } from "@/app/actions/production";

// FR-PIPE-03 — Film Queue: projects in Recording, grouped by shoot day (publishDate).

export default async function FilmQueuePage({ searchParams }: { searchParams: Promise<{ mine?: string }> }) {
  const { workspace, user } = await requireMembership();
  const { mine } = await searchParams;

  const projects = await db.contentProject.findMany({
    where: {
      channel: { workspaceId: workspace.id },
      status: "recording",
      ...(mine === "1" ? { assignees: { some: { userId: user.id } } } : {}),
    },
    include: {
      channel: { select: { name: true, accentColor: true } },
      script: { select: { id: true } },
      assignees: { include: { user: { select: { email: true, name: true } } } },
      assetLinks: { include: { asset: true } },
    },
    orderBy: { publishDate: { sort: "asc", nulls: "last" } },
  });

  const groups = new Map<string, typeof projects>();
  for (const p of projects) {
    const key = p.publishDate ? new Date(p.publishDate).toISOString().slice(0, 10) : "Unscheduled";
    const arr = groups.get(key) ?? [];
    arr.push(p);
    groups.set(key, arr);
  }
  const dayKeys = Array.from(groups.keys());

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="font-mono font-bold text-lg flex items-center gap-2"><Clapperboard className="w-5 h-5" style={{ color: "#D97706" }} /> Film Queue</h2>
        <span className="text-xs text-[var(--mute)]">({projects.length})</span>
        <span className="flex-1" />
        <Link href={mine === "1" ? "/production/film-queue" : "/production/film-queue?mine=1"} className="btn sm">{mine === "1" ? "All" : "My work"}</Link>
      </div>

      {projects.length === 0 && <div className="card text-center py-12"><p className="text-sm text-[var(--mute)]">Nothing to film today.</p></div>}

      {dayKeys.map((day) => (
        <section key={day} className="card mb-4">
          <h3 className="font-mono text-[12px] uppercase tracking-wider text-[var(--mute)] mb-3">{day === "Unscheduled" ? day : new Date(day).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "short", day: "numeric" })}</h3>
          <ul className="m-0 p-0 grid grid-cols-1 md:grid-cols-2 gap-3">
            {groups.get(day)!.map((p) => (
              <li key={p.id} className="border border-[var(--line)] rounded-xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-8 h-8 rounded-lg text-white grid place-items-center text-[11px] font-mono font-bold" style={{ background: p.channel.accentColor ?? "var(--accent)" }}>{p.channel.name.slice(0, 2).toUpperCase()}</span>
                  <div className="flex-1 min-w-0">
                    {p.script ? (
                      <Link href={`/scripts/${p.script.id}`} className="font-semibold text-sm hover:text-[var(--accent)]">{p.title}</Link>
                    ) : (
                      <div className="font-semibold text-sm">{p.title}</div>
                    )}
                    <div className="text-[11px] text-[var(--mute)]">{p.channel.name}</div>
                  </div>
                </div>
                {p.assetLinks.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-[11px] text-[var(--mute)] cursor-pointer flex items-center gap-1.5"><Film className="w-3 h-3" /> Shot list ({p.assetLinks.length})</summary>
                    <ul className="m-0 p-0 mt-1.5 text-[11px]">
                      {p.assetLinks.map((al) => (<li key={al.id} className="py-0.5">· {al.asset.name}</li>))}
                    </ul>
                  </details>
                )}
                <form action={setProjectStatusAction} className="mt-3">
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="status" value="editing" />
                  <button type="submit" className="btn primary sm w-full flex items-center justify-center gap-1.5">Move to Edit Bay <ArrowRight className="w-3.5 h-3.5" /></button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
