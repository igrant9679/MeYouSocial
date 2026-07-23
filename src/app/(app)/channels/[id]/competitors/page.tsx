import { requireChannel } from "@/lib/channel";
import { SubmitButton } from "@/components/SubmitButton";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { addCompetitorAction, removeCompetitorAction } from "@/app/actions/competitors";

// Add/search/remove tracked competitor channels.

export default async function ChannelCompetitorsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireChannel(id);
  const competitors = await db.competitor.findMany({
    where: { channelId: id },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="w-full">
      <h1 className="font-mono text-xl font-bold mb-3">Competitors</h1>
      <form action={addCompetitorAction} className="card flex gap-2 items-end mb-4">
        <input type="hidden" name="channelId" value={id} />
        <label className="flex flex-col gap-1 flex-1">
          <span className="text-xs font-mono uppercase text-[var(--mute)]">Add by YouTube @handle or URL</span>
          <input name="handle" required placeholder="@example" className="border border-[var(--line-2)] rounded-lg p-2 text-sm font-mono" />
        </label>
        <SubmitButton className="btn primary sm">Add</SubmitButton>
      </form>

      {competitors.length === 0 && <p className="text-sm text-[var(--mute)]">None tracked yet.</p>}
      <ul className="m-0 p-0">
        {competitors.map((c) => {
          const m = readJson<{ subs?: number; views?: number }>(c.metricsSnapshot, {});
          return (
            <li key={c.id} className="card flex items-center gap-3 mb-2">
              <div className="flex-1 min-w-0">
                <div className="font-semibold font-mono text-sm">{c.youtubeHandle ?? c.youtubeId}</div>
                <div className="text-xs text-[var(--mute)]">{(m.subs ?? 0).toLocaleString()} subs · {(m.views ?? 0).toLocaleString()} views</div>
              </div>
              <form action={removeCompetitorAction}>
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="channelId" value={id} />
                <button type="submit" className="btn sm">Remove</button>
              </form>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
