import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { PenLine, Tags } from "lucide-react";
import { requireChannel } from "@/lib/channel";
import { db } from "@/lib/db";
import { outlierBand } from "@/lib/intel";
import { regenerateIdeasAction, writeIdeaToCanvasAction, setIdeaTopicAction } from "@/app/actions/ideas";

// MU-06 — Ideas Library. list with sort/filter; regenerate.

export default async function ChannelIdeasPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sort?: string; status?: string }>;
}) {
  const { id } = await params;
  const { sort = "newest", status } = await searchParams;
  const { workspace } = await requireChannel(id);
  const [ideas, topics] = await Promise.all([
    db.idea.findMany({
      where: { channelId: id, ...(status ? { status } : {}) },
      orderBy: sort === "outlier"
        ? [{ outlierScore: "desc" }]
        : [{ createdAt: "desc" }],
      take: 50,
      include: { workspaceTopic: { select: { name: true } } },
    }),
    db.topic.findMany({
      where: { workspaceId: workspace.id, status: "active" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h1 className="font-mono text-xl font-bold">Ideas</h1>
        <span className="text-sm text-[var(--mute)]">{ideas.length} total</span>
        <div className="flex-1" />
        <form>
          <select name="sort" defaultValue={sort} className="border border-[var(--line-2)] rounded-md px-2 py-1 text-xs font-mono">
            <option value="newest">Newest</option>
            <option value="outlier">Highest outlier</option>
          </select>
        </form>
        <form action={regenerateIdeasAction}>
          <input type="hidden" name="channelId" value={id} />
          <SubmitButton className="btn primary sm">Regenerate</SubmitButton>
        </form>
      </div>

      {ideas.length === 0 && (
        <div className="card text-center py-10">
          <p className="text-sm text-[var(--mute)] mb-3">No ideas yet.</p>
          <form action={regenerateIdeasAction}>
            <input type="hidden" name="channelId" value={id} />
            <SubmitButton className="btn primary">Generate 10 ideas</SubmitButton>
          </form>
        </div>
      )}

      <ul className="m-0 p-0 grid grid-cols-1 md:grid-cols-2 gap-3">
        {ideas.map((i) => {
          const band = outlierBand(i.outlierScore);
          return (
            <li key={i.id} className="card hover:shadow-md transition">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono font-bold text-[11px] px-2 py-1 rounded-md" style={{ background: band.soft, color: band.color }}>{i.outlierScore?.toFixed(1) ?? "—"}x</span>
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">{i.status}</span>
                <span className="flex-1" />
                <span className="text-xs text-[var(--mute)]">{i.suggestedLength ?? "—"}</span>
              </div>
              <Link href={`/channels/${id}/ideas/${i.id}`} className="font-semibold block mb-2 hover:text-[var(--accent)]">{i.title}</Link>
              {i.strategy && <div className="text-xs text-[var(--mute)] mb-3 line-clamp-2">Strategy: {i.strategy}</div>}
              {topics.length > 0 && (
                <form action={setIdeaTopicAction} className="flex items-center gap-1.5 mb-3">
                  <input type="hidden" name="ideaId" value={i.id} />
                  <Tags className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--indigo-on)" }} />
                  <select
                    name="topicId"
                    defaultValue={i.topicId ?? ""}
                    className="text-[11px] border border-[var(--line-2)] rounded-md px-1.5 py-1 flex-1 min-w-0"
                    aria-label="Topic"
                  >
                    <option value="">no topic</option>
                    {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <SubmitButton className="btn sm" pendingText="…">Set</SubmitButton>
                </form>
              )}
              <div className="flex gap-2">
                <form action={writeIdeaToCanvasAction}>
                  <input type="hidden" name="ideaId" value={i.id} />
                  <SubmitButton className="btn primary sm flex items-center gap-1.5"><PenLine className="w-3.5 h-3.5" /> Write</SubmitButton>
                </form>
                <Link href={`/channels/${id}/ideas/${i.id}`} className="btn sm">Detail</Link>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
