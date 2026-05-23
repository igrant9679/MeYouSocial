import Link from "next/link";
import { BookOpen, Plus } from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";

// FR-WIKI-01 — Wiki of process docs, SOPs, reference guides.

export default async function WikiPage({ searchParams }: { searchParams: Promise<{ channelId?: string }> }) {
  const { workspace } = await requireMembership();
  const { channelId } = await searchParams;
  const [docs, channels] = await Promise.all([
    db.wikiDoc.findMany({
      where: { workspaceId: workspace.id, ...(channelId ? { channelId } : {}) },
      orderBy: { updatedAt: "desc" },
      include: { channel: { select: { name: true, accentColor: true } } },
    }),
    db.channel.findMany({ where: { workspaceId: workspace.id } }),
  ]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="font-mono font-bold text-lg flex items-center gap-2"><BookOpen className="w-5 h-5" style={{ color: "#4F46E5" }} /> Wiki / SOPs</h2>
        <span className="text-xs text-[var(--mute)]">({docs.length})</span>
        <span className="flex-1" />
        <Link href="/production/wiki/new" className="btn primary sm flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> New page</Link>
      </div>

      {/* Channel filter */}
      <div className="flex flex-wrap gap-1 mb-4">
        <Link href="/production/wiki" className={"text-xs font-mono uppercase tracking-wider px-2.5 py-1 rounded-md border " + (!channelId ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--line-2)] text-[var(--mute)]")}>All</Link>
        {channels.map((c) => (
          <Link key={c.id} href={`/production/wiki?channelId=${c.id}`} className={"text-xs font-mono uppercase tracking-wider px-2.5 py-1 rounded-md border " + (channelId === c.id ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--line-2)] text-[var(--mute)]")}>
            {c.name}
          </Link>
        ))}
      </div>

      <ul className="m-0 p-0 grid grid-cols-1 md:grid-cols-2 gap-3">
        {docs.length === 0 && <li className="col-span-full text-center py-10 text-sm text-[var(--mute)]">No docs yet.</li>}
        {docs.map((d) => (
          <li key={d.id}>
            <Link href={`/production/wiki/${d.id}`} className="card block hover:shadow-md transition">
              <div className="flex items-center gap-2 mb-1">
                <BookOpen className="w-4 h-4" style={{ color: d.channel?.accentColor ?? "#4F46E5" }} />
                <h3 className="font-semibold text-sm flex-1">{d.title}</h3>
              </div>
              <div className="text-xs text-[var(--mute)] line-clamp-2">{d.body.slice(0, 200) || "—"}</div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] mt-2">{d.channel?.name ?? "Workspace"} · {new Date(d.updatedAt).toLocaleDateString()}</div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
