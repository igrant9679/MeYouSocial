import Link from "next/link";
import { Plus, Sparkles, Trash2, PenLine, Tags } from "lucide-react";
import { requireMembership, canEdit } from "@/lib/acl";
import { SubmitButton } from "@/components/SubmitButton";
import { DeleteButton } from "@/components/DeleteButton";
import { outlierBand } from "@/lib/intel";
import { IDEA_TIPS } from "@/lib/help-tips";
import { motifHue, motifSummaryLabel, parseMotifs } from "@/lib/motifs";
import { loadIdeasBoard, STATES, type ArticleRow, type BoardCard, type VideoRow } from "@/lib/ideas-board";
import { studioState } from "@/lib/studio";
import {
  deleteBlogIdeaAction,
  discoverBlogIdeasAction,
  draftFromIdeaAction,
  mergeBlogIdeasAction,
  rescoreBlogIdeasAction,
  setBlogIdeaStatusAction,
  updateBlogIdeaAction,
} from "@/app/actions/blog-ideas";
import { addIdeaAction, regenerateIdeasAction, setIdeaTopicAction, updateIdeaStatusAction, writeIdeaToCanvasAction } from "@/app/actions/ideas";
import { StageHeader } from "@/components/StageShell";

// The Ideas stage IS the one board (One-Loop step 4). Article and video ideas
// share four columns and one vocabulary; the format chip on each card says
// which it is, and the verbs differ only where the work differs: an approved
// article is drafted by the autopilot, an approved video is written by a
// person on the script canvas. /blog/ideas and /channels/<id>/ideas redirect
// here with the matching filter.

type Directive = { key: string; label: string };
type Topic = { id: string; name: string };
type Page = { url: string; title: string };

export default async function IdeasBoard({ searchParams }: { searchParams: Promise<{ format?: string; channel?: string }> }) {
  const { workspace, membership } = await requireMembership();
  const editor = canEdit(membership.role);
  const sp = await searchParams;
  const [board, studio] = await Promise.all([loadIdeasBoard(workspace.id, sp), studioState(workspace.id)]);
  const { cards, counts, topics, pages, directives } = board;
  // Video-idea CONTROLS (add, generate, channel filters) follow the video
  // studio switch (lib/studio.ts); existing video cards always show — nothing
  // is deleted by turning the studio off.
  const channels = studio.show ? board.channels : [];
  const openArticles = cards.filter((c): c is Extract<BoardCard, { format: "article" }> => c.format === "article" && (c.state === "discovered" || c.state === "approved")).map((c) => c.row);
  const filterActive = sp.channel ? `channel:${sp.channel}` : sp.format === "article" ? "article" : sp.format === "video" ? "video" : "all";

  return (
    <div>
      <StageHeader
        title="Ideas"
        sentence={
          counts.approved > 0
            ? `${counts.approved} approved idea${counts.approved === 1 ? "" : "s"} wait to be written — articles by the autopilot on its weekly allowance, videos by you on Write.`
            : "One board for article and video ideas. Approve an article and the autopilot drafts it; approve a video and Write opens the script canvas."
        }
        counts={STATES.map((s) => ({ label: s.state, n: counts[s.state], hue: s.hue }))}
      />

      {/* Filter chips — the two old boards live on as filters of the one. */}
      {(channels.length > 0 || board.videosTotal > 0) && (
        <div className="flex items-center gap-1.5 flex-wrap mb-3" aria-label="Show">
          <FilterChip href="/ideas" label={`All · ${board.articlesTotal + board.videosTotal}`} on={filterActive === "all"} />
          <FilterChip href="/ideas?format=article" label={`Articles · ${board.articlesTotal}`} on={filterActive === "article"} />
          {channels.length > 1 && <FilterChip href="/ideas?format=video" label={`Video · ${board.videosTotal}`} on={filterActive === "video"} />}
          {channels.map((c) => (
            <FilterChip key={c.id} href={`/ideas?channel=${c.id}`} label={`Video · ${c.name}`} on={filterActive === `channel:${c.id}`} />
          ))}
        </div>
      )}

      {editor && (
        <div className="card mb-4 flex flex-col gap-3">
          <form action={addIdeaAction} className="flex flex-wrap items-end gap-2">
            <label className="flex-1 min-w-48 text-sm">
              <span className="block text-xs text-[var(--mute)] mb-1">New idea</span>
              <input name="title" required maxLength={200} placeholder="a specific, non-generic title" className="w-full" />
            </label>
            <label className="text-sm w-44">
              <span className="block text-xs text-[var(--mute)] mb-1">Format</span>
              <select name="format" className="w-full text-xs" defaultValue={sp.channel ? `video:${sp.channel}` : "article"}>
                <option value="article">Article</option>
                {channels.map((c) => <option key={c.id} value={`video:${c.id}`}>Video · {c.name}</option>)}
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
                  <option value="">none</option>
                  {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            )}
            <SubmitButton className="btn primary" pendingText="Adding…"><Plus className="w-4 h-4" /> Add</SubmitButton>
          </form>
          <div className="flex flex-wrap items-center gap-2">
            <form action={discoverBlogIdeasAction} className="flex items-center gap-2">
              {topics.length > 0 && (
                <select name="topicId" defaultValue="" className="text-xs border border-[var(--line-2)] rounded-lg px-2 py-1.5" aria-label="Focus discovery on a topic">
                  <option value="">all topics</option>
                  {topics.map((t) => <option key={t.id} value={t.id}>focus: {t.name}</option>)}
                </select>
              )}
              <SubmitButton className="btn" pendingText="Discovering…"><Sparkles className="w-3.5 h-3.5" /> Discover article ideas</SubmitButton>
            </form>
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
            <span className="text-[11px] text-[var(--mute)]">
              Article priority shows its working on the card; a video's number is the measured outlier of the competitor video that inspired it.
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {STATES.map((col) => {
          const items = cards.filter((c) => c.state === col.state);
          return (
            <section key={col.state} className="card">
              <h2 className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide mb-0.5" style={{ color: `var(--${col.hue}-on)` }}>
                {col.title} <span className="font-mono">{items.length}</span>
              </h2>
              <p className="text-[10px] text-[var(--mute)] mb-2">{col.blurb}</p>
              {items.length === 0 ? (
                <p className="text-[11px] text-[var(--mute)] py-2 leading-snug">{col.empty}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {items.map((c) =>
                    c.format === "article"
                      ? <ArticleCard key={`a-${c.row.id}`} idea={c.row} editor={editor} open={openArticles} directives={directives} pages={pages} />
                      : <VideoCard key={`v-${c.row.id}`} idea={c.row} editor={editor} topics={topics} />,
                  )}
                </ul>
              )}
            </section>
          );
        })}
      </div>

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

      <div className="mt-4">
      </div>
    </div>
  );
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

function FormatChip({ format, channel }: { format: "article" | "video"; channel?: string }) {
  const hue = format === "article" ? "rose" : "violet";
  return (
    <span className="font-mono text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0" style={{ background: `var(--${hue}-soft)`, color: `var(--${hue}-on)` }} title={channel ? `Video idea on ${channel}` : "Article idea"}>
      {format === "article" ? "Article" : `Video${channel ? ` · ${channel}` : ""}`}
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

// ── Article card — everything the old blog board carried, unchanged ──────────
function ArticleCard({ idea, editor, open, directives, pages }: { idea: ArticleRow; editor: boolean; open: ArticleRow[]; directives: Directive[]; pages: Page[] }) {
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
        {idea.topic && <Tag hue="indigo">{idea.topic.name}</Tag>}
        {idea.keyword && <Tag>{idea.keyword}</Tag>}
        {idea.tier && <Tag>T{idea.tier}</Tag>}
        {idea.source !== "manual" && <Tag>{idea.source}</Tag>}
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
              <SubmitButton className="btn text-[11px]" pendingText="Drafting…" title="Draft it now instead of waiting for the autopilot's allowance">Send to draft</SubmitButton>
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

      {editor && live && (
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
                  <input name={`motif_${d.key}`} type="number" min={0} max={100} defaultValue={motifs.find((m) => m.key === d.key)?.weight ?? ""} className="w-full font-mono text-xs" />
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
              {open.filter((o) => o.id !== idea.id).map((o) => <option key={o.id} value={o.id}>{o.title.slice(0, 60)}</option>)}
            </select>
            <SubmitButton className="btn text-[11px]">Merge</SubmitButton>
          </form>
        </details>
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
        {idea.workspaceTopic && <Tag hue="indigo">{idea.workspaceTopic.name}</Tag>}
        {idea.suggestedLength && <Tag>{idea.suggestedLength}</Tag>}
        {idea.merit && <Tag>{idea.merit}</Tag>}
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

      {editor && topics.length > 0 && (
        <details className="mt-2">
          <summary className="text-[11px] cursor-pointer text-[var(--mute)]">Topic</summary>
          <form action={setIdeaTopicAction} className="flex items-center gap-1.5 mt-1.5">
            <input type="hidden" name="ideaId" value={idea.id} />
            <Tags className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--indigo-on)" }} />
            <select name="topicId" defaultValue={idea.topicId ?? ""} className="text-[11px] border border-[var(--line-2)] rounded-md px-1.5 py-1 flex-1 min-w-0" aria-label="Topic">
              <option value="">no topic</option>
              {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <SubmitButton className="btn sm" pendingText="…">Set</SubmitButton>
          </form>
        </details>
      )}
    </li>
  );
}
