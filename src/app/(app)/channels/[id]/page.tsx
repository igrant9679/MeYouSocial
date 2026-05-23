import Link from "next/link";
import { requireChannel } from "@/lib/channel";
import { db } from "@/lib/db";

export default async function ChannelHomePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { channel } = await requireChannel(id);

  const [ideaCount, scriptCount, competitorCount] = await Promise.all([
    db.idea.count({ where: { channelId: id } }),
    db.script.count({ where: { channelId: id } }),
    db.competitor.count({ where: { channelId: id } }),
  ]);

  const recentIdeas = await db.idea.findMany({
    where: { channelId: id },
    orderBy: { createdAt: "desc" },
    take: 6,
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <section className="card lg:col-span-2">
        <h2 className="font-mono text-[15px] mb-3">About this channel</h2>
        <p className="text-sm text-[var(--ink)] whitespace-pre-wrap">{channel.nicheDescription ?? "—"}</p>
        {channel.differentiation && (
          <>
            <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--mute)] mt-4 mb-1">Differentiation</h3>
            <p className="text-sm">{channel.differentiation}</p>
          </>
        )}
        <div className="flex gap-2 mt-4">
          <Link href={`/channels/${id}/ideas`} className="btn sm">{ideaCount} ideas</Link>
          <Link href={`/channels/${id}/scripts`} className="btn sm">{scriptCount} scripts</Link>
          <Link href={`/channels/${id}/competitors`} className="btn sm">{competitorCount} competitors</Link>
        </div>
      </section>

      <section className="card">
        <h2 className="font-mono text-[15px] mb-3">Quick actions</h2>
        <div className="flex flex-col gap-2">
          <Link href={`/channels/${id}/voice`} className="btn">Edit voice profile</Link>
          <Link href={`/channels/${id}/audience`} className="btn">Edit audience avatar</Link>
          <Link href="/scripts/new" className="btn primary">Start a new script</Link>
        </div>
      </section>

      <section className="card lg:col-span-3">
        <h2 className="font-mono text-[15px] mb-3">Recent ideas</h2>
        {recentIdeas.length === 0 && <p className="text-sm text-[var(--mute)]">No ideas yet. <Link href={`/channels/${id}/ideas`} className="text-[var(--accent)] font-semibold">Generate some →</Link></p>}
        <ul className="m-0 p-0 grid grid-cols-1 md:grid-cols-2 gap-x-6">
          {recentIdeas.map((i) => (
            <li key={i.id} className="border-t border-[var(--line)] py-2 flex items-center gap-3 text-sm">
              <span className="tag">{i.outlierScore?.toFixed(1) ?? "—"}x</span>
              <span className="flex-1 truncate">{i.title}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
