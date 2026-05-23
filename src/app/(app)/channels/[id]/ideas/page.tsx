import { requireChannel } from "@/lib/channel";
import { db } from "@/lib/db";
import { regenerateIdeasAction } from "@/app/actions/ideas";

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
        {ideas.map((i) => (
          <li key={i.id} className="card">
            <div className="flex items-center gap-3 mb-1">
              <span className="tag">{i.outlierScore?.toFixed(1) ?? "—"}x</span>
              <span className="text-xs text-[var(--mute)] font-mono uppercase">{i.status}</span>
              <span className="flex-1" />
              <span className="text-xs text-[var(--mute)]">{i.suggestedLength ?? "—"}</span>
            </div>
            <div className="font-semibold mb-1">{i.title}</div>
            {i.strategy && <div className="text-xs text-[var(--mute)]">Strategy: {i.strategy}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}
