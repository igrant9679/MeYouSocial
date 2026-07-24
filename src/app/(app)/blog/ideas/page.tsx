import Link from "next/link";
import { ArrowLeft, Lightbulb, Plus, Sparkles, Trash2 } from "lucide-react";
import { requireMembership, canEdit } from "@/lib/acl";
import { db } from "@/lib/db";
import { SubmitButton } from "@/components/SubmitButton";
import {
  addBlogIdeaAction,
  deleteBlogIdeaAction,
  discoverBlogIdeasAction,
  draftFromIdeaAction,
  mergeBlogIdeasAction,
  rescoreBlogIdeasAction,
  setBlogIdeaStatusAction,
  updateBlogIdeaAction,
} from "@/app/actions/blog-ideas";
import { ensureMotifDirectives, motifHue, motifSummaryLabel, parseMotifs } from "@/lib/motifs";

// FR-5 — the idea board. Columns are the lifecycle; each card carries the tags
// and the priority score with the reasoning that produced it.

const COLUMNS = [
  { status: "discovered", title: "Discovered", hue: "amber" },
  { status: "approved", title: "Approved", hue: "blue" },
  { status: "drafted", title: "Drafted", hue: "green" },
  { status: "rejected", title: "Rejected", hue: "rose" },
] as const;

export default async function BlogIdeasPage() {
  const { workspace, membership } = await requireMembership();
  const editor = canEdit(membership.role);
  const [ideas, directives, pages, topics] = await Promise.all([
    db.blogIdea.findMany({
      where: { workspaceId: workspace.id },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: 200,
      include: { topic: { select: { name: true } } },
    }),
    ensureMotifDirectives(workspace.id),
    db.sitePage.findMany({ where: { workspaceId: workspace.id }, select: { url: true, title: true }, take: 60 }),
    db.topic.findMany({
      where: { workspaceId: workspace.id, status: "active" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const open = ideas.filter((i) => i.status === "discovered" || i.status === "approved");

  return (
    <main className="p-6 w-full">
      <Link href="/blog" className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Blog
      </Link>
      <div className="flex items-center gap-3 mb-5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
          <Lightbulb className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div className="min-w-40">
          <h1 className="font-mono font-bold text-2xl leading-tight">Idea board</h1>
          <p className="text-xs text-[var(--mute)]">
            Priority is computed from your keyword strategy, page map and published archive — every score shows its
            working.
          </p>
        </div>
      </div>

      {editor && (
        <div className="card mb-5 flex flex-col gap-3">
          <form action={addBlogIdeaAction} className="flex flex-wrap items-end gap-2">
            <label className="flex-1 min-w-48 text-sm">
              <span className="block text-xs text-[var(--mute)] mb-1">New idea</span>
              <input name="title" required placeholder="a specific, non-generic title" className="w-full" />
            </label>
            <label className="text-sm w-40">
              <span className="block text-xs text-[var(--mute)] mb-1">Keyword</span>
              <input name="keyword" placeholder="optional" className="w-full text-xs" />
            </label>
            {topics.length > 0 && (
              <label className="text-sm w-44">
                <span className="block text-xs text-[var(--mute)] mb-1">Topic</span>
                <select name="topicId" className="w-full text-xs" defaultValue="">
                  <option value="">none</option>
                  {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            )}
            <SubmitButton className="btn primary"><Plus className="w-4 h-4" /> Add</SubmitButton>
          </form>
          <div className="flex flex-wrap items-center gap-2">
            {/* Focused discovery: pick a topic and every idea in the run belongs to it. */}
            <form action={discoverBlogIdeasAction} className="flex items-center gap-2">
              {topics.length > 0 && (
                <select name="topicId" defaultValue="" className="text-xs border border-[var(--line-2)] rounded-lg px-2 py-1.5" aria-label="Focus discovery on a topic">
                  <option value="">all topics</option>
                  {topics.map((t) => <option key={t.id} value={t.id}>focus: {t.name}</option>)}
                </select>
              )}
              <SubmitButton className="btn" pendingText="Discovering…">
                <Sparkles className="w-3.5 h-3.5" /> Discover &amp; tag ideas
              </SubmitButton>
            </form>
            <form action={rescoreBlogIdeasAction}>
              <SubmitButton className="btn" pendingText="Scoring…">Recompute priorities</SubmitButton>
            </form>
            <span className="text-[11px] text-[var(--mute)]">
              {open.length} open · rescoring picks up new keywords, pages and published posts
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {COLUMNS.map((col) => {
          const items = ideas.filter((i) => i.status === col.status);
          return (
            <section key={col.status} className="card">
              <h2 className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: `var(--${col.hue}-on)` }}>
                {col.title} <span className="font-mono">{items.length}</span>
              </h2>
              {items.length === 0 ? (
                <p className="text-xs text-[var(--mute)] py-2 text-center">Empty</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {items.map((idea) => {
                    const motifs = parseMotifs(idea.motifs);
                    return (
                      <li key={idea.id} className="rounded-lg border border-[var(--line)] p-2" style={{ background: "var(--zebra)" }}>
                        <div className="flex items-start gap-1.5">
                          <span className="text-xs font-semibold leading-snug flex-1">{idea.title}</span>
                          {idea.priority != null && (
                            <span
                              className="font-mono text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                              style={{ background: "var(--panel)", color: "var(--mute)" }}
                              title={idea.priorityReason ?? undefined}
                            >
                              {idea.priority}
                            </span>
                          )}
                        </div>
                        {idea.angle && <p className="text-[11px] text-[var(--mute)] mt-1">{idea.angle}</p>}

                        <div className="flex flex-wrap items-center gap-1 mt-1.5">
                          {idea.topic && (
                            <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "var(--indigo-soft)", color: "var(--indigo-on)" }}>
                              {idea.topic.name}
                            </span>
                          )}
                          {idea.tier && (
                            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--panel)", color: "var(--mute)" }}>
                              T{idea.tier}
                            </span>
                          )}
                          {idea.source !== "manual" && (
                            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--panel)", color: "var(--mute)" }}>
                              {idea.source}
                            </span>
                          )}
                          {motifs.map((m) => (
                            <span
                              key={m.key}
                              className="font-mono text-[10px] px-1.5 py-0.5 rounded-full"
                              style={{ background: `var(--${motifHue(m.key)}-soft)`, color: `var(--${motifHue(m.key)}-on)` }}
                            >
                              {m.key} {m.weight}%
                            </span>
                          ))}
                          {idea.seasonalHook && (
                            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--cyan-soft)", color: "var(--cyan-on)" }}>
                              {idea.seasonalHook}
                            </span>
                          )}
                        </div>
                        {idea.audience && <p className="text-[10px] text-[var(--mute)] mt-1">for {idea.audience}</p>}
                        {idea.targetPage && (
                          <p className="text-[10px] text-[var(--mute)] mt-0.5 truncate">supports {idea.targetPage}</p>
                        )}
                        {idea.dedupeNote && (
                          <p className="text-[10px] mt-1" style={{ color: "var(--amber-on)" }}>
                            {idea.dedupeNote}
                            {idea.refreshPostId ? " — refresh it rather than writing a new one." : ""}
                          </p>
                        )}
                        {idea.mergedIntoId && (
                          <p className="text-[10px] text-[var(--mute)] mt-1">merged into another idea</p>
                        )}

                        {editor && idea.status !== "drafted" && idea.status !== "merged" && (
                          <div className="flex flex-wrap items-center gap-1 mt-2">
                            {idea.status !== "approved" && (
                              <form action={setBlogIdeaStatusAction}>
                                <input type="hidden" name="id" value={idea.id} />
                                <input type="hidden" name="status" value="approved" />
                                <button className="btn text-[11px]">Approve</button>
                              </form>
                            )}
                            {idea.status !== "rejected" && (
                              <form action={setBlogIdeaStatusAction}>
                                <input type="hidden" name="id" value={idea.id} />
                                <input type="hidden" name="status" value="rejected" />
                                <button className="btn text-[11px]">Reject</button>
                              </form>
                            )}
                            <form action={draftFromIdeaAction}>
                              <input type="hidden" name="id" value={idea.id} />
                              <SubmitButton className="btn text-[11px]" pendingText="Drafting…">Send to draft</SubmitButton>
                            </form>
                            <form action={deleteBlogIdeaAction}>
                              <input type="hidden" name="id" value={idea.id} />
                              <button className="btn text-[11px]" title="Delete idea"><Trash2 className="w-3 h-3" /></button>
                            </form>
                          </div>
                        )}
                        {idea.status === "drafted" && idea.postId && (
                          <Link href={`/blog/${idea.postId}`} className="text-[11px] underline mt-2 inline-block">
                            Open the draft
                          </Link>
                        )}

                        {editor && idea.status !== "drafted" && idea.status !== "merged" && (
                          <details className="mt-2">
                            <summary className="text-[11px] cursor-pointer text-[var(--mute)]">Edit tags</summary>
                            <form action={updateBlogIdeaAction} className="flex flex-col gap-1.5 mt-1.5">
                              <input type="hidden" name="id" value={idea.id} />
                              <input name="title" defaultValue={idea.title} className="w-full text-xs" />
                              <textarea name="angle" defaultValue={idea.angle ?? ""} rows={2} placeholder="angle" className="w-full text-xs" />
                              <input name="keyword" defaultValue={idea.keyword ?? ""} placeholder="keyword" className="w-full text-xs" />
                              <input name="audience" defaultValue={idea.audience ?? ""} placeholder="audience" className="w-full text-xs" />
                              <select name="tier" defaultValue={idea.tier?.toString() ?? ""} className="w-full text-xs">
                                <option value="">no tier</option>
                                {[1, 2, 3, 4].map((t) => <option key={t} value={t}>Tier {t}</option>)}
                              </select>
                              <select name="targetPage" defaultValue={idea.targetPage ?? ""} className="w-full text-xs">
                                <option value="">no target page</option>
                                {pages.map((p) => <option key={p.url} value={p.url}>{p.title}</option>)}
                              </select>
                              <input name="seasonalHook" defaultValue={idea.seasonalHook ?? ""} placeholder="seasonal hook" className="w-full text-xs" />
                              <div className="grid grid-cols-2 gap-1">
                                {directives.map((d) => (
                                  <label key={d.key} className="text-[10px]">
                                    <span className="block text-[var(--mute)]">{d.label}</span>
                                    <input
                                      name={`motif_${d.key}`}
                                      type="number"
                                      min={0}
                                      max={100}
                                      defaultValue={motifs.find((m) => m.key === d.key)?.weight ?? ""}
                                      className="w-full font-mono text-xs"
                                    />
                                  </label>
                                ))}
                              </div>
                              <SubmitButton className="btn text-[11px]">Save tags</SubmitButton>
                            </form>

                            <form action={mergeBlogIdeasAction} className="flex flex-col gap-1.5 mt-2 border-t border-[var(--line)] pt-2">
                              <input type="hidden" name="sourceId" value={idea.id} />
                              <span className="text-[10px] text-[var(--mute)]">Merge this into…</span>
                              <select name="targetId" className="w-full text-xs" defaultValue="">
                                <option value="">choose an idea</option>
                                {open
                                  .filter((o) => o.id !== idea.id)
                                  .map((o) => <option key={o.id} value={o.id}>{o.title.slice(0, 60)}</option>)}
                              </select>
                              <SubmitButton className="btn text-[11px]">Merge</SubmitButton>
                            </form>
                          </details>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {open.some((i) => i.priorityReason) && (
        <details className="card mt-4">
          <summary className="text-sm font-semibold cursor-pointer">How priority is calculated</summary>
          <ul className="text-xs mt-2 flex flex-col gap-2">
            {open
              .filter((i) => i.priorityReason)
              .slice(0, 12)
              .map((i) => (
                <li key={i.id} className="border-b border-[var(--line)] pb-2 last:border-0">
                  <span className="font-semibold">{i.title}</span>{" "}
                  <span className="font-mono text-[var(--mute)]">{i.priority}</span>
                  <pre className="whitespace-pre-wrap font-sans text-[11px] text-[var(--mute)] mt-0.5">{i.priorityReason}</pre>
                  {parseMotifs(i.motifs).length > 0 && (
                    <p className="text-[11px] text-[var(--mute)]">Suggested voice: {motifSummaryLabel(parseMotifs(i.motifs))}</p>
                  )}
                </li>
              ))}
          </ul>
        </details>
      )}
    </main>
  );
}
