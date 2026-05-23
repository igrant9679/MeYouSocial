import Link from "next/link";
import { ArrowLeft, PenLine, Archive } from "lucide-react";
import { notFound } from "next/navigation";
import { requireChannel } from "@/lib/channel";
import { db } from "@/lib/db";
import { outlierBand, formatNum } from "@/lib/intel";
import { writeIdeaToCanvasAction, updateIdeaStatusAction } from "@/app/actions/ideas";

// FR-IDEA-02 — Idea detail with all required fields + Write action (FR-IDEA-07).

export default async function IdeaDetailPage({ params }: { params: Promise<{ id: string; ideaId: string }> }) {
  const { id, ideaId } = await params;
  await requireChannel(id);

  const idea = await db.idea.findFirst({
    where: { id: ideaId, channelId: id },
    include: { sourceVideo: { include: { intelChannel: true } } },
  });
  if (!idea) notFound();

  const band = outlierBand(idea.outlierScore);

  return (
    <div className="max-w-3xl">
      <Link href={`/channels/${id}/ideas`} className="text-xs font-mono text-[var(--mute)] hover:text-[var(--accent)] flex items-center gap-1 mb-3"><ArrowLeft className="w-3 h-3" /> Back to Ideas</Link>

      <div className="card mb-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="font-mono font-bold text-[11px] px-2 py-1 rounded-md" style={{ background: band.soft, color: band.color }}>{idea.outlierScore?.toFixed(1) ?? "—"}x · {band.label}</span>
          <span className="text-xs font-mono uppercase text-[var(--mute)]">{idea.status}</span>
          {idea.suggestedLength && <span className="text-xs text-[var(--mute)]">· {idea.suggestedLength}</span>}
        </div>
        <h1 className="font-mono font-bold text-2xl leading-tight mb-3">{idea.title}</h1>
        {idea.topic && (<>
          <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--mute)] mt-3">Topic</h3>
          <p className="text-sm">{idea.topic}</p>
        </>)}
        {idea.strategy && (<>
          <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--mute)] mt-3">Strategy / why it works</h3>
          <p className="text-sm whitespace-pre-wrap">{idea.strategy}</p>
        </>)}
      </div>

      {idea.sourceVideo && (
        <div className="card mb-4">
          <h2 className="font-mono text-[14px] font-bold mb-2">Source outlier</h2>
          <div className="flex items-center gap-3">
            <span className="font-mono font-bold text-[11px] px-2 py-1 rounded-md" style={{ background: outlierBand(idea.sourceVideo.outlierScore).soft, color: outlierBand(idea.sourceVideo.outlierScore).color }}>
              {idea.sourceVideo.outlierScore?.toFixed(1)}x
            </span>
            <div className="flex-1 min-w-0">
              <Link href={`/intel/videos/${idea.sourceVideo.id}`} className="font-semibold text-sm hover:text-[var(--accent)] truncate block">{idea.sourceVideo.title}</Link>
              <div className="text-xs text-[var(--mute)]">{idea.sourceVideo.intelChannel.name} · {formatNum(idea.sourceVideo.views)} views</div>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <form action={writeIdeaToCanvasAction}>
          <input type="hidden" name="ideaId" value={idea.id} />
          <button type="submit" className="btn primary flex items-center gap-2"><PenLine className="w-4 h-4" /> Write this</button>
        </form>
        <form action={updateIdeaStatusAction}>
          <input type="hidden" name="ideaId" value={idea.id} />
          <input type="hidden" name="status" value="archived" />
          <button type="submit" className="btn flex items-center gap-2"><Archive className="w-4 h-4" /> Archive</button>
        </form>
      </div>
    </div>
  );
}
