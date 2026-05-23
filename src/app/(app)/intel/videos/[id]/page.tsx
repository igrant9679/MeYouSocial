import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bookmark, Eye, ThumbsUp, MessageSquare, Calendar } from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { outlierBand, viewsPerSubBand, formatNum } from "@/lib/intel";
import { toggleBookmarkAction } from "@/app/actions/bookmarks";
import { chatWithEntityAction } from "@/app/actions/intel";
import { MessageCircle } from "lucide-react";

// FR-INTEL-08 — Video detail view: views/engagement, outlier, views/sub, title, thumbnail.

export default async function IntelVideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await requireMembership();
  const video = await db.intelVideo.findUnique({
    where: { id },
    include: { intelChannel: true },
  });
  if (!video) notFound();

  const bookmarked = await db.bookmark.findFirst({ where: { workspaceId: workspace.id, intelVideoId: id } });
  const band = outlierBand(video.outlierScore);
  const vsBand = viewsPerSubBand(video.viewsPerSub);

  return (
    <div>
      <Link href={`/intel/channels/${video.intelChannelId}`} className="text-xs font-mono text-[var(--mute)] hover:text-[var(--accent)] flex items-center gap-1 mb-3"><ArrowLeft className="w-3 h-3" /> {video.intelChannel.name}</Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Hero */}
        <section className="card lg:col-span-2">
          <div className="aspect-video rounded-xl mb-4 grid place-items-center text-white font-mono font-bold text-lg" style={{ background: "linear-gradient(135deg," + band.color + "," + band.color + "AA)" }}>
            <div className="text-center">
              <div className="text-3xl">{video.outlierScore?.toFixed(1)}x</div>
              <div className="text-xs opacity-80 uppercase tracking-wider">{band.label}</div>
            </div>
          </div>
          <h1 className="font-mono font-bold text-xl leading-snug mb-2">{video.title}</h1>
          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--mute)]">
            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {video.publishedAt?.toISOString().slice(0, 10) ?? "—"}</span>
            <span>{video.format}</span>
            <span>{Math.floor((video.durationSeconds ?? 0) / 60)}:{String((video.durationSeconds ?? 0) % 60).padStart(2, "0")}</span>
          </div>
        </section>

        {/* Sidebar stats */}
        <aside className="flex flex-col gap-3">
          <div className="card flex items-center gap-3">
            <span className="w-12 h-12 rounded-xl text-white grid place-items-center font-mono font-bold" style={{ background: "linear-gradient(135deg,#6D28D9,#4F46E5)" }}>{(video.intelChannel.name ?? "??").slice(0, 2).toUpperCase()}</span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm truncate">{video.intelChannel.name}</div>
              <div className="text-xs text-[var(--mute)]">{formatNum(video.intelChannel.subscribers)} subs</div>
            </div>
            <Link href={`/intel/channels/${video.intelChannelId}`} className="btn sm">View</Link>
          </div>

          <Stat icon={<Eye className="w-4 h-4" />} label="Views" value={formatNum(video.views)} color="#2563EB" soft="#E5EDFD" />
          <Stat icon={<ThumbsUp className="w-4 h-4" />} label="Likes" value={formatNum(video.likes)} color="#15924B" soft="#E0F2E8" />
          <Stat icon={<MessageSquare className="w-4 h-4" />} label="Comments" value={formatNum(video.comments)} color="#D97706" soft="#FBEED5" />

          <div className="card">
            <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] mb-1">Outlier score (FR-INTEL-05)</div>
            <div className="font-mono font-bold text-2xl flex items-center gap-2" style={{ color: band.color }}>
              {video.outlierScore?.toFixed(1)}x
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: band.soft, color: band.color }}>{band.label}</span>
            </div>
            <p className="text-xs text-[var(--mute)] mt-2">Views ÷ avg of surrounding videos on the same channel.</p>
          </div>

          {vsBand && (
            <div className="card">
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] mb-1">Views/Sub ratio</div>
              <div className="font-mono font-bold text-2xl flex items-center gap-2" style={{ color: vsBand.color }}>
                {video.viewsPerSub?.toFixed(2)}
                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: vsBand.soft, color: vsBand.color }}>{vsBand.label}</span>
              </div>
              <p className="text-xs text-[var(--mute)] mt-2">Reach beyond the channel's subscriber base.</p>
            </div>
          )}

          <form action={toggleBookmarkAction}>
            <input type="hidden" name="intelVideoId" value={video.id} />
            <button type="submit" className="btn w-full flex items-center justify-center gap-2">
              <Bookmark className="w-4 h-4" fill={bookmarked ? "currentColor" : "none"} />
              {bookmarked ? "Bookmarked" : "Bookmark"}
            </button>
          </form>
          <form action={chatWithEntityAction}>
            <input type="hidden" name="kind" value="video" />
            <input type="hidden" name="entityId" value={video.id} />
            <button type="submit" className="btn w-full flex items-center justify-center gap-2" title="Open a chat scoped to this video (FR-INTEL-10)">
              <MessageCircle className="w-4 h-4" /> Chat with video
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, color, soft }: { icon: React.ReactNode; label: string; value: string; color: string; soft: string }) {
  return (
    <div className="card flex items-center gap-3">
      <span className="w-9 h-9 rounded-xl grid place-items-center" style={{ background: soft, color }}>{icon}</span>
      <div className="flex-1">
        <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">{label}</div>
        <div className="font-mono font-bold text-lg" style={{ color }}>{value}</div>
      </div>
    </div>
  );
}
