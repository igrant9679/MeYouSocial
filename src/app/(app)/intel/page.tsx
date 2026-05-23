import Link from "next/link";
import { Telescope, TrendingUp, Bookmark, Sparkles, Eye } from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { searchIntel, outlierBand, isFastGrowing, formatNum } from "@/lib/intel";
import { toggleBookmarkAction } from "@/app/actions/bookmarks";
import { autoIndexHandleAction } from "@/app/actions/intel";

// MU-02 — Intel dashboard. Implements:
//   FR-INTEL-01 NL search · FR-INTEL-03 explicit filters · FR-INTEL-04 velocity tag
//   FR-INTEL-05 outlier severity bands · FR-INTEL-11 bookmark · FR-INTEL-13 curated modules

export default async function IntelPage({ searchParams }: { searchParams: Promise<{ q?: string; subsMin?: string; subsMax?: string; velocityMin?: string; format?: string; language?: string }> }) {
  const { workspace } = await requireMembership();
  const sp = await searchParams;

  const params = {
    q: sp.q,
    subsMin: sp.subsMin ? Number(sp.subsMin) : undefined,
    subsMax: sp.subsMax ? Number(sp.subsMax) : undefined,
    velocityMin: sp.velocityMin ? Number(sp.velocityMin) : undefined,
    language: sp.language,
    format: (sp.format === "short" || sp.format === "long" ? sp.format : "") as "" | "short" | "long",
  };

  const [{ channels, videos, biasChannels }, bookmarked, trending, hotChannels, byCategory] = await Promise.all([
    searchIntel(params),
    db.bookmark.findMany({ where: { workspaceId: workspace.id }, select: { intelChannelId: true, intelVideoId: true } }),
    db.intelVideo.findMany({
      where: { outlierScore: { gte: 2 } },
      orderBy: { outlierScore: "desc" },
      take: 6,
      include: { intelChannel: true },
    }),
    // FR-INTEL-13 — Hot new channels (high velocity, smaller subs)
    db.intelChannel.findMany({
      where: { velocityScore: { gte: 5 } },
      orderBy: { velocityScore: "desc" },
      take: 4,
    }),
    // FR-INTEL-13 — Trending niches (category counts)
    db.intelChannel.groupBy({
      by: ["category"],
      _count: { _all: true },
      orderBy: { _count: { id: "desc" } },
      take: 6,
    }),
  ]);

  const bookmarkedChannels = new Set(bookmarked.map((b) => b.intelChannelId).filter(Boolean) as string[]);
  const bookmarkedVideos = new Set(bookmarked.map((b) => b.intelVideoId).filter(Boolean) as string[]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "#E5EDFD", color: "#2563EB" }}>
          <Telescope className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-2xl leading-tight">Intel</h1>
          <p className="text-xs text-[var(--mute)]">Search 100K+ indexed channels and videos. Outliers, velocity, deep filters.</p>
        </div>
        <span className="flex-1" />
        <Link href="/intel/bookmarks" className="btn sm flex items-center gap-2"><Bookmark className="w-3.5 h-3.5" /> Bookmarks</Link>
      </div>

      {/* Search + filters */}
      <form className="card mb-5 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 flex-1 min-w-[220px]">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Search</span>
          <input name="q" defaultValue={params.q ?? ""} placeholder="e.g. productivity channels, AI experiments, faceless niches" className="border border-[var(--line-2)] rounded-lg p-2.5 text-sm" />
        </label>
        <NumField name="subsMin" label="Subs min" defaultValue={params.subsMin} />
        <NumField name="subsMax" label="Subs max" defaultValue={params.subsMax} />
        <NumField name="velocityMin" label="Velocity ≥" defaultValue={params.velocityMin} step={0.5} />
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Format</span>
          <select name="format" defaultValue={params.format ?? ""} className="border border-[var(--line-2)] rounded-lg p-2.5 text-sm">
            <option value="">Both</option>
            <option value="long">Long-form</option>
            <option value="short">Shorts</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Language</span>
          <input name="language" defaultValue={params.language ?? ""} placeholder="en" className="border border-[var(--line-2)] rounded-lg p-2.5 text-sm w-16" />
        </label>
        <button type="submit" className="btn primary">Search</button>
      </form>

      {/* Curated dashboard modules (FR-INTEL-13) */}
      {!params.q && (
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 mb-5">
          {trending.length > 0 && (
            <section className="card">
              <h2 className="font-mono text-[14px] font-bold mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4" style={{ color: "#E5482F" }} /> Outlier videos this week
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {trending.map((v) => (
                  <Link key={v.id} href={`/intel/videos/${v.id}`} className="card border hover:border-[var(--accent)] hover:shadow-md transition">
                    <div className="flex items-center gap-2 mb-2">
                      <OutlierBadge score={v.outlierScore ?? 0} />
                      <span className="text-xs text-[var(--mute)] font-mono">{v.format}</span>
                    </div>
                    <div className="font-semibold text-sm leading-snug mb-2 line-clamp-2">{v.title}</div>
                    <div className="text-xs text-[var(--mute)]">{v.intelChannel.name} · {formatNum(v.views)} views</div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <div className="flex flex-col gap-3">
            {hotChannels.length > 0 && (
              <section className="card">
                <h2 className="font-mono text-[13px] font-bold mb-2 flex items-center gap-2">
                  <TrendingUp className="w-3.5 h-3.5" style={{ color: "#E5482F" }} /> Hot new channels
                </h2>
                <ul className="m-0 p-0">
                  {hotChannels.map((c) => (
                    <li key={c.id} className="border-t border-[var(--line)] first:border-t-0 py-2 flex items-center gap-2 text-xs">
                      <span className="font-mono font-bold text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#FDE7E1", color: "#E5482F" }}>{c.velocityScore?.toFixed(1)}</span>
                      <Link href={`/intel/channels/${c.id}`} className="flex-1 truncate hover:text-[var(--accent)]">{c.name}</Link>
                      <span className="text-[var(--mute)]">{formatNum(c.subscribers)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {byCategory.length > 0 && (
              <section className="card">
                <h2 className="font-mono text-[13px] font-bold mb-2 flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5" style={{ color: "#6D28D9" }} /> Trending niches
                </h2>
                <ul className="m-0 p-0">
                  {byCategory.filter((c) => c.category).map((c) => (
                    <li key={c.category ?? "—"} className="border-t border-[var(--line)] first:border-t-0 py-1.5 flex items-center gap-2 text-xs">
                      <Link href={`/intel?q=${encodeURIComponent(c.category ?? "")}`} className="flex-1 hover:text-[var(--accent)]">{c.category}</Link>
                      <span className="text-[var(--mute)]">{c._count._all} ch</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}

      {/* Results — Channels */}
      {(biasChannels || channels.length > 0) && (
        <section className="card mb-5">
          <h2 className="font-mono text-[14px] font-bold mb-3 flex items-center gap-2">
            <Sparkles className="w-4 h-4" style={{ color: "#6D28D9" }} /> Channels <span className="text-[var(--mute)] text-xs font-normal">({channels.length})</span>
          </h2>
          <ul className="m-0 p-0 grid grid-cols-1 md:grid-cols-2 gap-2">
            {channels.map((c) => (
              <li key={c.id} className="border border-[var(--line)] rounded-xl p-3 flex items-center gap-3 hover:border-[var(--accent)] transition">
                <span className="w-10 h-10 rounded-xl text-white grid place-items-center font-mono font-bold text-sm" style={{ background: "linear-gradient(135deg,#6D28D9,#4F46E5)" }}>{(c.name ?? "??").slice(0, 2).toUpperCase()}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate flex items-center gap-1.5">
                    {c.name}
                    {isFastGrowing(c.velocityScore) && (
                      <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md" style={{ background: "#FDE7E1", color: "#E5482F" }}>▲ FAST</span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--mute)]">{c.handle} · {formatNum(c.subscribers)} subs · velocity {c.velocityScore?.toFixed(1)}</div>
                </div>
                <Link href={`/intel/channels/${c.id}`} className="btn sm">Open</Link>
                <form action={toggleBookmarkAction}>
                  <input type="hidden" name="intelChannelId" value={c.id} />
                  <button type="submit" className="btn sm" title="Bookmark">
                    <Bookmark className="w-3.5 h-3.5" fill={bookmarkedChannels.has(c.id) ? "currentColor" : "none"} />
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Results — Videos */}
      {videos.length > 0 && (
        <section className="card">
          <h2 className="font-mono text-[14px] font-bold mb-3 flex items-center gap-2">
            <Eye className="w-4 h-4" style={{ color: "#D97706" }} /> Videos <span className="text-[var(--mute)] text-xs font-normal">({videos.length})</span> <span className="text-[10px] text-[var(--mute)] font-mono">sorted by outlier</span>
          </h2>
          <ul className="m-0 p-0">
            {videos.map((v) => (
              <li key={v.id} className="border-t border-[var(--line)] first:border-t-0 py-3 flex items-center gap-3">
                <OutlierBadge score={v.outlierScore ?? 0} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{v.title}</div>
                  <div className="text-xs text-[var(--mute)]">
                    {v.intelChannel.name} · {formatNum(v.views)} views · {v.format}
                    {v.viewsPerSub != null && <span> · v/s {v.viewsPerSub.toFixed(2)}</span>}
                  </div>
                </div>
                <Link href={`/intel/videos/${v.id}`} className="btn sm">Open</Link>
                <form action={toggleBookmarkAction}>
                  <input type="hidden" name="intelVideoId" value={v.id} />
                  <button type="submit" className="btn sm" title="Bookmark">
                    <Bookmark className="w-3.5 h-3.5" fill={bookmarkedVideos.has(v.id) ? "currentColor" : "none"} />
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {channels.length === 0 && videos.length === 0 && (
        <div className="card text-center py-12">
          <p className="text-sm text-[var(--mute)] mb-3">No matches. Try a broader search or relax your filters.</p>
          {params.q?.trim().startsWith("@") && (
            <form action={autoIndexHandleAction} className="flex items-center gap-2 justify-center">
              <input type="hidden" name="handle" value={params.q} />
              <button type="submit" className="btn primary sm">Auto-index <code className="font-mono">{params.q}</code> now (FR-INTEL-12)</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function NumField({ name, label, defaultValue, step }: { name: string; label: string; defaultValue?: number; step?: number }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">{label}</span>
      <input type="number" name={name} step={step ?? 1} defaultValue={defaultValue ?? ""} className="border border-[var(--line-2)] rounded-lg p-2.5 text-sm w-24" />
    </label>
  );
}

function OutlierBadge({ score }: { score: number }) {
  const band = outlierBand(score);
  return (
    <span className="font-mono font-bold text-[11px] px-2 py-1 rounded-md whitespace-nowrap" style={{ background: band.soft, color: band.color }} title={band.label}>
      {score.toFixed(1)}x
    </span>
  );
}
