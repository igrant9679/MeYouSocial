import Link from "next/link";
import { ArrowLeft, KeyRound, Lightbulb, Plus, RefreshCw, Sparkles, Trash2, Wand2 } from "lucide-react";
import { requireMembership, canEdit } from "@/lib/acl";
import { db } from "@/lib/db";
import { SubmitButton } from "@/components/SubmitButton";
import { getSearchDataProvider, searchDataVendorLabel, SEARCH_DATA_COUNTRIES } from "@/lib/search-data";
import { keywordCountry } from "@/lib/keyword-volumes";
import {
  addKeywordAction,
  classifyIntentsAction,
  deleteKeywordAction,
  discoverKeywordsAction,
  ideaFromKeywordAction,
  refreshKeywordVolumesAction,
  updateKeywordAction,
} from "@/app/actions/blog-keywords";

// Keyword strategy (Wave A′). Tiers are editorial priority; intent + clusters
// are AI-classified — the page says so. Volume / competition come only from a
// connected search-data provider (lib/search-data); with none they are a dash
// with the reason, never an invented number.

const INTENT_HUE: Record<string, string> = {
  informational: "blue",
  commercial: "amber",
  transactional: "green",
  navigational: "violet",
};

type TrendPoint = { year: number; month: number; volume: number };

function parseTrend(json: string | null): TrendPoint[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Newest month vs the oldest in the stored window (≤12 months). */
function trendDelta(points: TrendPoint[]): { pct: number; span: number } | null {
  if (points.length < 2) return null;
  const first = points[0].volume;
  const last = points[points.length - 1].volume;
  if (!first) return null;
  return { pct: Math.round(((last - first) / first) * 100), span: points.length - 1 };
}

function competitionLabel(c: number): { text: string; hue: string } {
  if (c < 0.34) return { text: "low", hue: "green" };
  if (c < 0.67) return { text: "medium", hue: "amber" };
  return { text: "high", hue: "red" };
}

function Dash({ reason }: { reason: string }) {
  return <span className="text-[var(--mute)]" title={reason}>—</span>;
}

export default async function KeywordsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { workspace, membership } = await requireMembership();
  const editor = canEdit(membership.role);
  const { ok, err } = await searchParams;
  const [keywords, provider, country] = await Promise.all([
    db.keyword.findMany({
      where: { workspaceId: workspace.id },
      orderBy: [{ cluster: "asc" }, { tier: "asc" }, { phrase: "asc" }],
    }),
    getSearchDataProvider(workspace.id),
    keywordCountry(workspace.id),
  ]);

  const clusters = new Map<string, typeof keywords>();
  for (const k of keywords) {
    const key = k.cluster ?? "unclustered";
    clusters.set(key, [...(clusters.get(key) ?? []), k]);
  }
  // Within a cluster, measured volume outranks the editorial tier; unmeasured
  // rows keep the tier order beneath.
  for (const list of clusters.values()) {
    list.sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1) || a.tier - b.tier || a.phrase.localeCompare(b.phrase));
  }
  // Unclassified = no intent OR no cluster. Counting only intent hid the other
  // half of the problem: 42 rows all sitting in one "unclustered" heap (A4).
  const unclassified = keywords.filter((k) => !k.intent || !k.cluster).length;
  const noneClassified = keywords.length > 0 && unclassified === keywords.length;
  const fetched = keywords.filter((k) => k.volumeAt);
  const lastFetch = fetched.reduce<Date | null>((m, k) => (k.volumeAt && (!m || k.volumeAt > m) ? k.volumeAt : m), null);
  const source = fetched[0]?.volumeSource ?? null;
  const countryName = SEARCH_DATA_COUNTRIES.find((c) => c.code === country)?.name ?? country.toUpperCase();

  const noVolumeReason = provider
    ? "Not fetched yet — press Refresh volumes."
    : "No search-data provider connected — add a DataForSEO or Keywords Everywhere key under Publish Admin → API keys.";

  return (
    <main className="p-6 w-full">
      {/* Keywords is a tab of Ideas, so back goes to Ideas. These links still
          said "Blog" — the pre-September module hierarchy leaking through the
          stage one, and sending people to the wrong stage (audit B1.6). */}
      <Link href="/ideas" className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Ideas
      </Link>
      <div className="flex items-center gap-3 mb-1.5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
          <KeyRound className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div className="flex-1">
          <h1 className="font-mono font-bold text-2xl leading-tight">Keyword strategy</h1>
          <p className="text-xs text-[var(--mute)]">
            Tier 1 head terms → tier 4 long-tail. Intent and clusters are AI-classified.{" "}
            {provider ? (
              <>
                Volume, CPC and competition from <strong>{searchDataVendorLabel(provider.vendor)}</strong> for {countryName}
                {lastFetch ? <> — last fetched {lastFetch.toLocaleDateString("en-US", { month: "short", day: "numeric" })}{source && !source.endsWith(`· ${country}`) ? ` (${source})` : ""}.</> : " — not fetched yet."}
              </>
            ) : (
              <>
                Volume and competition arrive with a search-data provider —{" "}
                {membership.role === "ADMIN" ? (
                  <Link href="/admin/api-keys" className="underline" style={{ color: "var(--accent)" }}>add a DataForSEO or Keywords Everywhere key</Link>
                ) : (
                  "ask an admin to add a DataForSEO or Keywords Everywhere key"
                )}
                . No invented numbers.
              </>
            )}
          </p>
        </div>
      </div>

      {ok && (
        <div className="text-xs rounded-lg px-3 py-2 mb-3" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}>{ok}</div>
      )}
      {err && (
        <div className="text-xs rounded-lg px-3 py-2 mb-3" style={{ background: "var(--red-soft)", color: "var(--red-on)" }}>{err}</div>
      )}

      {editor && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <form action={discoverKeywordsAction}>
            <SubmitButton className="btn" pendingText="Discovering…">
              <Sparkles className="w-4 h-4" /> Discover keywords (AI)
            </SubmitButton>
          </form>
          {/* When some rows are classified this is one tidy-up among several.
              When NONE are, it is the only thing worth pressing — so it moves
              out of the toolbar into the banner below and is not repeated. */}
          {unclassified > 0 && !noneClassified && (
            <form action={classifyIntentsAction}>
              <SubmitButton className="btn" pendingText="Classifying…">
                <Wand2 className="w-4 h-4" /> Classify intent ({unclassified})
              </SubmitButton>
            </form>
          )}
          {provider && keywords.length > 0 && (
            <form action={refreshKeywordVolumesAction} className="flex items-center gap-1">
              <select name="country" defaultValue={country} className="text-xs" aria-label="Country for search volume" title="Which country's searches the volumes measure">
                {SEARCH_DATA_COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
              <SubmitButton className="btn" pendingText="Fetching…" title={`Fetch volume, CPC and competition for every active keyword from ${searchDataVendorLabel(provider.vendor)} (uses the vendor's credits)`}>
                <RefreshCw className="w-4 h-4" /> Refresh volumes
              </SubmitButton>
            </form>
          )}
          <span className="flex-1" />
          <form action={addKeywordAction} className="flex items-center gap-2">
            <input name="phrase" required placeholder="add a keyword…" className="text-xs w-44" />
            <select name="tier" defaultValue="3" className="text-xs" aria-label="Tier">
              {[1, 2, 3, 4].map((t) => <option key={t} value={t}>T{t}</option>)}
            </select>
            <input name="cluster" placeholder="cluster" className="text-xs w-28" />
            <button className="btn"><Plus className="w-3.5 h-3.5" /> Add</button>
          </form>
        </div>
      )}

      {/* ⚠ The one-action empty state (audit B6/D4). A table of dashes with a
          quiet secondary button nobody pressed is how 42 CommunityForce
          keywords sat unclassified for a month. Say what the dashes mean, name
          the single next step, and make it the primary button on the page. */}
      {noneClassified && editor && (
        <div className="card mb-3 flex flex-wrap items-center gap-3" style={{ background: "var(--amber-soft)" }}>
          <Lightbulb className="w-5 h-5 flex-shrink-0" style={{ color: "var(--amber-on)" }} aria-hidden />
          <p className="text-xs flex-1 min-w-60" style={{ color: "var(--amber-on)" }}>
            <strong>None of these {keywords.length} keywords are classified yet.</strong> Intent and clusters are what
            turn a flat list into a strategy — they decide which ideas get priority. One AI pass fills both.
          </p>
          <form action={classifyIntentsAction}>
            <SubmitButton className="btn primary" pendingText="Classifying…">
              <Wand2 className="w-4 h-4" /> Classify all {keywords.length}
            </SubmitButton>
          </form>
        </div>
      )}

      {keywords.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-sm mb-1">No keywords yet.</p>
          <p className="text-xs text-[var(--mute)] mb-4">
            Keywords decide which ideas get written first. Discover a starter set grounded in your organization
            profile, or add one by hand above.
          </p>
          {editor && (
            <form action={discoverKeywordsAction}>
              <SubmitButton className="btn primary" pendingText="Discovering…">
                <Sparkles className="w-4 h-4" /> Discover keywords with AI
              </SubmitButton>
            </form>
          )}
        </div>
      ) : (
        [...clusters.entries()].map(([cluster, list]) => (
          <section key={cluster} className="card mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--mute)] mb-2">
              {cluster} <span className="font-mono">({list.length})</span>
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[var(--mute)] border-b border-[var(--line)]">
                    <th className="py-1.5 pr-3 font-semibold">Keyword</th>
                    <th className="py-1.5 pr-3 font-semibold">Tier</th>
                    <th className="py-1.5 pr-3 font-semibold">Intent (AI)</th>
                    <th className="py-1.5 pr-3 font-semibold text-right" title="Average monthly searches, from the connected search-data provider">Volume / mo</th>
                    <th className="py-1.5 pr-3 font-semibold text-right" title="Change across the stored months of history (newest vs oldest)">Trend</th>
                    <th className="py-1.5 pr-3 font-semibold" title="The provider's paid-competition index, 0–100">Competition</th>
                    <th className="py-1.5 pr-3 font-semibold text-right" title="Cost per click, USD">CPC</th>
                    {editor && <th className="py-1.5 font-semibold">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {list.map((k) => {
                    const delta = trendDelta(parseTrend(k.trend));
                    const noData = k.volumeAt && k.volume == null;
                    const comp = k.competition != null ? competitionLabel(k.competition) : null;
                    return (
                      <tr key={k.id} className="border-b border-[var(--line)] last:border-0 align-middle">
                        <td className="py-1.5 pr-3">
                          <span className="font-semibold">{k.phrase}</span>
                          {k.status === "paused" && <span className="ml-1 text-[var(--mute)]">(paused)</span>}
                        </td>
                        <td className="py-1.5 pr-3 font-mono">T{k.tier}</td>
                        <td className="py-1.5 pr-3">
                          {k.intent ? (
                            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: `var(--${INTENT_HUE[k.intent] ?? "cyan"}-soft)`, color: `var(--${INTENT_HUE[k.intent] ?? "cyan"}-on)` }}>
                              {k.intent}
                            </span>
                          ) : (
                            <Dash reason="Not classified yet — press Classify intent." />
                          )}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-right">
                          {k.volume != null ? (
                            <span title={k.volumeSource ? `${k.volumeSource}, ${k.volumeAt?.toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : undefined}>{k.volume.toLocaleString()}</span>
                          ) : (
                            <Dash reason={noData ? `${k.volumeSource ?? "The provider"} had no data for this phrase.` : noVolumeReason} />
                          )}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-right">
                          {delta ? (
                            <span
                              title={`${delta.pct > 0 ? "+" : ""}${delta.pct}% over ${delta.span} months`}
                              style={{ color: delta.pct > 10 ? "var(--green-on)" : delta.pct < -10 ? "var(--red-on)" : "var(--mute)" }}
                            >
                              {delta.pct > 10 ? "▲" : delta.pct < -10 ? "▼" : "→"} {Math.abs(delta.pct)}%
                            </span>
                          ) : (
                            <Dash reason={k.volume != null ? "The provider returned no monthly history." : noData ? "No data for this phrase." : noVolumeReason} />
                          )}
                        </td>
                        <td className="py-1.5 pr-3">
                          {comp && k.competition != null ? (
                            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: `var(--${comp.hue}-soft)`, color: `var(--${comp.hue}-on)` }} title={`Index ${Math.round(k.competition * 100)} / 100`}>
                              {comp.text} · {Math.round(k.competition * 100)}
                            </span>
                          ) : (
                            <Dash reason={noData ? "No data for this phrase." : noVolumeReason} />
                          )}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-right">
                          {k.cpc != null ? `$${k.cpc.toFixed(2)}` : <Dash reason={noData ? "No data for this phrase." : noVolumeReason} />}
                        </td>
                        {editor && (
                          <td className="py-1.5">
                            <div className="flex items-center gap-1">
                              <form action={ideaFromKeywordAction}>
                                <input type="hidden" name="id" value={k.id} />
                                <button className="btn" title="Create a blog idea from this keyword"><Lightbulb className="w-3.5 h-3.5" /></button>
                              </form>
                              <form action={updateKeywordAction} className="flex items-center gap-1">
                                <input type="hidden" name="id" value={k.id} />
                                <input type="hidden" name="cluster" value={k.cluster ?? ""} />
                                <input type="hidden" name="intent" value={k.intent ?? ""} />
                                <input type="hidden" name="status" value={k.status === "active" ? "paused" : "active"} />
                                <input type="hidden" name="tier" value={k.tier} />
                                <button className="btn" title={k.status === "active" ? "Pause" : "Activate"}>
                                  {k.status === "active" ? "Pause" : "Resume"}
                                </button>
                              </form>
                              <form action={deleteKeywordAction}>
                                <input type="hidden" name="id" value={k.id} />
                                <button className="btn" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                              </form>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </main>
  );
}
