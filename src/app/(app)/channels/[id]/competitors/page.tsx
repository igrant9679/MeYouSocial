import Link from "next/link";
import { Search, Plus, Check } from "lucide-react";
import { requireChannel } from "@/lib/channel";
import { SubmitButton } from "@/components/SubmitButton";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { youtubeFor } from "@/lib/youtube";
import { addCompetitorAction, removeCompetitorAction } from "@/app/actions/competitors";
import { ChannelAvatar } from "@/components/ChannelAvatar";

// Add / search / remove tracked competitor channels.
//
// Search exists because the add box needed a handle you already knew — fine if
// you're pasting one, useless if you're trying to work out who your competitors
// even are. `searchChannels` was already implemented on the provider and used
// by Intel; this surface just never offered it.

export default async function ChannelCompetitorsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { id } = await params;
  const { workspace } = await requireChannel(id);
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  const competitors = await db.competitor.findMany({
    where: { channelId: id },
    orderBy: { createdAt: "asc" },
  });
  // Only search when asked — this is a real YouTube call and costs quota.
  const results = query ? await youtubeFor(workspace.id).searchChannels(query, 8).catch(() => []) : [];
  const trackedIds = new Set(competitors.map((c) => c.youtubeId).filter(Boolean) as string[]);

  return (
    <div className="w-full">
      <h1 className="font-mono text-xl font-bold mb-1">Competitors</h1>
      <p className="text-xs text-[var(--mute)] mb-3">
        Tracked channels feed Intel and seed idea discovery — an idea&apos;s outlier score is a competitor video&apos;s
        views against that channel&apos;s own average.
      </p>

      {/* Search by name — the path for "who else does this?" */}
      <form className="card flex gap-2 items-end mb-3">
        <label className="flex flex-col gap-1 flex-1">
          <span className="text-xs font-mono uppercase text-[var(--mute)]">Search YouTube by name or topic</span>
          <input
            name="q"
            defaultValue={query}
            placeholder="e.g. nonprofit fundraising, grant management"
            className="border border-[var(--line-2)] rounded-lg p-2 text-sm"
          />
        </label>
        <SubmitButton className="btn primary sm" pendingText="Searching…">
          <Search className="w-3.5 h-3.5" /> Search
        </SubmitButton>
      </form>

      {query && (
        <div className="card mb-4">
          <div className="text-xs font-mono uppercase text-[var(--mute)] mb-2">
            {results.length} result{results.length === 1 ? "" : "s"} for “{query}”
          </div>
          {results.length === 0 ? (
            <p className="text-sm text-[var(--mute)]">
              Nothing came back. Try a broader term, or add an exact @handle below.
            </p>
          ) : (
            <ul className="m-0 p-0 flex flex-col gap-2">
              {results.map((r) => {
                const tracked = trackedIds.has(r.id);
                return (
                  <li key={r.id} className="flex items-center gap-3 border-t border-[var(--line)] first:border-t-0 pt-2 first:pt-0">
                    <ChannelAvatar name={r.name} url={r.thumbnailUrl} size={40} />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate">{r.name}</div>
                      <div className="text-[11px] text-[var(--mute)] font-mono truncate">
                        {r.handle ?? r.id} · {r.subscribers.toLocaleString()} subs · {r.videoCount.toLocaleString()} videos
                      </div>
                    </div>
                    {tracked ? (
                      <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded flex items-center gap-1" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}>
                        <Check className="w-3 h-3" /> tracked
                      </span>
                    ) : (
                      <form action={addCompetitorAction}>
                        <input type="hidden" name="channelId" value={id} />
                        {/* Pass the resolved id, not the name — re-resolving a
                            display name through search can land on a different
                            channel than the one just clicked. */}
                        <input type="hidden" name="youtubeId" value={r.id} />
                        <SubmitButton className="btn sm" pendingText="Adding…">
                          <Plus className="w-3.5 h-3.5" /> Track
                        </SubmitButton>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Exact handle — kept, because findChannel resolves a handle precisely
          while search returns best guesses. */}
      <form action={addCompetitorAction} className="card flex gap-2 items-end mb-4">
        <input type="hidden" name="channelId" value={id} />
        <label className="flex flex-col gap-1 flex-1">
          <span className="text-xs font-mono uppercase text-[var(--mute)]">…or add by exact YouTube @handle or URL</span>
          <input name="handle" required placeholder="@example" className="border border-[var(--line-2)] rounded-lg p-2 text-sm font-mono" />
        </label>
        <SubmitButton className="btn sm" pendingText="Adding…">Add</SubmitButton>
      </form>

      <h2 className="font-mono text-sm font-bold mb-2">Tracked ({competitors.length})</h2>
      {competitors.length === 0 && (
        <p className="text-sm text-[var(--mute)]">None tracked yet — search above to find some.</p>
      )}
      <ul className="m-0 p-0">
        {competitors.map((c) => {
          const m = readJson<{ subs?: number; views?: number; name?: string; thumb?: string }>(c.metricsSnapshot, {});
          return (
            <li key={c.id} className="card flex items-center gap-3 mb-2">
              <ChannelAvatar name={m.name ?? c.youtubeHandle} url={m.thumb} size={40} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate">{m.name ?? c.youtubeHandle ?? c.youtubeId}</div>
                <div className="text-xs text-[var(--mute)] font-mono">
                  {c.youtubeHandle ?? c.youtubeId} · {(m.subs ?? 0).toLocaleString()} subs · {(m.views ?? 0).toLocaleString()} views
                </div>
              </div>
              {c.youtubeId && (
                <Link href={`/intel?q=${encodeURIComponent(c.youtubeHandle ?? c.youtubeId)}`} className="btn sm">
                  Intel
                </Link>
              )}
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
