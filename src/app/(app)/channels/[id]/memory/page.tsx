import { Brain, Plus, Trash2 } from "lucide-react";
import { requireChannel } from "@/lib/channel";
import { db } from "@/lib/db";
import { addMemoryEntryAction, removeMemoryEntryAction } from "@/app/actions/memory";

// MU — Channel Memory. FR-CHAN-06.

export default async function ChannelMemoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireChannel(id);
  const entries = await db.channelMemoryEntry.findMany({
    where: { channelId: id },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-4">
        <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: "#EDE7FB", color: "#6D28D9" }}>
          <Brain className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div>
          <h2 className="font-mono font-bold text-lg leading-tight">Channel Memory</h2>
          <p className="text-xs text-[var(--mute)]">Durable facts the AI auto-applies across every script in this channel. <b>Don't repeat yourself in chat.</b></p>
        </div>
      </div>

      <form action={addMemoryEntryAction} className="card flex flex-col gap-2 mb-4">
        <input type="hidden" name="channelId" value={id} />
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Add fact / preference (≤ 600 chars)</span>
          <textarea name="body" required maxLength={600} rows={3}
            placeholder="e.g. Always cite original papers, not blog summaries. Avoid the word 'literally'. My audience already knows what compounding is."
            className="border border-[var(--line-2)] rounded-lg p-2 text-sm" />
        </label>
        <div className="flex justify-end"><button type="submit" className="btn primary sm flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Remember this</button></div>
      </form>

      {entries.length === 0 ? (
        <div className="card text-center py-10 text-sm text-[var(--mute)]">No memory entries yet.</div>
      ) : (
        <ul className="m-0 p-0">
          {entries.map((e) => (
            <li key={e.id} className="border border-[var(--line)] rounded-lg p-3 mb-2 flex items-start gap-3 bg-white">
              <Brain className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "#6D28D9" }} />
              <div className="flex-1 text-sm whitespace-pre-wrap">{e.body}</div>
              <form action={removeMemoryEntryAction}>
                <input type="hidden" name="id" value={e.id} />
                <input type="hidden" name="channelId" value={id} />
                <button type="submit" className="btn sm" title="Forget"><Trash2 className="w-3.5 h-3.5" /></button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
