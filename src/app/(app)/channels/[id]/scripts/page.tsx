import Link from "next/link";
import { requireChannel } from "@/lib/channel";
import { db } from "@/lib/db";

// Channel-scoped scripts list (FR-CANV-15 surface, per-channel slice).

export default async function ChannelScriptsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireChannel(id);
  const scripts = await db.script.findMany({
    where: { channelId: id },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h1 className="font-mono text-xl font-bold">Scripts</h1>
        <span className="text-sm text-[var(--mute)]">{scripts.length} total</span>
        <div className="flex-1" />
        <Link href="/scripts/new" className="btn primary sm">+ New script</Link>
      </div>

      {scripts.length === 0 && <p className="card text-sm text-[var(--mute)]">No scripts in this channel yet.</p>}
      <ul className="m-0 p-0">
        {scripts.map((s) => (
          <li key={s.id} className="border-t border-[var(--line)] first:border-t-0 py-3 flex items-center gap-3 text-sm">
            <span className="tag">{s.workflow}</span>
            <span className="font-semibold">{s.title}</span>
            <span className="text-xs text-[var(--mute)]">{s.wordCount} words · {s.status}</span>
            <span className="flex-1" />
            <Link href={`/scripts/${s.id}`} className="btn sm">Open</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
