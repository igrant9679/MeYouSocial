import Link from "next/link";
import { justRejected, REJECT_REASONS, isRejectReason } from "@/lib/reject-reasons";
import { setRejectReasonAction, undoRejectAction } from "@/app/actions/idea-reject";
import { Plus, Sparkles, Trash2, PenLine, Tags, ChevronRight } from "lucide-react";
import { requireMembership, canEdit } from "@/lib/acl";
import { SubmitButton } from "@/components/SubmitButton";
import { DeleteButton } from "@/components/DeleteButton";
import { EmptyState } from "@/components/EmptyState";
import { OutlierChip } from "@/components/OutlierChip";
import { IDEA_TIPS } from "@/lib/help-tips";
import { motifHue, motifSummaryLabel, parseMotifs } from "@/lib/motifs";
import {
  loadIdeasBoard, LANE_STATES, STATES, TABLE_PAGE, cardTitle, moreParam, parseMore, shownIn,
  type ArticleRow, type BoardCard, type BoardState, type IdeaFormat, type Lane, type SocialRow, type VideoRow,
} from "@/lib/ideas-board";
import { studioState } from "@/lib/studio";
import { ideationCells, MANUAL_CEILING } from "@/lib/ideation";
import {
  deleteBlogIdeaAction,
  draftFromIdeaAction,
  rescoreBlogIdeasAction,
  setBlogIdeaStatusAction,
} from "@/app/actions/blog-ideas";
import { addIdeaAction, discoverIdeasAction, regenerateIdeasAction, updateIdeaStatusAction, writeIdeaToCanvasAction } from "@/app/actions/ideas";
import { draftSocialIdeaNowAction, setSocialIdeaStatusAction } from "@/app/actions/social-ideas";
import { draftingBlockers } from "@/lib/idea-blockers";
import { importIdeasCsvAction } from "@/app/actions/ideas-csv";
import { laneHealth, laneKey, STALE_DAYS, type LaneHealth } from "@/lib/lane-health";
import { ideaChange } from "@/lib/idea-drafting";
import { requestNow } from "@/lib/request-time";
import { StageHeader } from "@/components/StageShell";
import { IdeaTriage } from "@/components/IdeaTriage";
import { IdeaTopicDialog } from "@/components/IdeaTopicDialog";
import { formatDay } from "@/lib/zoned-dates";
import { canFollow, whoCanFix } from "@/lib/role-links";
import { duplicatesAmong, openWorkIndex, KIND_LABEL, type Match } from "@/lib/idea-duplicates";
import { mergeDuplicateIdeaAction } from "@/app/actions/idea-merge";
import { mergeBlogIdeasAction } from "@/app/actions/blog-ideas";
import { evidenceCount } from "@/lib/idea-evidence";

// The Ideas stage IS the one board (One-Loop step 4), in Topic lanes since
// 2026-09-21 ("Topics as the spine"). Article, video and social ideas share
// three columns and one vocabulary; the format chip on each card says which
// it is, and the verbs differ only where the work differs: an approved
// article is drafted by the autopilot, an approved video is written by a
// person on the script canvas, an approved social idea is drafted into the
// queue. /blog/ideas and /channels/<id>/ideas redirect here with the
// matching filter.
//
// ⚠ The "No topic yet" lane is where every legacy idea sits until someone
// tags it; it is the only lane with no "Discover" of its own, because
// discovery is per Topic by construction.

type Topic = { id: string; name: string };
const OPEN_LANES = 8; // lanes past this many open collapsed, with their counts
// The bulk toolbar's form (components/IdeaTriage.tsx): every selectable card's
// box names it, so ticking anywhere on the page fills the one form (E-IDE-01).
const BULK = "idea-bulk";

export default async function IdeasBoard({ searchParams }: { searchParams: Promise<{ format?: string; channel?: string; q?: string; topic?: string; sort?: string; view?: string; more?: string; page?: string; ok?: string; err?: string }> }) {
  const { workspace, membership, user } = await requireMembership();
  const editor = canEdit(membership.role);
  // What this person just rejected (E-IDE-18): Undo, and why — from the audit rows.
  const recent = editor ? await justRejected(workspace.id, user.id) : [];
  const sp = await searchParams;
  const [board, studio] = await Promise.all([loadIdeasBoard(workspace.id, sp), studioState(workspace.id)]);
  const { lanes, counts, topics, totals } = board;
  // Video-idea CONTROLS (add, generate, channel filters) follow the video
  // studio switch (lib/studio.ts); existing video cards always show — nothing
  // is deleted by turning the studio off.
  const channels = studio.show ? board.channels : [];
  const openArticles = board.cards.filter((c): c is Extract<BoardCard, { format: "article" }> => c.format === "article" && (c.state === "discovered" || c.state === "approved")).map((c) => c.row);
  const filterActive = sp.channel ? `channel:${sp.channel}` : sp.format === "article" ? "article" : sp.format === "video" ? "video" : sp.format === "social" ? "social" : "all";
  const all = totals.article + totals.video + totals.social;
  // Open article ideas per active Topic, for the Discover guard. Counted from
  // the whole board (not the current filter) so the guard reads the same on
  // every view; the board loads up to 200 per table, which is above the
  // ceiling on every Topic at once.
  const openArticlesByTopic = (await ideationCells(workspace.id, ["article"])).map((c) => ({ id: c.topicId, name: c.topicName, open: c.open }));
  const saturated = openArticlesByTopic.length > 0 && openArticlesByTopic.every((t) => t.open >= MANUAL_CEILING);
  // What actually stops the engine making approved ideas — the board used to
  // promise it would whatever the dials said (IDE-05).
  const blockers = await draftingBlockers(workspace.id);
  // Each lane's health (E-IDE-20), and the order approved articles will be
  // drafted in (E-IDE-08: DRAFT_ORDER — highest priority, then longest-waiting;
  // a site change waits for a person and takes no place).
  const health = await laneHealth(workspace.id);
  const draftRank = new Map(
    board.cards
      .filter((c): c is Extract<BoardCard, { format: "article" }> => c.format === "article" && c.state === "approved")
      .map((c) => c.row)
      .filter((r) => ideaChange(r) !== "site_change")
      .sort((a, b) => (b.priority ?? -1e9) - (a.priority ?? -1e9) || a.createdAt.getTime() - b.createdAt.getTime())
      .map((r, i) => [r.id, i + 1] as const),
  );
  const now = requestNow();
  // E-IDE-03: the closest other open work for each open idea, across formats and drafts.
  const dups = duplicatesAmong(await openWorkIndex(workspace.id));
  const waiting = (f: "article" | "social") => board.cards.filter((c) => c.format === f && c.state === "approved").length;
  const stalled = ([["article", "article", "articles"], ["social", "social post", "social posts"]] as const)
    .map(([f, one, many]) => ({ f, n: waiting(f), label: waiting(f) === 1 ? one : many, why: blockers[f] }))
    .filter((s) => s.n > 0 && s.why);
  const engineMakes = !blockers.article || !blockers.social;
  // Bulk actions come back to this exact view, filters kept.
  const backParams = new URLSearchParams();
  for (const k of ["format", "channel", "q", "topic", "sort", "view", "more", "page"] as const) if (sp[k]) backParams.set(k, sp[k]!);
  const back = backParams.toString() ? `/ideas?${backParams.toString()}` : "/ideas";
  // E-IDE-17: the board pages each column; the table pages the rows. Both in the URL.
  const more = parseMore(sp.more);
  const table = sp.view === "table";
  const hrefWith = (over: Partial<Record<"view" | "more" | "page", string | null>>, hash = "") => {
    const q = new URLSearchParams(backParams);
    for (const [k, v] of Object.entries(over)) { if (v) q.set(k, v); else q.delete(k); }
    return `/ideas${q.toString() ? `?${q.toString()}` : ""}${hash}`;
  };

  return (
    <div>
      <StageHeader
        title="Ideas"
        sentence={
          topics.length === 0
            ? "One board for article, video and social ideas. Add a Topic and discovery runs per Topic, so every idea arrives knowing what it is about."
            : counts.approved > 0
              ? `${counts.approved} approved idea${counts.approved === 1 ? "" : "s"} wait to be made — ${stalled.length ? "see below for what's holding them; Draft now makes one straight away" : "articles and social posts by the engine on its weekly allowances, videos by you on Write"}.`
              : `${topics.length} Topic${topics.length === 1 ? "" : "s"}, one lane each. ${engineMakes ? "Approve an idea and the engine makes it" : "Approve an idea, then Draft now makes it"}; a lane with nothing in it is a Topic nobody has thought about yet.`
        }
        counts={STATES.map((s) => ({ label: s.state, n: counts[s.state], hue: s.hue }))}
      />

      {sp.ok && <p className="text-xs mb-3 px-3 py-2 rounded-lg" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}>{sp.ok}</p>}
      {sp.err && <p className="text-xs mb-3 px-3 py-2 rounded-lg" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>{sp.err}</p>}
      {stalled.length > 0 && (
        <div className="card mb-3 text-xs flex flex-col gap-1" style={{ borderColor: "var(--amber)" }}>
          <b className="text-2xs uppercase tracking-wide font-mono" style={{ color: "var(--amber-on)" }}>Approved, but not being made</b>
          {stalled.map((s) => (
            <span key={s.f}>
              <b>{s.n} {s.label}:</b> {s.why!.text}
              {s.why!.href && (canFollow(s.why!.href, membership.role)
                ? <> <Link href={s.why!.href} className="underline">Change it</Link></>
                : <span className="text-[var(--mute)]"> {whoCanFix(s.why!.href)}</span>)}
            </span>
          ))}
        </div>
      )}

      {/* Filter chips — the old boards live on as filters of the one. */}
      {all > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-3" aria-label="Show">
          <FilterChip href="/ideas" label={`All · ${all}`} on={filterActive === "all"} />
          <FilterChip href="/ideas?format=article" label={`Articles · ${totals.article}`} on={filterActive === "article"} />
          {(channels.length > 1 || (channels.length === 0 && totals.video > 0)) && <FilterChip href="/ideas?format=video" label={`Video · ${totals.video}`} on={filterActive === "video"} />}
          {channels.map((c) => (
            <FilterChip key={c.id} href={`/ideas?channel=${c.id}`} label={`Video · ${c.name}`} on={filterActive === `channel:${c.id}`} />
          ))}
          <FilterChip href="/ideas?format=social" label={`Social · ${totals.social}`} on={filterActive === "social"} />
        </div>
      )}
      {/* E-IDE-02: find a card — title search, one Topic, an order. */}
      {all > 0 && (
        <form method="get" action="/ideas" role="search" className="flex items-center gap-1.5 flex-wrap mb-3">
          {sp.format && <input type="hidden" name="format" value={sp.format} />}
          {sp.channel && <input type="hidden" name="channel" value={sp.channel} />}
          <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="Search titles" aria-label="Search idea titles" className="text-xs w-48" />
          {topics.length > 0 && (
            <select key={`topic:${sp.topic ?? ""}`} name="topic" defaultValue={sp.topic ?? ""} aria-label="Topic" className="text-xs max-w-48">
              <option value="">every Topic</option>
              {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              <option value="none">no Topic yet</option>
            </select>
          )}
          <select key={`sort:${sp.sort ?? "priority"}`} name="sort" defaultValue={sp.sort ?? "priority"} aria-label="Order within each column" className="text-xs">
            <option value="priority">by priority</option>
            <option value="newest">newest first</option>
            <option value="source">by source</option>
          </select>
          {table && <input type="hidden" name="view" value="table" />}
          <button className="btn sm">Show</button>
          <span className="inline-flex rounded-lg border border-[var(--line-2)] overflow-hidden text-xs ml-1" data-view-toggle>
            <Link href={hrefWith({ view: null, page: null })} className="px-2 py-1" style={!table ? { background: "var(--blue-soft)", color: "var(--blue-on)" } : undefined} aria-current={!table ? "page" : undefined}>Board</Link>
            <Link href={hrefWith({ view: "table", more: null })} className="px-2 py-1 border-l border-[var(--line-2)]" style={table ? { background: "var(--blue-soft)", color: "var(--blue-on)" } : undefined} aria-current={table ? "page" : undefined}>Table</Link>
          </span>
          {(sp.q || sp.topic || (sp.sort && sp.sort !== "priority")) && (
            <Link href={sp.channel ? `/ideas?channel=${sp.channel}` : sp.format ? `/ideas?format=${sp.format}` : "/ideas"} className="text-xs underline">Clear</Link>
          )}
        </form>
      )}

      {editor && (
        <div className="card mb-4 flex flex-col gap-3">
          <form action={addIdeaAction} className="flex flex-wrap items-end gap-2">
            <label className="flex-1 min-w-48 text-sm">
              <span className="block text-xs text-[var(--mute)] mb-1">New idea</span>
              <input name="title" required maxLength={240} placeholder="a specific, non-generic title — or a post's hook in one line" className="w-full" />
            </label>
            <label className="text-sm w-44">
              <span className="block text-xs text-[var(--mute)] mb-1">Format</span>
              <select name="format" className="w-full text-xs" defaultValue={sp.channel ? `video:${sp.channel}` : sp.format === "social" ? "social" : "article"}>
                <option value="article">Article</option>
                {channels.map((c) => <option key={c.id} value={`video:${c.id}`}>Video · {c.name}</option>)}
                <option value="social">Social post</option>
              </select>
            </label>
            <label className="text-sm w-36">
              <span className="block text-xs text-[var(--mute)] mb-1">Keyword <span className="opacity-60">(articles)</span></span>
              <input name="keyword" placeholder="optional" className="w-full text-xs" />
            </label>
            {topics.length > 0 && (
              <label className="text-sm w-40">
                <span className="block text-xs text-[var(--mute)] mb-1">Topic</span>
                <select name="topicId" className="w-full text-xs" defaultValue="">
                  <option value="">none yet</option>
                  {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            )}
            <SubmitButton className="btn primary" pendingText="Adding…"><Plus className="w-4 h-4" /> Add</SubmitButton>
          </form>
          <div className="flex flex-wrap items-center gap-2">
            {/* The ONE primary action. Per Topic by construction: with no
                focus it fills the emptiest lanes first (lib/ideation.ts).
                ⚠ When every Topic is at the manual ceiling the button gives
                way to the sentence — on 2026-10-15 four presses put 48 ideas
                onto a board nobody had approved anything from. */}
            {/* Article or social ideas, for one Topic or the emptiest (E-IDE-07) —
                social ideation used to be the assistant's alone. When every Topic is
                at the ceiling for articles the article choices give way, but social
                stays (its ceiling is its own). */}
            {saturated && (
              <p className="text-xs m-0 px-3 py-2 rounded-lg basis-full" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
                Every Topic already has {MANUAL_CEILING}+ open article ideas ({openArticlesByTopic.map((t) => `${t.name.slice(0, 28)}: ${t.open}`).join(" · ")}) — approve or reject some before discovering more articles.
              </p>
            )}
            <form action={discoverIdeasAction} className="flex items-center gap-2 flex-wrap" data-discover>
              <input type="hidden" name="back" value="/ideas" />
              <select key={`formats:${saturated ? "social" : "article"}`} name="formats" defaultValue={saturated ? "social" : "article"} className="text-xs border border-[var(--line-2)] rounded-lg px-2 py-1.5" aria-label="Which kind of idea to discover">
                <option value="article" disabled={saturated}>article ideas</option>
                <option value="social">social post ideas</option>
                <option value="article,social" disabled={saturated}>both</option>
              </select>
              {topics.length > 0 && (
                <select name="topicId" defaultValue="" className="text-xs border border-[var(--line-2)] rounded-lg px-2 py-1.5" aria-label="Which Topic to discover ideas for">
                  <option value="">emptiest Topics first</option>
                  {topics.map((t) => {
                    const open = openArticlesByTopic.find((o) => o.id === t.id)?.open ?? 0;
                    return <option key={t.id} value={t.id}>only: {t.name}{open >= MANUAL_CEILING ? ` (${open} open articles — at the ceiling)` : ""}</option>;
                  })}
                </select>
              )}
              <SubmitButton className="btn primary" pendingText="Discovering…"><Sparkles className="w-3.5 h-3.5" /> Discover</SubmitButton>
            </form>
            {channels.length > 0 && (
              <form action={regenerateIdeasAction} className="flex items-center gap-2">
                {channels.length > 1 ? (
                  <select key={`channelId:${sp.channel ?? channels[0].id}`} name="channelId" defaultValue={sp.channel ?? channels[0].id} className="text-xs border border-[var(--line-2)] rounded-lg px-2 py-1.5" aria-label="Channel to generate video ideas for">
                    {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                ) : (
                  <input type="hidden" name="channelId" value={channels[0].id} />
                )}
                <SubmitButton className="btn" pendingText="Queued…"><Sparkles className="w-3.5 h-3.5" /> Generate 10 video ideas</SubmitButton>
              </form>
            )}
            <form action={rescoreBlogIdeasAction}>
              <SubmitButton className="btn" pendingText="Scoring…">Recompute priorities</SubmitButton>
            </form>
            <Link href="/ideas/topics" className="btn"><Tags className="w-3.5 h-3.5" /> Topics</Link>
            <span className="text-2xs text-[var(--mute)]">
              {topics.length === 0
                ? "Without a Topic, discovery runs once workspace-wide and its ideas arrive untagged."
                : "Article priority shows its working on the card; a video's number is the measured outlier of the competitor video that inspired it."}
            </span>
          </div>
        </div>
      )}

      {/* Sheets (E-IDE-24): the board as CSV, and back. */}
      <details className="card mb-4 text-xs" data-sheets>
        <summary className="cursor-pointer select-none text-[var(--mute)]">Spreadsheet — export or import CSV</summary>
        <div className="mt-2 flex flex-col gap-2">
          <span>Download: <a href="/api/ideas/export?kind=articles" className="underline">article ideas</a> · <a href="/api/ideas/export?kind=social" className="underline">social ideas</a> · <a href="/api/ideas/export?kind=keywords" className="underline">keywords</a>.</span>
          {editor && (
            <form action={importIdeasCsvAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="kind" value="articles" />
              <input type="file" name="file" accept=".csv,text/csv" required className="text-xs" />
              <SubmitButton className="btn sm" pendingText="Importing…">Import article ideas</SubmitButton>
              <span className="text-[var(--mute)] basis-full">The export&apos;s own columns; a <b>title</b> column is all it needs — ideas arrive as Discovered, a Topic is matched by name, duplicates are skipped.</span>
            </form>
          )}
        </div>
      </details>

      {lanes.length === 0 && (sp.q || sp.topic) ? (
        <p className="text-sm text-[var(--mute)]">No ideas match{sp.q ? ` “${sp.q}”` : ""}{sp.topic ? " in that Topic" : ""}. <Link href="/ideas" className="underline">Show everything</Link>.</p>
      ) : lanes.length === 0 ? (
        <EmptyState
          line={topics.length === 0 ? "No Topics and no ideas yet." : "No ideas yet."}
          note={topics.length === 0 ? "A Topic is a theme this company publishes about. Research is matched to it, ideas in every format are discovered per Topic, and Measure reports what each one earned." : undefined}
          action={editor ? (topics.length === 0 ? { label: "Add the first Topic", href: "/ideas/topics" } : { label: "Discover ideas", run: discoverIdeasAction, pendingText: "Discovering…", fields: { formats: "article", back: "/ideas" } }) : null}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {recent.length > 0 && (
            <div className="card mb-3 text-xs flex flex-col gap-1.5" style={{ borderColor: "var(--rose)" }} data-just-rejected>
              {recent.map((r) => (
                <div key={`${r.format}:${r.id}`} className="flex flex-wrap items-center gap-1.5" data-rejected={`${r.format}:${r.id}`}>
                  <span className="min-w-0">Rejected <b className="break-words">{r.title}</b></span>
                  <form action={undoRejectAction}>
                    <input type="hidden" name="format" value={r.format} />
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="from" value={r.from} />
                    <SubmitButton className="btn sm" pendingText="…">Undo</SubmitButton>
                  </form>
                  <span className="text-[var(--mute)] ml-1">Why?</span>
                  {(Object.keys(REJECT_REASONS) as Array<keyof typeof REJECT_REASONS>).map((k) => (
                    <form key={k} action={setRejectReasonAction}>
                      <input type="hidden" name="format" value={r.format} />
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="reason" value={k} />
                      <button className={"btn sm" + (r.reason === k ? " primary" : "")} aria-pressed={r.reason === k}>{REJECT_REASONS[k]}</button>
                    </form>
                  ))}
                </div>
              ))}
              <p className="m-0 text-micro text-[var(--mute)]">A reason tells discovery what to steer away from. This bar shows your rejections from the last two minutes.</p>
            </div>
          )}
          {editor && <IdeaTriage formId={BULK} back={back} topics={topics} />}
          {editor && topics.length > 0 && <IdeaTopicDialog topics={topics} />}
          {table ? (
            <IdeasTable
              cards={board.cards.filter((c) => lanes.some((l) => l.cards.includes(c)))}
              page={Math.max(1, Number(sp.page) || 1)}
              editor={editor}
              pageHref={(n) => hrefWith({ page: n > 1 ? String(n) : null })}
            />
          ) : lanes.map((lane, i) => (
            <LaneSection
              key={lane.topic?.id ?? "none"}
              lane={lane}
              open={i < OPEN_LANES || lane.topic === null || [...more.keys()].some((k) => k.startsWith(`${lane.topic?.id ?? "none"}:`))}
              editor={editor}
              topics={topics}
              health={health.get(laneKey(lane.topic?.id))}
              draftRank={draftRank}
              now={now}
              dups={dups}
              back={back}
              shown={(col) => shownIn(more, lane.topic?.id ?? "none", col)}
              moreHref={(col) => hrefWith({ more: moreParam(more, lane.topic?.id ?? "none", col) }, `#lane-${lane.topic?.id ?? "none"}`)}
            />
          ))}
        </div>
      )}

      {openArticles.some((i) => i.priorityReason) && (
        <details className="card mt-4">
          <summary className="text-sm font-semibold cursor-pointer">How article priority is calculated</summary>
          <ul className="text-xs mt-2 flex flex-col gap-2">
            {openArticles.filter((i) => i.priorityReason).slice(0, 12).map((i) => (
              <li key={i.id} className="border-b border-[var(--line)] pb-2 last:border-0">
                <span className="font-semibold">{i.title}</span>{" "}
                <span className="font-mono text-[var(--mute)]">{i.priority}</span>
                <pre className="whitespace-pre-wrap font-sans text-2xs text-[var(--mute)] mt-0.5">{i.priorityReason}</pre>
                {parseMotifs(i.motifs).length > 0 && (
                  <p className="text-2xs text-[var(--mute)]">Suggested voice: {motifSummaryLabel(parseMotifs(i.motifs))}</p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ── A lane: one Topic, three columns, Rejected under a disclosure ────────────
function LaneSection({ lane, open, editor, topics, health, draftRank, now, dups, back, shown, moreHref }: {
  lane: Lane; open: boolean; editor: boolean; topics: Topic[]; health?: LaneHealth; draftRank: Map<string, number>; now: number; dups: Map<string, Match>; back: string;
  shown: (column: BoardState) => number; moreHref: (column: BoardState) => string;
}) {
  const t = lane.topic;
  const by = (s: BoardState) => lane.cards.filter((c) => c.state === s);
  const rejected = by("rejected");
  const live = lane.cards.length - rejected.length;
  const fmt = (f: IdeaFormat) => lane.cards.filter((c) => c.format === f && c.state !== "rejected").length;
  const breakdown = [
    fmt("article") ? `${fmt("article")} article` : "",
    fmt("video") ? `${fmt("video")} video` : "",
    fmt("social") ? `${fmt("social")} social` : "",
  ].filter(Boolean).join(" · ");
  const laneId = t?.id ?? "none";
  // Only what's on screen can be ticked: a column shows its first `shown` cards.
  const selectable = editor
    ? LANE_STATES.reduce((n, col) => n + by(col.state).slice(0, shown(col.state)).filter(canSelect).length, 0)
    : 0;
  const rejectedShown = rejected.slice(0, shown("rejected"));

  return (
    <details className="card" open={open} id={`lane-${laneId}`}>
      <summary className="cursor-pointer list-none flex items-center gap-2 flex-wrap">
        <ChevronRight className="w-3.5 h-3.5 shrink-0 text-[var(--mute)] transition-transform [details[open]>summary>&]:rotate-90" />
        {t ? (
          <>
            <Link href={`/ideas/topics/${t.id}`} className="font-mono font-bold text-sm hover:underline">{t.name}</Link>
            {t.status !== "active" && <Tag>archived</Tag>}
            {t.priority > 0 && <Tag hue="violet" title="Discovery priority — this Topic leads the prompt">priority {t.priority}</Tag>}
          </>
        ) : (
          <span className="font-mono font-bold text-sm">No topic yet</span>
        )}
        <span className="text-2xs text-[var(--mute)]">{live === 0 ? "nothing open" : breakdown}{rejected.length ? ` · ${rejected.length} rejected` : ""}</span>
        {health && <LaneHealthLine h={health} now={now} />}
        <span className="flex-1" />
        {t && t.description && <span className="text-2xs text-[var(--mute)] hidden md:inline truncate max-w-md">{t.description}</span>}
        {!t && <span className="text-2xs text-[var(--mute)]">no Topic on these yet — tag each one and it moves to its lane</span>}
      </summary>

      {selectable > 0 && (
        <label className="text-2xs text-[var(--mute)] inline-flex items-center gap-1.5 mt-3 cursor-pointer">
          <input type="checkbox" data-lane-toggle={laneId} />
          Select all {selectable} shown in this lane
        </label>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
        {LANE_STATES.map((col) => {
          const all = by(col.state);
          const items = all.slice(0, shown(col.state));
          return (
            <section key={col.state}>
              <h3 className="flex items-center justify-between text-micro font-semibold uppercase tracking-wide mb-1" style={{ color: `var(--${col.hue}-on)` }}>
                {col.title} <span className="font-mono">{all.length}</span>
              </h3>
              {items.length === 0 ? (
                <p className="text-2xs text-[var(--mute)] py-1 leading-snug">
                  {t === null ? "—" : col.state === "discovered" && live === 0 ? "Nothing about this yet — Discover fills it." : col.empty}
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {items.map((c) => <Card key={`${c.format}-${c.row.id}`} c={c} editor={editor} topics={topics} lane={laneId} draftRank={draftRank} dups={dups} back={back} />)}
                </ul>
              )}
              {all.length > items.length && (
                <Link href={moreHref(col.state)} scroll={false} className="block text-2xs text-center mt-2 py-1 rounded-md border border-dashed border-[var(--line-2)] text-[var(--mute)] hover:text-[var(--ink)]" data-show-more={`${laneId}:${col.state}`}>
                  Show {Math.min(20, all.length - items.length)} more · {all.length - items.length} not shown
                </Link>
              )}
            </section>
          );
        })}
      </div>
      {rejected.length > 0 && (
        <details className="mt-3" open={rejectedShown.length > 20}>
          <summary className="text-2xs cursor-pointer text-[var(--mute)]">Rejected · {rejected.length} — won&apos;t come back unless restored</summary>
          <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
            {rejectedShown.map((c) => <Card key={`${c.format}-${c.row.id}`} c={c} editor={editor} topics={topics} lane={`${laneId}:rejected`} draftRank={draftRank} dups={dups} back={back} />)}
          </ul>
          {rejected.length > rejectedShown.length && (
            <Link href={moreHref("rejected")} scroll={false} className="block text-2xs text-center mt-2 text-[var(--mute)] underline" data-show-more={`${laneId}:rejected`}>
              Show {Math.min(20, rejected.length - rejectedShown.length)} more rejected · {rejected.length - rejectedShown.length} not shown
            </Link>
          )}
        </details>
      )}
    </details>
  );
}

/** A lane's health in its header (E-IDE-20): freshness, the week-old backlog, how often it's approved, what reached people. */
function LaneHealthLine({ h, now }: { h: LaneHealth; now: number }) {
  const days = h.lastIdeaAt ? Math.floor((now - h.lastIdeaAt.getTime()) / 86_400_000) : null;
  const bits = [
    days === null ? "no ideas yet" : `last idea ${days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`}`,
    h.approvalRate === null ? null : `${Math.round(h.approvalRate * 100)}% approved`,
    `${h.published} published`,
  ].filter(Boolean);
  return (
    <span className="text-2xs text-[var(--mute)]" data-lane-health>
      · {bits.join(" · ")}
      {h.waiting > 0 && <span style={{ color: "var(--amber-on)" }}> · {h.waiting} waiting {STALE_DAYS}+ days</span>}
    </span>
  );
}

function Card({ c, editor, topics, lane, draftRank, dups, back }: { c: BoardCard; editor: boolean; topics: Topic[]; lane: string; draftRank: Map<string, number>; dups: Map<string, Match>; back: string }) {
  const select = editor && canSelect(c) ? lane : null;
  const dup = dups.get(`${c.format}:${c.row.id}`);
  if (c.format === "article") return <ArticleCard idea={c.row} editor={editor} topics={topics} select={select} rank={draftRank.get(c.row.id)} dup={dup} back={back} />;
  if (c.format === "video") return <VideoCard idea={c.row} editor={editor} topics={topics} select={select} dup={dup} back={back} />;
  return <SocialCard idea={c.row} editor={editor} topics={topics} select={select} dup={dup} back={back} />;
}

/**
 * "Looks like …" (E-IDE-03): the closest other open work, in any format or
 * already being written. Two ideas of the same kind can be merged from here
 * (articles through their own merge); anything else is a pointer.
 */
function DupLine({ format, id, dup, canMerge, back }: { format: IdeaFormat; id: string; dup: Match; canMerge: boolean; back: string }) {
  return (
    <div className="mt-1 text-micro flex flex-wrap items-center gap-1.5" style={{ color: "var(--amber-on)" }} data-dup={`${dup.kind}:${dup.id}`}>
      <span>
        Looks like the {KIND_LABEL[dup.kind]} <Link href={dup.href} className="underline">“{dup.title.length > 70 ? `${dup.title.slice(0, 70)}…` : dup.title}”</Link>
        <span className="text-[var(--mute)]"> · {Math.round(dup.sim * 100)}% the same words</span>
      </span>
      {canMerge && dup.kind === format && (format === "article" ? (
        <form action={mergeBlogIdeasAction}>
          <input type="hidden" name="sourceId" value={id} />
          <input type="hidden" name="targetId" value={dup.id} />
          <SubmitButton className="btn !text-micro !py-0 !px-1.5" pendingText="Merging…">Merge into it</SubmitButton>
        </form>
      ) : (
        <form action={mergeDuplicateIdeaAction}>
          <input type="hidden" name="format" value={format} />
          <input type="hidden" name="sourceId" value={id} />
          <input type="hidden" name="targetId" value={dup.id} />
          <input type="hidden" name="back" value={back} />
          <SubmitButton className="btn !text-micro !py-0 !px-1.5" pendingText="Merging…">Merge into it</SubmitButton>
        </form>
      ))}
    </div>
  );
}

/** The cards bulk triage may touch: the open states their own buttons act on (actions/ideas-bulk.ts keeps the same rules). */
// ── The table view (E-IDE-17): every card as one row, paged ──────────────────
const STATE_ORDER: Record<BoardState, number> = { discovered: 0, approved: 1, drafted: 2, rejected: 3 };
const ideaHref = (c: BoardCard) =>
  c.format === "article" ? `/ideas/article/${c.row.id}` : c.format === "social" ? `/ideas/social/${c.row.id}` : `/channels/${c.row.channel.id}/ideas/${c.row.id}`;
const ideaScore = (c: BoardCard): string =>
  c.format === "video" ? (c.row.outlierScore != null ? `${c.row.outlierScore.toFixed(1)}×` : "—") : c.row.priority != null ? String(c.row.priority) : "—";
const ideaTopic = (c: BoardCard): string | null =>
  c.format === "video" ? c.row.workspaceTopic?.name ?? null : c.row.topic?.name ?? null;

function IdeasTable({ cards, page, editor, pageHref }: { cards: BoardCard[]; page: number; editor: boolean; pageHref: (n: number) => string }) {
  // Open work first, in the board's own order within each state.
  const rows = cards.map((c, i) => ({ c, i })).sort((a, b) => STATE_ORDER[a.c.state] - STATE_ORDER[b.c.state] || a.i - b.i).map((x) => x.c);
  const pages = Math.max(1, Math.ceil(rows.length / TABLE_PAGE));
  const at = Math.min(page, pages);
  const slice = rows.slice((at - 1) * TABLE_PAGE, at * TABLE_PAGE);
  const th = "py-1.5 px-2 font-mono text-micro uppercase tracking-wider text-left text-[var(--mute)] border-b-2 border-[var(--line)]";
  const td = "py-1.5 px-2 border-b border-[var(--line)] align-top";
  const pick = editor ? slice.filter((c) => c.state !== "rejected" && canSelect(c)).length : 0;
  return (
    <div className="card" data-ideas-table>
      <div className="flex items-center gap-2 flex-wrap text-2xs text-[var(--mute)] mb-2">
        {pick > 0 && (
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" data-lane-toggle="table" /> Select all {pick} on this page
          </label>
        )}
        <span className="flex-1" />
        <span data-table-range>{rows.length === 0 ? "No ideas" : `${(at - 1) * TABLE_PAGE + 1}–${(at - 1) * TABLE_PAGE + slice.length} of ${rows.length}`}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              {editor && <th className={th} aria-label="Select" />}
              <th className={th}>Idea</th>
              <th className={th}>Format</th>
              <th className={th}>Topic</th>
              <th className={th}>State</th>
              <th className={`${th} text-right`} title="An article or post's priority; a video's measured outlier">Score</th>
              <th className={`${th} text-right`}>Added</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((c) => {
              const st = STATES.find((s) => s.state === c.state)!;
              return (
                <tr key={`${c.format}-${c.row.id}`} data-idea-row={`${c.format}:${c.row.id}`}>
                  {editor && <td className={td}>{c.state !== "rejected" && canSelect(c) && <SelectBox lane="table" value={`${c.format}:${c.row.id}`} label={cardTitle(c)} />}</td>}
                  <td className={td}><Link href={ideaHref(c)} className="font-semibold hover:underline">{cardTitle(c)}</Link></td>
                  <td className={td}><FormatChip format={c.format} channel={c.format === "video" ? c.row.channel.name : undefined} /></td>
                  <td className={td}>{ideaTopic(c) ?? <span className="text-[var(--mute)]">—</span>}</td>
                  <td className={td}><span style={{ color: `var(--${st.hue}-on)` }}>{st.title}</span></td>
                  <td className={`${td} text-right font-mono tabular-nums`}>{ideaScore(c)}</td>
                  <td className={`${td} text-right font-mono tabular-nums text-[var(--mute)] whitespace-nowrap`}>{formatDay(c.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav className="flex items-center justify-center gap-3 mt-3 text-xs" aria-label="Pages" data-table-pager>
          {at > 1 ? <Link href={pageHref(at - 1)} className="btn sm">← Previous</Link> : <span className="btn sm opacity-40" aria-disabled>← Previous</span>}
          <span className="text-[var(--mute)]">Page {at} of {pages}</span>
          {at < pages ? <Link href={pageHref(at + 1)} className="btn sm">Next →</Link> : <span className="btn sm opacity-40" aria-disabled>Next →</span>}
        </nav>
      )}
    </div>
  );
}

function canSelect(c: BoardCard): boolean {
  if (c.format === "article") return ["discovered", "approved", "rejected"].includes(c.row.status);
  if (c.format === "video") return ["new", "approved", "archived"].includes(c.row.status);
  return c.row.status !== "drafted";
}

/** A card's box. It lives outside every card form and belongs to the toolbar's (`form`). */
function SelectBox({ lane, value, label }: { lane: string; value: string; label: string }) {
  return <input type="checkbox" name="sel" value={value} form={BULK} data-lane={lane} aria-label={`Select “${label.slice(0, 80)}”`} className="mt-0.5 shrink-0" />;
}

function FilterChip({ href, label, on }: { href: string; label: string; on: boolean }) {
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className="font-mono text-2xs px-2 py-0.5 rounded-full border"
      style={on
        ? { background: "var(--ink)", color: "var(--panel)", borderColor: "var(--ink)" }
        : { background: "var(--panel)", color: "var(--mute)", borderColor: "var(--line)" }}
    >
      {label}
    </Link>
  );
}

function FormatChip({ format, channel }: { format: IdeaFormat; channel?: string }) {
  const hue = format === "article" ? "rose" : format === "video" ? "violet" : "blue";
  const label = format === "article" ? "Article" : format === "video" ? `Video${channel ? ` · ${channel}` : ""}` : "Post";
  return (
    <span className="font-mono text-micro font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0" style={{ background: `var(--${hue}-soft)`, color: `var(--${hue}-on)` }} title={format === "video" ? `Video idea${channel ? ` on ${channel}` : ""}` : format === "article" ? "Article idea" : "Social post idea"}>
      {label}
    </span>
  );
}

function Tag({ children, hue, title }: { children: React.ReactNode; hue?: string; title?: string }) {
  return (
    <span
      className="font-mono text-micro px-1.5 py-0.5 rounded-full"
      style={hue ? { background: `var(--${hue}-soft)`, color: `var(--${hue}-on)` } : { background: "var(--panel)", color: "var(--mute)" }}
      title={title}
    >
      {children}
    </span>
  );
}

/** "N sources" on any card discovery grounded in live discussions (Reach) — the links are on the idea's page. */
function SourcesChip({ raw }: { raw: string | null | undefined }) {
  const n = evidenceCount(raw);
  return n ? <span data-idea-sources={n}><Tag hue="blue" title="Discovery drew it from what people are discussing — the links are on its page">{n} source{n === 1 ? "" : "s"}</Tag></span> : null;
}

/** The one "tag it" control, any format. Sits under a disclosure on tagged cards and in the open on untagged ones. */
/**
 * The card's Topic control: a button that opens the board's one shared picker
 * (components/IdeaTopicDialog.tsx) — not a form with every Topic in it on every
 * card (E-IDE-17). Untagged cards get it as their prominent action.
 */
function TopicPicker({ format, id, topicId, topics, prominent, title }: { format: IdeaFormat; id: string; topicId: string | null; topics: Topic[]; prominent: boolean; title: string }) {
  if (topics.length === 0) return null;
  return (
    <button
      type="button"
      data-topic-pick
      data-format={format}
      data-id={id}
      data-topic={topicId ?? ""}
      data-title={title.slice(0, 160)}
      className={prominent ? "btn sm mt-1.5" : "mt-2 text-2xs text-[var(--mute)] underline decoration-dotted"}
    >
      {prominent ? <><Tags className="w-3.5 h-3.5" style={{ color: "var(--indigo-on)" }} /> Tag it with a Topic</> : "Topic"}
    </button>
  );
}

// ── Article card — everything the old blog board carried, unchanged ──────────
function ArticleCard({ idea, editor, topics, select, rank, dup, back }: { idea: ArticleRow; editor: boolean; topics: Topic[]; select: string | null; rank?: number; dup?: Match; back: string }) {
  const motifs = parseMotifs(idea.motifs);
  const live = idea.status !== "drafted" && idea.status !== "merged";
  return (
    <li data-idea-card tabIndex={-1} className="rounded-lg border border-[var(--line)] p-2 outline-none focus:ring-2 focus:ring-[var(--blue)]" style={{ background: "var(--zebra)" }}>
      <div className="flex items-start gap-1.5">
        {select && <SelectBox lane={select} value={`article:${idea.id}`} label={idea.title} />}
        <FormatChip format="article" />
        <Link href={`/ideas/article/${idea.id}`} className="text-xs font-semibold leading-snug flex-1 hover:underline" data-idea-link>{idea.title}</Link>
        {idea.priority != null && <Tag title={idea.priorityReason ?? undefined}>{idea.priority}</Tag>}
      </div>
      {dup && <DupLine format="article" id={idea.id} dup={dup} canMerge={editor && (idea.status === "discovered" || idea.status === "approved")} back={back} />}
      {rank != null && (
        <p className="text-micro mt-1 font-mono" style={{ color: "var(--violet-on)" }} data-draft-rank={rank} title="Approved articles are drafted highest priority first, then the longest-waiting">
          {rank === 1 ? "next to draft" : `#${rank} to draft`}
        </p>
      )}
      {idea.angle && <p className="text-2xs text-[var(--mute)] mt-1">{idea.angle}</p>}

      <div className="flex flex-wrap items-center gap-1 mt-1.5">
        {idea.keyword && <Tag>{idea.keyword}</Tag>}
        {idea.tier && <Tag>T{idea.tier}</Tag>}
        {idea.source !== "manual" && <Tag>{idea.source === "ai" ? "discovered" : idea.source}</Tag>}
        {motifs.map((m) => <Tag key={m.key} hue={motifHue(m.key)}>{m.key} {m.weight}%</Tag>)}
        {idea.seasonalHook && <Tag hue="cyan">{idea.seasonalHook}</Tag>}
        {/* Grounded in live discussions (Reach) — the links are on the idea's page. */}
        <SourcesChip raw={idea.evidence} />
        {idea.status === "rejected" && isRejectReason(idea.rejectReason) && <Tag hue="rose" title="Why it was rejected — discovery steers away from this">{REJECT_REASONS[idea.rejectReason]}</Tag>}
      </div>
      {idea.audience && <p className="text-micro text-[var(--mute)] mt-1">for {idea.audience}</p>}
      {idea.targetPage && <p className="text-micro text-[var(--mute)] mt-0.5 truncate">supports {idea.targetPage}</p>}
      {idea.dedupeNote && (
        <p className="text-micro mt-1" style={{ color: "var(--amber-on)" }}>
          {idea.dedupeNote}{idea.refreshPostId ? " — refresh it rather than writing a new one." : ""}
        </p>
      )}
      {idea.mergedIntoId && <p className="text-micro text-[var(--mute)] mt-1">merged into another idea</p>}

      {editor && live && (
        <div className="flex flex-wrap items-center gap-1 mt-2">
          {idea.status !== "approved" && (
            <form action={setBlogIdeaStatusAction}>
              <input type="hidden" name="id" value={idea.id} />
              <input type="hidden" name="status" value="approved" />
              <button className="btn text-2xs" data-key="a">{idea.status === "rejected" ? "Restore" : "Approve"}</button>
            </form>
          )}
          {idea.status !== "rejected" && (
            <form action={setBlogIdeaStatusAction}>
              <input type="hidden" name="id" value={idea.id} />
              <input type="hidden" name="status" value="rejected" />
              <button className="btn text-2xs" data-key="r">Reject</button>
            </form>
          )}
          {/* E-IDE-25: back to Discovered without rejecting it. */}
          {idea.status === "approved" && (
            <form action={setBlogIdeaStatusAction}>
              <input type="hidden" name="id" value={idea.id} />
              <input type="hidden" name="status" value="discovered" />
              <button className="btn text-2xs" title="Back to Discovered — not rejected, and it won't be drafted until approved again">Not yet</button>
            </form>
          )}
          {idea.status !== "rejected" && (
            <form action={draftFromIdeaAction}>
              <input type="hidden" name="id" value={idea.id} />
              <SubmitButton className="btn text-2xs" pendingText="Drafting…" title="Draft it now instead of waiting for the autopilot's allowance">Draft now</SubmitButton>
            </form>
          )}
          <form action={deleteBlogIdeaAction}>
            <input type="hidden" name="id" value={idea.id} />
            <button className="btn text-2xs" title="Delete idea"><Trash2 className="w-3 h-3" /></button>
          </form>
        </div>
      )}
      {idea.status === "drafted" && idea.postId && (
        <Link href={`/blog/${idea.postId}`} className="text-2xs underline mt-2 inline-block">Open the draft</Link>
      )}

      {editor && live && <TopicPicker format="article" id={idea.id} topicId={idea.topicId} topics={topics} prominent={!idea.topicId} title={idea.title} />}

      {/* Tags and merge live on the idea's own page (IDE-20): this panel, with a
          list of every other open idea, made the board's HTML grow with the
          square of open ideas. */}
      {editor && live && (
        <Link href={`/ideas/article/${idea.id}`} className="text-2xs text-[var(--mute)] underline mt-2 inline-block">Edit tags or merge</Link>
      )}
    </li>
  );
}

// ── Video card — the channel board's card, in the board's vocabulary ─────────
function VideoCard({ idea, editor, topics, select, dup, back }: { idea: VideoRow; editor: boolean; topics: Topic[]; select: string | null; dup?: Match; back: string }) {
  const script = idea.scripts[0];
  const detail = `/channels/${idea.channel.id}/ideas/${idea.id}`;
  return (
    <li data-idea-card tabIndex={-1} className="rounded-lg border border-[var(--line)] p-2 outline-none focus:ring-2 focus:ring-[var(--blue)]" style={{ background: "var(--zebra)" }}>
      <div className="flex items-start gap-1.5">
        {select && <SelectBox lane={select} value={`video:${idea.id}`} label={idea.title} />}
        <FormatChip format="video" channel={idea.channel.name} />
        <Link href={detail} className="text-xs font-semibold leading-snug flex-1 hover:underline">{idea.title}</Link>
        {idea.outlierScore != null && <OutlierChip score={idea.outlierScore} views={idea.sourceVideo?.views} size="xs" title={IDEA_TIPS.outlier} />}
      </div>
      {dup && <DupLine format="video" id={idea.id} dup={dup} canMerge={editor && (idea.status === "new" || idea.status === "approved")} back={back} />}
      {idea.strategy && <p className="text-2xs text-[var(--mute)] mt-1 line-clamp-2">{idea.strategy}</p>}
      <div className="flex flex-wrap items-center gap-1 mt-1.5">
        {idea.suggestedLength && <Tag>{idea.suggestedLength}</Tag>}
        {idea.merit && <Tag>{idea.merit}</Tag>}
        {idea.sourceVideoId && <Tag>from research</Tag>}
        <SourcesChip raw={idea.evidence} />
        {idea.status === "in_progress" && <Tag hue="amber">scripting</Tag>}
        {idea.status === "scripted" && <Tag hue="green">scripted</Tag>}
      </div>

      {editor && (
        <div className="flex flex-wrap items-center gap-1 mt-2">
          {idea.status === "new" && (
            <form action={updateIdeaStatusAction}>
              <input type="hidden" name="ideaId" value={idea.id} />
              <input type="hidden" name="status" value="approved" />
              <button className="btn text-2xs" data-key="a">Approve</button>
            </form>
          )}
          {idea.status === "archived" && (
            <form action={updateIdeaStatusAction}>
              <input type="hidden" name="ideaId" value={idea.id} />
              <input type="hidden" name="status" value="new" />
              <button className="btn text-2xs">Restore</button>
            </form>
          )}
          {(idea.status === "new" || idea.status === "approved") && (
            <>
              <form action={updateIdeaStatusAction}>
                <input type="hidden" name="ideaId" value={idea.id} />
                <input type="hidden" name="status" value="archived" />
                <button className="btn text-2xs" data-key="r">Reject</button>
              </form>
              <form action={writeIdeaToCanvasAction}>
                <input type="hidden" name="ideaId" value={idea.id} />
                <SubmitButton className="btn primary text-2xs" pendingText="Opening…" title="Open the script canvas with this idea loaded"><PenLine className="w-3 h-3" /> Write</SubmitButton>
              </form>
            </>
          )}
          {script && (
            <Link href={script.workflow === "builder" ? `/scripts/${script.id}/builder` : `/scripts/${script.id}`} className="btn text-2xs">Open the script</Link>
          )}
          <DeleteButton kind="idea" id={idea.id} name={idea.title} returnTo="/ideas" />
        </div>
      )}
      {!editor && script && (
        <Link href={script.workflow === "builder" ? `/scripts/${script.id}/builder` : `/scripts/${script.id}`} className="text-2xs underline mt-2 inline-block">Open the script</Link>
      )}

      {editor && idea.status !== "archived" && <TopicPicker format="video" id={idea.id} topicId={idea.topicId} topics={topics} prominent={!idea.topicId} title={idea.title} />}
    </li>
  );
}

// ── Social card — a post's idea: the hook, why, where it came from ───────────
function SocialCard({ idea, editor, topics, select, dup, back }: { idea: SocialRow; editor: boolean; topics: Topic[]; select: string | null; dup?: Match; back: string }) {
  const live = idea.status !== "drafted";
  const source =
    idea.source === "article" && idea.sourceBlogPost ? { label: `from article: ${idea.sourceBlogPost.title}`, href: `/blog/${idea.sourceBlogPost.id}` }
    : idea.source === "research" && idea.sourceVideo ? { label: `from research: ${idea.sourceVideo.title}`, href: `/intel/videos/${idea.sourceVideo.id}` }
    : idea.source === "rss" && idea.sourceUrl ? { label: `from a feed: ${(() => { try { return new URL(idea.sourceUrl).hostname.replace(/^www\./, ""); } catch { return "link"; } })()}`, href: idea.sourceUrl }
    : idea.source === "discovered" ? { label: "discovered", href: null }
    : null;
  return (
    <li data-idea-card tabIndex={-1} className="rounded-lg border border-[var(--line)] p-2 outline-none focus:ring-2 focus:ring-[var(--blue)]" style={{ background: "var(--zebra)" }}>
      <div className="flex items-start gap-1.5">
        {select && <SelectBox lane={select} value={`social:${idea.id}`} label={idea.hook} />}
        <FormatChip format="social" />
        <Link href={`/ideas/social/${idea.id}`} className="text-xs font-semibold leading-snug flex-1 hover:underline" data-idea-link>{idea.hook}</Link>
        {idea.priority != null && <Tag>{idea.priority}</Tag>}
        <SourcesChip raw={idea.evidence} />
        {idea.status === "rejected" && isRejectReason(idea.rejectReason) && <Tag hue="rose" title="Why it was rejected — discovery steers away from this">{REJECT_REASONS[idea.rejectReason]}</Tag>}
      </div>
      {dup && <DupLine format="social" id={idea.id} dup={dup} canMerge={editor && (idea.status === "discovered" || idea.status === "approved")} back={back} />}
      {idea.angle && <p className="text-2xs text-[var(--mute)] mt-1">{idea.angle}</p>}
      {source && (
        <p className="text-micro text-[var(--mute)] mt-1 truncate">
          {source.href ? <Link href={source.href} className="hover:underline">{source.label}</Link> : source.label}
        </p>
      )}
      {idea.status === "drafted" && idea.socialPost && (
        <p className="text-2xs mt-1">
          <Link href={`/social/${idea.socialPost.id}/edit`} className="underline">
            {idea.socialPost.status === "scheduled" && idea.socialPost.scheduledAt
              ? `Queued for ${idea.socialPost.scheduledAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
              : idea.socialPost.status === "posted" || idea.socialPost.status === "partial" ? "Posted — open it"
              : "Drafted — open the post"}
          </Link>
        </p>
      )}

      {editor && live && (
        <div className="flex flex-wrap items-center gap-1 mt-2">
          {idea.status !== "approved" && (
            <form action={setSocialIdeaStatusAction}>
              <input type="hidden" name="id" value={idea.id} />
              <input type="hidden" name="status" value="approved" />
              <button className="btn text-2xs" data-key="a">{idea.status === "rejected" ? "Restore" : "Approve"}</button>
            </form>
          )}
          {idea.status !== "rejected" && (
            <form action={setSocialIdeaStatusAction}>
              <input type="hidden" name="id" value={idea.id} />
              <input type="hidden" name="status" value="rejected" />
              <button className="btn text-2xs" data-key="r">Reject</button>
            </form>
          )}
          {/* E-IDE-25: back to Discovered without rejecting it. */}
          {idea.status === "approved" && (
            <form action={setSocialIdeaStatusAction}>
              <input type="hidden" name="id" value={idea.id} />
              <input type="hidden" name="status" value="discovered" />
              <button className="btn text-2xs" title="Back to Discovered — not rejected, and it won't be drafted until approved again">Not yet</button>
            </form>
          )}
          {/* The engine's writer, now (IDE-05) — approved social ideas had no
              button and could wait for good. */}
          {(idea.status === "discovered" || idea.status === "approved") && (
            <form action={draftSocialIdeaNowAction}>
              <input type="hidden" name="id" value={idea.id} />
              <SubmitButton className="btn text-2xs" pendingText="Drafting…" title="Write the post now instead of waiting for the engine">Draft now</SubmitButton>
            </form>
          )}
          <DeleteButton kind="socialIdea" id={idea.id} name={idea.hook.slice(0, 60)} returnTo="/ideas" />
        </div>
      )}

      {editor && live && <TopicPicker format="social" id={idea.id} topicId={idea.topicId} topics={topics} prominent={!idea.topicId} title={idea.hook} />}

      {/* Editing lives on the idea's own page (E-IDE-17) — not a form in every card. */}
      {editor && live && <Link href={`/ideas/social/${idea.id}`} className="ml-3 text-2xs text-[var(--mute)] underline decoration-dotted">Edit</Link>}
    </li>
  );
}
