import Link from "next/link";
import { Bookmark, ArrowLeft, Eye, Calendar, TrendingUp } from "lucide-react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { outlierBand, isFastGrowing, formatNum } from "@/lib/intel";
import { toggleBookmarkAction } from "@/app/actions/bookmarks";
import { findSimilarChannelsAction, chatWithEntityAction } from "@/app/actions/intel";
import { MessageCircle, GitBranch } from "lucide-react";

// FR-INTEL-07 — Channel detail view: subscriber/growth trends, total & average views,
// upload frequency/consistency, top videos sortable by views/outlier, and outlier list.

export default async function IntelChannelPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sort?: string }> }) {
  const { id } = await params;
  const { sort = "outlier" } = await searchParams;
  const { workspace } = await requireMembership();

  const channel = await db.intelChannel.findUnique({
    where: { id },
    include: {
      videos: {
        orderBy: sort === "views" ? { views: "desc" } : { outlierScore: "desc" },
        take: 20,
      },
    },
  });
  if (!channel) notFound();

  const bookmarked = await db.bookmark.findFirst({ where: { workspaceId: workspace.id, intelChannelId: id } });
  const avgViews = channel.videos.length
    ? Math.round(channel.videos.reduce((a, v) => a + Number(v.views ?? 0), 0) / channel.videos.length)
    : 0;
  const outlierVideos = channel.videos.filter((v) => (v.outlierScore ?? 0) >= 2).slice(0, 5);

  return (
    <div>
      <Link href="/intel" className="text-xs font-mono text-[var(--mute)] hover:text-[var(--accent)] flex items-center gap-1 mb-3"><ArrowLeft className="w-3 h-3" /> Back to Intel</Link>

      {/* Header */}
      <div className="card mb-5 flex items-start gap-4">
        <span className="w-16 h-16 rounded-2xl text-white grid place-items-center font-mono font-bold text-xl shadow-md" style={{ background: "linear-gradient(135deg,#6D28D9,#4F46E5)" }}>
          {channel.name?.slice(0, 2).toUpperCase()}
        </span>
        <div className="flex-1 min-w-0">
          <h1 className="font-mono font-bold text-2xl leading-tight flex items-center gap-2">
            {channel.name}
            {isFastGrowing(channel.velocityScore) && (
              <span className="text-[10px] font-mono font-bold px-2 py-1 rounded-md" style={{ background: "#FDE7E1", color: "#E5482F" }}>▲ FAST GROWING</span>
            )}
          </h1>
          <div className="text-sm text-[var(--mute)]">{channel.handle} · {channel.category}{channel.language ? " · " + channel.language : ""}</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <form action={toggleBookmarkAction}>
            <input type="hidden" name="intelChannelId" value={channel.id} />
            <button type="submit" className="btn flex items-center gap-2">
              <Bookmark className="w-4 h-4" fill={bookmarked ? "currentColor" : "none"} />
              {bookmarked ? "Bookmarked" : "Bookmark"}
            </button>
          </form>
          <form action={chatWithEntityAction}>
            <input type="hidden" name="kind" value="channel" />
            <input type="hidden" name="entityId" value={channel.id} />
            <button type="submit" className="btn flex items-center gap-2" title="Open a chat scoped to this channel (FR-INTEL-10)">
              <MessageCircle className="w-4 h-4" /> Chat with channel
            </button>
          </form>
          <form action={findSimilarChannelsAction}>
            <input type="hidden" name="intelChannelId" value={channel.id} />
            <button type="submit" className="btn flex items-center gap-2" title="Find similar channels in this niche (FR-INTEL-09)">
              <GitBranch className="w-4 h-4" /> Find similar
            </button>
          </form>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <StatBox label="Subscribers" value={formatNum(channel.subscribers)} color="#2563EB" soft="#E5EDFD" />
        <StatBox label="Total views"  value={formatNum(channel.totalViews)}  color="#15924B" soft="#E0F2E8" />
        <StatBox label="Videos"       value={String(channel.videoCount ?? 0)} color="#6D28D9" soft="#EDE7FB" />
        <StatBox label="Upload/wk"    value={(channel.uploadFrequency ?? 0).toFixed(1)} color="#D97706" soft="#FBEED5" />
        <StatBox label="Velocity"     value={(channel.velocityScore ?? 0).toFixed(1)} color="#E5482F" soft="#FDE7E1" icon={<TrendingUp className="w-3.5 h-3.5" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top videos */}
        <section className="card lg:col-span-2">
          <div className="flex items-center mb-3">
            <h2 className="font-mono text-[14px] font-bold flex items-center gap-2"><Eye className="w-4 h-4" style={{ color: "#D97706" }} /> Top videos</h2>
            <span className="flex-1" />
            <form>
              <select name="sort" defaultValue={sort} className="border border-[var(--line-2)] rounded-md px-2 py-1 text-xs font-mono">
                <option value="outlier">Highest outlier</option>
                <option value="views">Most views</option>
              </select>
            </form>
          </div>
          <ul className="m-0 p-0">
            {channel.videos.map((v) => (
              <li key={v.id} className="border-t border-[var(--line)] first:border-t-0 py-2.5 flex items-center gap-3">
                <span className="font-mono font-bold text-[11px] px-2 py-1 rounded-md whitespace-nowrap" style={{ background: outlierBand(v.outlierScore).soft, color: outlierBand(v.outlierScore).color }}>
                  {v.outlierScore?.toFixed(1)}x
                </span>
                <div className="flex-1 min-w-0">
                  <Link href={`/intel/videos/${v.id}`} className="font-semibold text-sm hover:text-[var(--accent)] line-clamp-1">{v.title}</Link>
                  <div className="text-xs text-[var(--mute)] flex items-center gap-2">
                    <span><Calendar className="inline w-3 h-3" /> {v.publishedAt?.toISOString().slice(0, 10) ?? "—"}</span>
                    <span>· {formatNum(v.views)} views</span>
                    <span>· {v.format}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Outliers + avg */}
        <aside className="flex flex-col gap-3">
          <section className="card">
            <h2 className="font-mono text-[14px] font-bold mb-2 flex items-center gap-2"><TrendingUp className="w-4 h-4" style={{ color: "#E5482F" }} /> Outliers (≥ 2x)</h2>
            {outlierVideos.length === 0 && <p className="text-xs text-[var(--mute)]">No outliers in the indexed slice.</p>}
            <ul className="m-0 p-0">
              {outlierVideos.map((v) => (
                <li key={v.id} className="border-t border-[var(--line)] first:border-t-0 py-2 flex items-center gap-2 text-xs">
                  <span className="font-mono font-bold px-1.5 py-0.5 rounded-md" style={{ background: outlierBand(v.outlierScore).soft, color: outlierBand(v.outlierScore).color }}>{v.outlierScore?.toFixed(1)}x</span>
                  <Link href={`/intel/videos/${v.id}`} className="flex-1 truncate hover:text-[var(--accent)]">{v.title}</Link>
                </li>
              ))}
            </ul>
          </section>
          <section className="card">
            <h2 className="font-mono text-[14px] font-bold mb-2">Average per video</h2>
            <div className="text-2xl font-mono font-bold">{formatNum(avgViews)} <span className="text-xs text-[var(--mute)] font-normal">views</span></div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function StatBox({ label, value, color, soft, icon }: { label: string; value: string; color: string; soft: string; icon?: React.ReactNode }) {
  return (
    <div className="card relative overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: color }} />
      <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] flex items-center gap-1">{icon}{label}</div>
      <div className="font-mono font-bold text-2xl mt-1" style={{ color }}>{value}</div>
    </div>
  );
}
