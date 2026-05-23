import { Film, Star, Link2 } from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { createAssetAction, toggleAssetFavoriteAction } from "@/app/actions/production";

// FR-ASSET-01/03 — centralized B-roll/shot list library; favorites; channel scope.

export default async function AssetsPage({ searchParams }: { searchParams: Promise<{ q?: string; favs?: string; channelId?: string }> }) {
  const { workspace } = await requireMembership();
  const { q, favs, channelId } = await searchParams;
  const channels = await db.channel.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "asc" } });

  const assets = await db.asset.findMany({
    where: {
      AND: [
        { OR: [{ channelId: null }, { channel: { workspaceId: workspace.id } }] },
        channelId ? { channelId } : {},
        favs === "1" ? { favorite: true } : {},
        q ? { OR: [{ name: { contains: q } }, { url: { contains: q } }] } : {},
      ],
    },
    orderBy: [{ favorite: "desc" }, { createdAt: "desc" }],
    include: { channel: { select: { name: true, accentColor: true } } },
  });

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="font-mono font-bold text-lg flex items-center gap-2"><Film className="w-5 h-5" style={{ color: "#0891B2" }} /> B-roll & shot library</h2>
        <span className="text-xs text-[var(--mute)]">({assets.length})</span>
      </div>

      <form className="card flex flex-wrap items-end gap-2 mb-4">
        <label className="flex-1 min-w-[200px] flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Search</span>
          <input name="q" defaultValue={q ?? ""} className="border border-[var(--line-2)] rounded-lg p-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Channel</span>
          <select name="channelId" defaultValue={channelId ?? ""} className="border border-[var(--line-2)] rounded-lg p-2 text-sm">
            <option value="">All</option>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" name="favs" value="1" defaultChecked={favs === "1"} /> Favorites
        </label>
        <button type="submit" className="btn sm">Filter</button>
      </form>

      <form action={createAssetAction} className="card flex flex-wrap items-end gap-2 mb-5">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Kind</span>
          <select name="kind" className="border border-[var(--line-2)] rounded-lg p-2 text-sm">
            <option value="broll">B-roll</option>
            <option value="stock">Stock</option>
            <option value="animation">Animation</option>
            <option value="upload">Upload</option>
            <option value="link">Link</option>
          </select>
        </label>
        <label className="flex-1 min-w-[200px] flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Name</span>
          <input name="name" required placeholder="e.g. cold-open city skyline" className="border border-[var(--line-2)] rounded-lg p-2 text-sm" />
        </label>
        <label className="flex-1 min-w-[200px] flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">URL (optional)</span>
          <input name="url" className="border border-[var(--line-2)] rounded-lg p-2 text-sm font-mono" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Channel</span>
          <select name="channelId" className="border border-[var(--line-2)] rounded-lg p-2 text-sm">
            <option value="">All channels</option>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <button type="submit" className="btn primary sm">Add asset</button>
      </form>

      <ul className="m-0 p-0 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {assets.length === 0 && <li className="text-sm text-[var(--mute)] col-span-full text-center py-10">No assets.</li>}
        {assets.map((a) => (
          <li key={a.id} className="card flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: a.channel?.accentColor ? a.channel.accentColor + "20" : "#D8EFF5", color: a.channel?.accentColor ?? "#0891B2" }}>
              <Film className="w-5 h-5" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm truncate">{a.name}</div>
              <div className="text-[11px] text-[var(--mute)]">{a.kind}{a.channel ? ` · ${a.channel.name}` : ""}</div>
            </div>
            {a.url && <a href={a.url} target="_blank" rel="noopener" className="btn sm"><Link2 className="w-3.5 h-3.5" /></a>}
            <form action={toggleAssetFavoriteAction}>
              <input type="hidden" name="id" value={a.id} />
              <button type="submit" title="Toggle favorite">
                <Star className="w-4 h-4" style={{ color: a.favorite ? "#D97706" : "var(--mute)" }} fill={a.favorite ? "currentColor" : "none"} />
              </button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
