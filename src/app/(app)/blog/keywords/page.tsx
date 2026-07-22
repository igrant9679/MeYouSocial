import Link from "next/link";
import { ArrowLeft, KeyRound, Lightbulb, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { requireMembership, canEdit } from "@/lib/acl";
import { db } from "@/lib/db";
import { SubmitButton } from "@/components/SubmitButton";
import {
  addKeywordAction,
  classifyIntentsAction,
  deleteKeywordAction,
  discoverKeywordsAction,
  ideaFromKeywordAction,
  updateKeywordAction,
} from "@/app/actions/blog-keywords";

// Keyword strategy (Wave A′). Tiers are editorial priority; intent + clusters
// are AI-classified — the page says so. No invented volume/difficulty numbers.

const INTENT_HUE: Record<string, string> = {
  informational: "blue",
  commercial: "amber",
  transactional: "green",
  navigational: "violet",
};

export default async function KeywordsPage() {
  const { workspace, membership } = await requireMembership();
  const editor = canEdit(membership.role);
  const keywords = await db.keyword.findMany({
    where: { workspaceId: workspace.id },
    orderBy: [{ cluster: "asc" }, { tier: "asc" }, { phrase: "asc" }],
  });
  const clusters = new Map<string, typeof keywords>();
  for (const k of keywords) {
    const key = k.cluster ?? "unclustered";
    clusters.set(key, [...(clusters.get(key) ?? []), k]);
  }
  const missingIntent = keywords.filter((k) => !k.intent).length;

  return (
    <main className="p-6 max-w-5xl mx-auto w-full">
      <Link href="/blog" className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Blog
      </Link>
      <div className="flex items-center gap-3 mb-1.5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
          <KeyRound className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div className="flex-1">
          <h1 className="font-mono font-bold text-2xl leading-tight">Keyword strategy</h1>
          <p className="text-xs text-[var(--mute)]">
            Tier 1 head terms → tier 4 long-tail. Intent and clusters are AI-classified; volume/difficulty
            arrive with a search-data provider — no invented numbers.
          </p>
        </div>
      </div>

      {editor && (
        <div className="flex flex-wrap items-center gap-2 my-4">
          <form action={discoverKeywordsAction}>
            <SubmitButton className="btn" pendingText="Discovering…">
              <Sparkles className="w-4 h-4" /> Discover keywords (AI)
            </SubmitButton>
          </form>
          {missingIntent > 0 && (
            <form action={classifyIntentsAction}>
              <SubmitButton className="btn" pendingText="Classifying…">
                <Wand2 className="w-4 h-4" /> Classify intent ({missingIntent})
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

      {keywords.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-sm text-[var(--mute)]">No keywords yet. Discover a starter set with AI — grounded in your organization profile.</p>
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
                    {editor && <th className="py-1.5 font-semibold">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {list.map((k) => (
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
                          <span className="text-[var(--mute)]">—</span>
                        )}
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
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </main>
  );
}
