import Link from "next/link";
import { Plus, Sparkles, Trash2, PenLine, Tags, ChevronRight } from "lucide-react";
import { requireMembership, canEdit } from "@/lib/acl";
import { SubmitButton } from "@/components/SubmitButton";
import { DeleteButton } from "@/components/DeleteButton";
import { EmptyState } from "@/components/EmptyState";
import { outlierBand } from "@/lib/intel";
import { IDEA_TIPS } from "@/lib/help-tips";
import { motifHue, motifSummaryLabel, parseMotifs } from "@/lib/motifs";
import {
  loadIdeasBoard, LANE_STATES, STATES,
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
import { addIdeaAction, discoverIdeasAction, regenerateIdeasAction, setBoardIdeaTopicAction, updateIdeaStatusAction, writeIdeaToCanvasAction } from "@/app/actions/ideas";
import { draftSocialIdeaNowAction, setSocialIdeaStatusAction, updateSocialIdeaAction } from "@/app/actions/social-ideas";
import { draftingBlockers } from "@/lib/idea-blockers";
import { StageHeader } from "@/components/StageShell";
import { canFollow, whoCanFix } from "@/lib/role-links";

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

export default async function IdeasBoard({ searchParams }: { searchParams: Promise<{ format?: string; channel?: string; ok?: string; err?: string }> }) {
  const { workspace, membership } = await requireMembership();
  const editor = canEdit(membership.role);
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
  const waiting = (f: "article" | "social") => board.cards.filter((c) => c.format === f && c.state === "approved").length;
  const stalled = ([["article", "article", "articles"], ["social", "social post", "social posts"]] as const)
    .map(([f, one, many]) => ({ f, n: waiting(f), label: waiting(f) === 1 ? one : many, why: blockers[f] }))
    .filter((s) => s.n > 0 && s.why);
  const engineMakes = !blockers.article || !blockers.social;

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
          <b className="text-[11px] uppercase tracking-wide font-mono" style={{ color: "var(--amber-on)" }}>Approved, but not being made</b>
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
            {saturated ? (
              <p className="text-xs m-0 px-3 py-2 rounded-lg" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
                Every Topic already has {MANUAL_CEILING}+ open article ideas ({openArticlesByTopic.map((t) => `${t.name.slice(0, 28)}: ${t.open}`).join(" · ")}) — approve or reject some before discovering more.
              </p>
            ) : (
              <form action={discoverIdeasAction} className="flex items-center gap-2">
                <input type="hidden" name="formats" value="article" />
                <input type="hidden" name="back" value="/ideas" />
                {topics.length > 0 && (
                  <select name="topicId" defaultValue="" className="text-xs border border-[var(--line-2)] rounded-lg px-2 py-1.5" aria-label="Which Topic to discover ideas for">
                    <option value="">emptiest Topics first</option>
                    {topics.map((t) => {
                      const open = openArticlesByTopic.find((o) => o.id === t.id)?.open ?? 0;
                      return <option key={t.id} value={t.id} disabled={open >= MANUAL_CEILING}>only: {t.name}{open >= MANUAL_CEILING ? ` (${open} open — at the ceiling)` : ""}</option>;
                    })}
                  </select>
                )}
                <SubmitButton className="btn primary" pendingText="Discovering…"><Sparkles className="w-3.5 h-3.5" /> Discover article ideas</SubmitButton>
              </form>
            )}
            {channels.length > 0 && (
              <form action={regenerateIdeasAction} className="flex items-center gap-2">
                {channels.length > 1 ? (
                  <select name="channelId" defaultValue={sp.channel ?? channels[0].id} className="text-xs border border-[var(--line-2)] rounded-lg px-2 py-1.5" aria-label="Channel to generate video ideas for">
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
            <span className="text-[11px] text-[var(--mute)]">
              {topics.length === 0
                ? "Without a Topic, discovery runs once workspace-wide and its ideas arrive untagged."
                : "Article priority shows its working on the card; a video's number is the measured outlier of the competitor video that inspired it."}
            </span>
          </div>
        </div>
      )}

      {lanes.length === 0 ? (
        <EmptyState
          line={topics.length === 0 ? "No Topics and no ideas yet." : "No ideas yet."}
          note={topics.length === 0 ? "A Topic is a theme this company publishes about. Research is matched to it, ideas in every format are discovered per Topic, and Measure reports what each one earned." : undefined}
          action={editor ? (topics.length === 0 ? { label: "Add the first Topic", href: "/ideas/topics" } : { label: "Discover ideas", run: discoverIdeasAction, pendingText: "Discovering…", fields: { formats: "article", back: "/ideas" } }) : null}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {lanes.map((lane, i) => (
            <LaneSection
              key={lane.topic?.id ?? "none"}
              lane={lane}
              open={i < OPEN_LANES || lane.topic === null}
              editor={editor}
              topics={topics}
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
                <pre className="whitespace-pre-wrap font-sans text-[11px] text-[var(--mute)] mt-0.5">{i.priorityReason}</pre>
                {parseMotifs(i.motifs).length > 0 && (
                  <p className="text-[11px] text-[var(--mute)]">Suggested voice: {motifSummaryLabel(parseMotifs(i.motifs))}</p>
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
function LaneSection({ lane, open, editor, topics }: {
  lane: Lane; open: boolean; editor: boolean; topics: Topic[];
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

  return (
    <details className="card" open={open}>
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
        <span className="text-[11px] text-[var(--mute)]">{live === 0 ? "nothing open" : breakdown}{rejected.length ? ` · ${rejected.length} rejected` : ""}</span>
        <span className="flex-1" />
        {t && t.description && <span className="text-[11px] text-[var(--mute)] hidden md:inline truncate max-w-md">{t.description}</span>}
        {!t && <span className="text-[11px] text-[var(--mute)]">no Topic on these yet — tag each one and it moves to its lane</span>}
      </summary>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
        {LANE_STATES.map((col) => {
          const items = by(col.state);
          return (
            <section key={col.state}>
              <h3 className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: `var(--${col.hue}-on)` }}>
                {col.title} <span className="font-mono">{items.length}</span>
              </h3>
              {items.length === 0 ? (
                <p className="text-[11px] text-[var(--mute)] py-1 leading-snug">
                  {t === null ? "—" : col.state === "discovered" && live === 0 ? "Nothing about this yet — Discover fills it." : col.empty}
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {items.map((c) => <Card key={`${c.format}-${c.row.id}`} c={c} editor={editor} topics={topics} />)}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {rejected.length > 0 && (
        <details className="mt-3">
          <summary className="text-[11px] cursor-pointer text-[var(--mute)]">Rejected · {rejected.length} — won&apos;t come back unless restored</summary>
          <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
            {rejected.map((c) => <Card key={`${c.format}-${c.row.id}`} c={c} editor={editor} topics={topics} />)}
          </ul>
        </details>
      )}
    </details>
  );
}

function Card({ c, editor, topics }: { c: BoardCard; editor: boolean; topics: Topic[] }) {
  if (c.format === "article") return <ArticleCard idea={c.row} editor={editor} topics={topics} />;
  if (c.format === "video") return <VideoCard idea={c.row} editor={editor} topics={topics} />;
  return <SocialCard idea={c.row} editor={editor} topics={topics} />;
}

function FilterChip({ href, label, on }: { href: string; label: string; on: boolean }) {
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className="font-mono text-[11px] px-2 py-0.5 rounded-full border"
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
    <span className="font-mono text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0" style={{ background: `var(--${hue}-soft)`, color: `var(--${hue}-on)` }} title={format === "video" ? `Video idea${channel ? ` on ${channel}` : ""}` : format === "article" ? "Article idea" : "Social post idea"}>
      {label}
    </span>
  );
}

function Tag({ children, hue, title }: { children: React.ReactNode; hue?: string; title?: string }) {
  return (
    <span
      className="font-mono text-[10px] px-1.5 py-0.5 rounded-full"
      style={hue ? { background: `var(--${hue}-soft)`, color: `var(--${hue}-on)` } : { background: "var(--panel)", color: "var(--mute)" }}
      title={title}
    >
      {children}
    </span>
  );
}

/** The one "tag it" control, any format. Sits under a disclosure on tagged cards and in the open on untagged ones. */
function TopicPicker({ format, id, topicId, topics, prominent }: { format: IdeaFormat; id: string; topicId: string | null; topics: Topic[]; prominent: boolean }) {
  if (topics.length === 0) return null;
  const form = (
    <form action={setBoardIdeaTopicAction} className="flex items-center gap-1.5 mt-1.5">
      <input type="hidden" name="format" value={format} />
      <input type="hidden" name="id" value={id} />
      <Tags className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--indigo-on)" }} />
      <select name="topicId" defaultValue={topicId ?? ""} className="text-[11px] border border-[var(--line-2)] rounded-md px-1.5 py-1 flex-1 min-w-0" aria-label="Topic">
        <option value="">no topic</option>
        {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <SubmitButton className="btn sm" pendingText="…">{prominent ? "Tag it" : "Set"}</SubmitButton>
    </form>
  );
  if (prominent) return <div className="mt-1">{form}</div>;
  return (
    <details className="mt-2">
      <summary className="text-[11px] cursor-pointer text-[var(--mute)]">Topic</summary>
      {form}
    </details>
  );
}

// ── Article card — everything the old blog board carried, unchanged ──────────
function ArticleCard({ idea, editor, topics }: { idea: ArticleRow; editor: boolean; topics: Topic[] }) {
  const motifs = parseMotifs(idea.motifs);
  const live = idea.status !== "drafted" && idea.status !== "merged";
  return (
    <li className="rounded-lg border border-[var(--line)] p-2" style={{ background: "var(--zebra)" }}>
      <div className="flex items-start gap-1.5">
        <FormatChip format="article" />
        <span className="text-xs font-semibold leading-snug flex-1">{idea.title}</span>
        {idea.priority != null && <Tag title={idea.priorityReason ?? undefined}>{idea.priority}</Tag>}
      </div>
      {idea.angle && <p className="text-[11px] text-[var(--mute)] mt-1">{idea.angle}</p>}

      <div className="flex flex-wrap items-center gap-1 mt-1.5">
        {idea.keyword && <Tag>{idea.keyword}</Tag>}
        {idea.tier && <Tag>T{idea.tier}</Tag>}
        {idea.source !== "manual" && <Tag>{idea.source === "ai" ? "discovered" : idea.source}</Tag>}
        {motifs.map((m) => <Tag key={m.key} hue={motifHue(m.key)}>{m.key} {m.weight}%</Tag>)}
        {idea.seasonalHook && <Tag hue="cyan">{idea.seasonalHook}</Tag>}
      </div>
      {idea.audience && <p className="text-[10px] text-[var(--mute)] mt-1">for {idea.audience}</p>}
      {idea.targetPage && <p className="text-[10px] text-[var(--mute)] mt-0.5 truncate">supports {idea.targetPage}</p>}
      {idea.dedupeNote && (
        <p className="text-[10px] mt-1" style={{ color: "var(--amber-on)" }}>
          {idea.dedupeNote}{idea.refreshPostId ? " — refresh it rather than writing a new one." : ""}
        </p>
      )}
      {idea.mergedIntoId && <p className="text-[10px] text-[var(--mute)] mt-1">merged into another idea</p>}

      {editor && live && (
        <div className="flex flex-wrap items-center gap-1 mt-2">
          {idea.status !== "approved" && (
            <form action={setBlogIdeaStatusAction}>
              <input type="hidden" name="id" value={idea.id} />
              <input type="hidden" name="status" value="approved" />
              <button className="btn text-[11px]">{idea.status === "rejected" ? "Restore" : "Approve"}</button>
            </form>
          )}
          {idea.status !== "rejected" && (
            <form action={setBlogIdeaStatusAction}>
              <input type="hidden" name="id" value={idea.id} />
              <input type="hidden" name="status" value="rejected" />
              <button className="btn text-[11px]">Reject</button>
            </form>
          )}
          {idea.status !== "rejected" && (
            <form action={draftFromIdeaAction}>
              <input type="hidden" name="id" value={idea.id} />
              <SubmitButton className="btn text-[11px]" pendingText="Drafting…" title="Draft it now instead of waiting for the autopilot's allowance">Draft now</SubmitButton>
            </form>
          )}
          <form action={deleteBlogIdeaAction}>
            <input type="hidden" name="id" value={idea.id} />
            <button className="btn text-[11px]" title="Delete idea"><Trash2 className="w-3 h-3" /></button>
          </form>
        </div>
      )}
      {idea.status === "drafted" && idea.postId && (
        <Link href={`/blog/${idea.postId}`} className="text-[11px] underline mt-2 inline-block">Open the draft</Link>
      )}

      {editor && live && <TopicPicker format="article" id={idea.id} topicId={idea.topicId} topics={topics} prominent={!idea.topicId} />}

      {/* Tags and merge live on the idea's own page (IDE-20): this panel, with a
          list of every other open idea, made the board's HTML grow with the
          square of open ideas. */}
      {editor && live && (
        <Link href={`/ideas/article/${idea.id}`} className="text-[11px] text-[var(--mute)] underline mt-2 inline-block">Edit tags or merge</Link>
      )}
    </li>
  );
}

// ── Video card — the channel board's card, in the board's vocabulary ─────────
function VideoCard({ idea, editor, topics }: { idea: VideoRow; editor: boolean; topics: Topic[] }) {
  const band = outlierBand(idea.outlierScore);
  const script = idea.scripts[0];
  const detail = `/channels/${idea.channel.id}/ideas/${idea.id}`;
  return (
    <li className="rounded-lg border border-[var(--line)] p-2" style={{ background: "var(--zebra)" }}>
      <div className="flex items-start gap-1.5">
        <FormatChip format="video" channel={idea.channel.name} />
        <Link href={detail} className="text-xs font-semibold leading-snug flex-1 hover:underline">{idea.title}</Link>
        {idea.outlierScore != null && (
          <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0" style={{ background: band.soft, color: band.color }} title={IDEA_TIPS.outlier}>
            {idea.outlierScore.toFixed(1)}×
          </span>
        )}
      </div>
      {idea.strategy && <p className="text-[11px] text-[var(--mute)] mt-1 line-clamp-2">{idea.strategy}</p>}
      <div className="flex flex-wrap items-center gap-1 mt-1.5">
        {idea.suggestedLength && <Tag>{idea.suggestedLength}</Tag>}
        {idea.merit && <Tag>{idea.merit}</Tag>}
        {idea.sourceVideoId && <Tag>from research</Tag>}
        {idea.status === "in_progress" && <Tag hue="amber">scripting</Tag>}
        {idea.status === "scripted" && <Tag hue="green">scripted</Tag>}
      </div>

      {editor && (
        <div className="flex flex-wrap items-center gap-1 mt-2">
          {idea.status === "new" && (
            <form action={updateIdeaStatusAction}>
              <input type="hidden" name="ideaId" value={idea.id} />
              <input type="hidden" name="status" value="approved" />
              <button className="btn text-[11px]">Approve</button>
            </form>
          )}
          {idea.status === "archived" && (
            <form action={updateIdeaStatusAction}>
              <input type="hidden" name="ideaId" value={idea.id} />
              <input type="hidden" name="status" value="new" />
              <button className="btn text-[11px]">Restore</button>
            </form>
          )}
          {(idea.status === "new" || idea.status === "approved") && (
            <>
              <form action={updateIdeaStatusAction}>
                <input type="hidden" name="ideaId" value={idea.id} />
                <input type="hidden" name="status" value="archived" />
                <button className="btn text-[11px]">Reject</button>
              </form>
              <form action={writeIdeaToCanvasAction}>
                <input type="hidden" name="ideaId" value={idea.id} />
                <SubmitButton className="btn primary text-[11px]" pendingText="Opening…" title="Open the script canvas with this idea loaded"><PenLine className="w-3 h-3" /> Write</SubmitButton>
              </form>
            </>
          )}
          {script && (
            <Link href={script.workflow === "builder" ? `/scripts/${script.id}/builder` : `/scripts/${script.id}`} className="btn text-[11px]">Open the script</Link>
          )}
          <DeleteButton kind="idea" id={idea.id} name={idea.title} returnTo="/ideas" />
        </div>
      )}
      {!editor && script && (
        <Link href={script.workflow === "builder" ? `/scripts/${script.id}/builder` : `/scripts/${script.id}`} className="text-[11px] underline mt-2 inline-block">Open the script</Link>
      )}

      {editor && idea.status !== "archived" && <TopicPicker format="video" id={idea.id} topicId={idea.topicId} topics={topics} prominent={!idea.topicId} />}
    </li>
  );
}

// ── Social card — a post's idea: the hook, why, where it came from ───────────
function SocialCard({ idea, editor, topics }: { idea: SocialRow; editor: boolean; topics: Topic[] }) {
  const live = idea.status !== "drafted";
  const source =
    idea.source === "article" && idea.sourceBlogPost ? { label: `from article: ${idea.sourceBlogPost.title}`, href: `/blog/${idea.sourceBlogPost.id}` }
    : idea.source === "research" && idea.sourceVideo ? { label: `from research: ${idea.sourceVideo.title}`, href: `/intel/videos/${idea.sourceVideo.id}` }
    : idea.source === "rss" && idea.sourceUrl ? { label: `from a feed: ${(() => { try { return new URL(idea.sourceUrl).hostname.replace(/^www\./, ""); } catch { return "link"; } })()}`, href: idea.sourceUrl }
    : idea.source === "discovered" ? { label: "discovered", href: null }
    : null;
  return (
    <li className="rounded-lg border border-[var(--line)] p-2" style={{ background: "var(--zebra)" }}>
      <div className="flex items-start gap-1.5">
        <FormatChip format="social" />
        <span className="text-xs font-semibold leading-snug flex-1">{idea.hook}</span>
        {idea.priority != null && <Tag>{idea.priority}</Tag>}
      </div>
      {idea.angle && <p className="text-[11px] text-[var(--mute)] mt-1">{idea.angle}</p>}
      {source && (
        <p className="text-[10px] text-[var(--mute)] mt-1 truncate">
          {source.href ? <Link href={source.href} className="hover:underline">{source.label}</Link> : source.label}
        </p>
      )}
      {idea.status === "drafted" && idea.socialPost && (
        <p className="text-[11px] mt-1">
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
              <button className="btn text-[11px]">{idea.status === "rejected" ? "Restore" : "Approve"}</button>
            </form>
          )}
          {idea.status !== "rejected" && (
            <form action={setSocialIdeaStatusAction}>
              <input type="hidden" name="id" value={idea.id} />
              <input type="hidden" name="status" value="rejected" />
              <button className="btn text-[11px]">Reject</button>
            </form>
          )}
          {/* The engine's writer, now (IDE-05) — approved social ideas had no
              button and could wait for good. */}
          {(idea.status === "discovered" || idea.status === "approved") && (
            <form action={draftSocialIdeaNowAction}>
              <input type="hidden" name="id" value={idea.id} />
              <SubmitButton className="btn text-[11px]" pendingText="Drafting…" title="Write the post now instead of waiting for the engine">Draft now</SubmitButton>
            </form>
          )}
          <DeleteButton kind="socialIdea" id={idea.id} name={idea.hook.slice(0, 60)} returnTo="/ideas" />
        </div>
      )}

      {editor && live && <TopicPicker format="social" id={idea.id} topicId={idea.topicId} topics={topics} prominent={!idea.topicId} />}

      {editor && live && (
        <details className="mt-2">
          <summary className="text-[11px] cursor-pointer text-[var(--mute)]">Edit</summary>
          <form action={updateSocialIdeaAction} className="flex flex-col gap-1.5 mt-1.5">
            <input type="hidden" name="id" value={idea.id} />
            <textarea name="hook" defaultValue={idea.hook} rows={2} maxLength={240} className="w-full text-xs" />
            <input name="angle" defaultValue={idea.angle ?? ""} placeholder="why it works" className="w-full text-xs" />
            <SubmitButton className="btn text-[11px]">Save</SubmitButton>
          </form>
        </details>
      )}
    </li>
  );
}
