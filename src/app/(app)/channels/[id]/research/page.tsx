import { FileSearch, Star, Trash2 } from "lucide-react";
import { requireChannel } from "@/lib/channel";
import { db } from "@/lib/db";
import { deepResearchAction, starResearchAction, deleteResearchAction } from "@/app/actions/research";

// MU — Research library. FR-CHAT-06 deep tool, FR-RES-01..05 manage sources,
// FR-CHAT-09 starred research persists across all scripts.

export default async function ChannelResearchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ focus?: string }> }) {
  const { id } = await params;
  const { focus } = await searchParams;
  await requireChannel(id);

  const sources = await db.researchSource.findMany({
    where: { channelId: id, scriptId: null },
    orderBy: [{ starred: "desc" }, { createdAt: "desc" }],
    take: 60,
  });
  const focused = focus ? sources.find((s) => s.id === focus) : sources[0];

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: "#E5EDFD", color: "#2563EB" }}>
          <FileSearch className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div>
          <h2 className="font-mono font-bold text-lg leading-tight">Research</h2>
          <p className="text-xs text-[var(--mute)]">Deep multi-source research synthesized into saved reports. Star items to persist them across every script (FR-CHAT-09).</p>
        </div>
      </div>

      {/* Deep research form */}
      <form action={deepResearchAction} className="card mb-5">
        <h3 className="font-mono font-bold text-[14px] mb-3 flex items-center gap-2"><FileSearch className="w-4 h-4" style={{ color: "#2563EB" }} /> New deep research</h3>
        <input type="hidden" name="channelId" value={id} />
        <label className="flex flex-col gap-1 mb-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Question / topic</span>
          <textarea name="question" required rows={2} placeholder="What's the latest evidence on cold exposure and recovery?" className="border border-[var(--line-2)] rounded-lg p-2 text-sm" />
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Depth (word budget)</span>
            <select name="depth" defaultValue="intermediate" className="border border-[var(--line-2)] rounded-lg p-2 text-sm">
              <option value="basic">Basic — 5k</option>
              <option value="intermediate">Intermediate — 15k</option>
              <option value="comprehensive">Comprehensive — 45k</option>
              <option value="exhaustive">Exhaustive — 90k</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs ml-2">
            <input type="checkbox" name="includeCompetitors" value="1" defaultChecked />
            Include competitor video titles for niche context
          </label>
          <span className="flex-1" />
          <button type="submit" className="btn primary">Run deep research</button>
        </div>
      </form>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* Library */}
        <aside className="card p-3 h-fit">
          <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--mute)] mb-2">Library ({sources.length})</h3>
          {sources.length === 0 && <p className="text-xs text-[var(--mute)] py-2 text-center">No research yet.</p>}
          <ul className="m-0 p-0 flex flex-col gap-1">
            {sources.map((s) => (
              <li key={s.id}>
                <a href={`/channels/${id}/research?focus=${s.id}`} className={"flex items-start gap-2 px-2 py-1.5 rounded-md text-xs transition " + (focused?.id === s.id ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--slate)] hover:bg-[var(--zebra)]")}>
                  {s.starred && <Star className="w-3 h-3 flex-shrink-0 mt-0.5" fill="currentColor" style={{ color: "#D97706" }} />}
                  <span className="flex-1 truncate font-semibold">{s.title ?? s.ref}</span>
                </a>
              </li>
            ))}
          </ul>
        </aside>

        {/* Focused detail */}
        <main>
          {focused ? (
            <article className="card">
              <div className="flex items-center gap-2 mb-3">
                <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{focused.kind}</span>
                <h2 className="font-mono font-bold text-lg flex-1">{focused.title ?? focused.ref}</h2>
                <form action={starResearchAction}>
                  <input type="hidden" name="id" value={focused.id} />
                  <button type="submit" title="Toggle starred"><Star className="w-4 h-4" fill={focused.starred ? "currentColor" : "none"} style={{ color: focused.starred ? "#D97706" : "var(--mute)" }} /></button>
                </form>
                <form action={deleteResearchAction}>
                  <input type="hidden" name="id" value={focused.id} />
                  <input type="hidden" name="channelId" value={id} />
                  <button type="submit" className="btn sm" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                </form>
              </div>
              <div className="text-xs text-[var(--mute)] mb-3">{new Date(focused.createdAt).toLocaleString()} · {focused.wordCount.toLocaleString()} words {focused.starred && " · ★ pinned across all scripts (FR-CHAT-09)"}</div>
              <pre className="text-sm whitespace-pre-wrap font-sans leading-[1.6]">{focused.content ?? "(empty)"}</pre>
            </article>
          ) : (
            <div className="card text-center py-12 text-sm text-[var(--mute)]">Run a deep research to get started.</div>
          )}
        </main>
      </div>
    </div>
  );
}
