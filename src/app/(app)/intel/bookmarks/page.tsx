import Link from "next/link";
import { Bookmark, ArrowLeft } from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { outlierBand, formatNum } from "@/lib/intel";
import { toggleBookmarkAction, updateBookmarkAction } from "@/app/actions/bookmarks";

// FR-INTEL-11 — Bookmarks page. Team-shared per-workspace.

export default async function BookmarksPage() {
  const { workspace } = await requireMembership();
  const items = await db.bookmark.findMany({
    where: { workspaceId: workspace.id },
    include: { intelChannel: true, intelVideo: { include: { intelChannel: true } } },
    orderBy: { createdAt: "desc" },
  });

  const channels = items.filter((b) => b.intelChannel);
  const videos = items.filter((b) => b.intelVideo);

  return (
    <div>
      <Link href="/intel" className="text-xs font-mono text-[var(--mute)] hover:text-[var(--accent)] flex items-center gap-1 mb-3"><ArrowLeft className="w-3 h-3" /> Back to Intel</Link>
      <div className="flex items-center gap-3 mb-5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "#FDE7E1", color: "#E5482F" }}>
          <Bookmark className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-2xl leading-tight">Bookmarks</h1>
          <p className="text-xs text-[var(--mute)]">Shared across your whole workspace.</p>
        </div>
      </div>

      {items.length === 0 && (
        <div className="card text-center py-12">
          <p className="text-sm text-[var(--mute)]">No bookmarks yet. Hit the <Bookmark className="inline w-3.5 h-3.5" /> on any channel or video in Intel.</p>
        </div>
      )}

      {channels.length > 0 && (
        <section className="card mb-5">
          <h2 className="font-mono text-[14px] font-bold mb-3">Channels</h2>
          <ul className="m-0 p-0 grid grid-cols-1 md:grid-cols-2 gap-2">
            {channels.map((b) => (
              <BookmarkRow key={b.id} bookmark={b} kind="channel" />
            ))}
          </ul>
        </section>
      )}

      {videos.length > 0 && (
        <section className="card">
          <h2 className="font-mono text-[14px] font-bold mb-3">Videos</h2>
          <ul className="m-0 p-0">
            {videos.map((b) => (
              <BookmarkRow key={b.id} bookmark={b} kind="video" />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function BookmarkRow({ bookmark, kind }: { bookmark: { id: string; tags: string; notes: string | null; intelChannel: { id: string; name: string | null; handle: string | null; subscribers: number | null } | null; intelVideo: { id: string; title: string; outlierScore: number | null; views: bigint | null; intelChannel: { name: string | null } } | null }; kind: "channel" | "video" }) {
  const tags = readJson<string[]>(bookmark.tags, []);
  if (kind === "channel" && bookmark.intelChannel) {
    const c = bookmark.intelChannel;
    return (
      <li className="border border-[var(--line)] rounded-xl p-3 flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl text-white grid place-items-center font-mono font-bold text-sm" style={{ background: "linear-gradient(135deg,#6D28D9,#4F46E5)" }}>{c.name?.slice(0, 2).toUpperCase()}</span>
          <div className="flex-1 min-w-0">
            <Link href={`/intel/channels/${c.id}`} className="font-semibold text-sm hover:text-[var(--accent)]">{c.name}</Link>
            <div className="text-xs text-[var(--mute)]">{c.handle} · {formatNum(c.subscribers)} subs</div>
          </div>
          <form action={toggleBookmarkAction}>
            <input type="hidden" name="intelChannelId" value={c.id} />
            <button type="submit" className="btn sm" title="Remove"><Bookmark className="w-3.5 h-3.5" fill="currentColor" /></button>
          </form>
        </div>
        <BookmarkMeta id={bookmark.id} tags={tags} notes={bookmark.notes ?? ""} />
      </li>
    );
  }
  if (kind === "video" && bookmark.intelVideo) {
    const v = bookmark.intelVideo;
    const band = outlierBand(v.outlierScore);
    return (
      <li className="border-t border-[var(--line)] first:border-t-0 py-3 flex items-center gap-3 flex-wrap">
        <span className="font-mono font-bold text-[11px] px-2 py-1 rounded-md" style={{ background: band.soft, color: band.color }}>{v.outlierScore?.toFixed(1)}x</span>
        <Link href={`/intel/videos/${v.id}`} className="font-semibold text-sm hover:text-[var(--accent)] flex-1 min-w-0 truncate">{v.title}</Link>
        <span className="text-xs text-[var(--mute)]">{v.intelChannel.name} · {formatNum(v.views)} views</span>
        <form action={toggleBookmarkAction}>
          <input type="hidden" name="intelVideoId" value={v.id} />
          <button type="submit" className="btn sm" title="Remove"><Bookmark className="w-3.5 h-3.5" fill="currentColor" /></button>
        </form>
      </li>
    );
  }
  return null;
}

function BookmarkMeta({ id, tags, notes }: { id: string; tags: string[]; notes: string }) {
  return (
    <details>
      <summary className="text-xs text-[var(--mute)] cursor-pointer">Tags & notes ({tags.length})</summary>
      <form action={updateBookmarkAction} className="flex flex-col gap-2 mt-2">
        <input type="hidden" name="id" value={id} />
        <input name="tags" defaultValue={tags.join(", ")} placeholder="comma-separated tags" className="border border-[var(--line-2)] rounded-md p-1.5 text-xs font-mono" />
        <textarea name="notes" defaultValue={notes} rows={2} placeholder="Notes..." className="border border-[var(--line-2)] rounded-md p-1.5 text-xs" />
        <button type="submit" className="btn sm self-end">Save</button>
      </form>
    </details>
  );
}
