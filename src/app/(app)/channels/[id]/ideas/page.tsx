import Link from "next/link";
import { PenLine } from "lucide-react";
import { requireChannel } from "@/lib/channel";
import { db } from "@/lib/db";
import { outlierBand } from "@/lib/intel";
import { regenerateIdeasAction, writeIdeaToCanvasAction } from "@/app/actions/ideas";

// MU-06 — Ideas Library. FR-IDEA-03 list with sort/filter; FR-IDEA-09 regenerate.

export default async function ChannelIdeasPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sort?: string; status?: string }>;
}) {
  const { id } = await params;
  const { sort = "newest", status } = await searchParams;
  await requireChannel(id);

  const ideas = await db.idea.findMany({
    where: { channelId: id, ...(status ? { status } : {}) },
    orderBy: sort === "outlier"
      ? [{ outlierScore: "desc" }]
      : [{ createdAt: "desc" }],
    take: 50,
  });

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
          <button type="submit" className="btn primary sm">Regenerate</button>
        </form>
      </div>

      {ideas.length === 0 && (
        <div className="card text-center py-10">
          <p className="text-sm text-[var(--mute)] mb-3">No ideas yet.</p>
          <form action={regenerateIdeasAction}>
            <input type="hidden" name="channelId" value={id} />
            <button type="submit" className="btn primary">Generate 10 ideas</button>
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
              <div className="flex gap-2">
                <form action={writeIdeaToCanvasAction}>
                  <input type="hidden" name="ideaId" value={i.id} />
                  <button type="submit" className="btn primary sm flex items-center gap-1.5"><PenLine className="w-3.5 h-3.5" /> Write</button>
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
