import { Image as ImageIcon, X } from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { createSwipeAction, removeSwipeAction } from "@/app/actions/production";

// FR-SWIPE-01 — Visual swipe library (thumbnails / set design / landing pages).

export default async function SwipesPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { workspace } = await requireMembership();
  const { kind } = await searchParams;

  const swipes = await db.swipe.findMany({
    where: { workspaceId: workspace.id, ...(kind ? { kind } : {}) },
    orderBy: { createdAt: "desc" },
  });
  const channels = await db.channel.findMany({ where: { workspaceId: workspace.id } });

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="font-mono font-bold text-lg flex items-center gap-2"><ImageIcon className="w-5 h-5" style={{ color: "#DB2777" }} /> Swipes</h2>
        <span className="text-xs text-[var(--mute)]">({swipes.length})</span>
      </div>

      {/* Kind filter */}
      <div className="flex flex-wrap gap-1 mb-4">
        {["", "thumbnail", "set", "landing"].map((k) => (
          <a key={k || "all"} href={k ? `/production/swipes?kind=${k}` : "/production/swipes"}
            className={"text-xs font-mono uppercase tracking-wider px-2.5 py-1 rounded-md border " + ((kind ?? "") === k ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--line-2)] text-[var(--mute)]")}>
            {k || "all"}
          </a>
        ))}
      </div>

      <form action={createSwipeAction} className="card grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 items-end mb-5">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Image URL</span>
          <input name="imageUrl" required className="border border-[var(--line-2)] rounded-lg p-2 text-sm font-mono" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Title</span>
          <input name="title" className="border border-[var(--line-2)] rounded-lg p-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Source URL</span>
          <input name="sourceUrl" className="border border-[var(--line-2)] rounded-lg p-2 text-sm font-mono" />
        </label>
        <div className="flex items-end gap-2">
          <select name="kind" className="border border-[var(--line-2)] rounded-lg p-2 text-sm flex-1">
            <option value="thumbnail">Thumbnail</option>
            <option value="set">Set/Studio</option>
            <option value="landing">Landing</option>
          </select>
          <select name="channelId" className="border border-[var(--line-2)] rounded-lg p-2 text-sm flex-1">
            <option value="">No channel</option>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button type="submit" className="btn primary sm">Save</button>
        </div>
      </form>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {swipes.length === 0 && <p className="col-span-full text-center text-sm text-[var(--mute)] py-10">No swipes yet.</p>}
        {swipes.map((s) => (
          <div key={s.id} className="border border-[var(--line)] rounded-xl overflow-hidden bg-white relative group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.imageUrl} alt={s.title ?? ""} className="w-full aspect-video object-cover" />
            <div className="p-2">
              <div className="text-xs font-semibold truncate">{s.title ?? "Untitled"}</div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">{s.kind}</div>
              {s.sourceUrl && <a href={s.sourceUrl} target="_blank" rel="noopener" className="text-[10px] text-[var(--accent)] truncate block">source ↗</a>}
            </div>
            <form action={removeSwipeAction} className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition">
              <input type="hidden" name="id" value={s.id} />
              <button type="submit" title="Remove" className="w-6 h-6 rounded-full bg-black/60 text-white grid place-items-center"><X className="w-3 h-3" /></button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
