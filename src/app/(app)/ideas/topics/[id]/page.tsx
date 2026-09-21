import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArrowLeft, Check, Sparkles, Tags } from "lucide-react";
import { requireMembership, canEdit } from "@/lib/acl";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { SubmitButton } from "@/components/SubmitButton";
import { EmptyState } from "@/components/EmptyState";
import { StageHeader, StateChip } from "@/components/StageShell";
import { ARTICLE_STATE, SOCIAL_STATE, VIDEO_STATE, STATES, type BoardState } from "@/lib/ideas-board";
import { toggleTopicStatusAction, updateTopicAction } from "@/app/actions/brand-hub";
import { discoverIdeasAction } from "@/app/actions/ideas";

// One Topic, from the inside: what it is, the ideas about it by format and
// state, what has been made and gone out, and (Measure → Topics) what it
// earned. This page and the Measure table are the same data from two ends —
// one asks "what should we make about this?", the other "was it worth it?".

type SP = { ok?: string; err?: string };
const TAKE = 12;

export default async function TopicPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const { ok, err } = await searchParams;
  const { workspace, membership } = await requireMembership();
  const editor = canEdit(membership.role);
  const topic = await db.topic.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!topic) notFound();
  const back = `/ideas/topics/${topic.id}`;
  const phrases = readJson<string[]>(topic.keywords, []);

  const [articleIdeas, videoIdeas, socialIdeas, articles, renders, posts, scripts] = await Promise.all([
    db.blogIdea.findMany({ where: { workspaceId: workspace.id, topicId: topic.id }, orderBy: [{ priority: "desc" }, { createdAt: "desc" }], take: 60, select: { id: true, title: true, status: true, postId: true } }),
    db.idea.findMany({ where: { channel: { workspaceId: workspace.id }, topicId: topic.id }, orderBy: [{ outlierScore: "desc" }, { createdAt: "desc" }], take: 60, select: { id: true, title: true, status: true, channelId: true } }),
    db.socialIdea.findMany({ where: { workspaceId: workspace.id, topicId: topic.id }, orderBy: [{ priority: "desc" }, { createdAt: "desc" }], take: 60, select: { id: true, hook: true, status: true, socialPostId: true } }),
    db.blogPost.findMany({ where: { workspaceId: workspace.id, topicId: topic.id }, orderBy: { updatedAt: "desc" }, take: TAKE, select: { id: true, title: true, status: true, publishedAt: true, publishedUrl: true } }),
    db.videoRender.findMany({ where: { workspaceId: workspace.id, topicId: topic.id }, orderBy: { createdAt: "desc" }, take: TAKE, select: { id: true, title: true, status: true, createdAt: true } }),
    db.socialPost.findMany({ where: { workspaceId: workspace.id, topicId: topic.id }, orderBy: [{ publishedAt: "desc" }, { scheduledAt: "desc" }], take: TAKE, select: { id: true, text: true, status: true, scheduledAt: true, publishedAt: true } }),
    db.script.findMany({ where: { channel: { workspaceId: workspace.id }, idea: { topicId: topic.id } }, orderBy: { updatedAt: "desc" }, take: TAKE, select: { id: true, title: true, status: true, workflow: true } }),
  ]);

  type Mini = { key: string; format: "article" | "video" | "social"; title: string; state: BoardState; href: string | null };
  const mini: Mini[] = [
    ...articleIdeas.map((i) => ({ key: `a-${i.id}`, format: "article" as const, title: i.title, state: ARTICLE_STATE[i.status] ?? "discovered", href: i.postId ? `/blog/${i.postId}` : null })),
    ...videoIdeas.map((i) => ({ key: `v-${i.id}`, format: "video" as const, title: i.title, state: VIDEO_STATE[i.status] ?? "discovered", href: `/channels/${i.channelId}/ideas/${i.id}` })),
    ...socialIdeas.map((i) => ({ key: `s-${i.id}`, format: "social" as const, title: i.hook, state: SOCIAL_STATE[i.status] ?? "discovered", href: i.socialPostId ? `/social/${i.socialPostId}/edit` : null })),
  ];
  const by = (s: BoardState) => mini.filter((m) => m.state === s);
  const openCount = by("discovered").length + by("approved").length;
  const made = articles.length + scripts.length + renders.length + posts.length;
  const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null);

  return (
    <div>
      <Link href="/ideas/topics" className="text-xs font-mono text-[var(--mute)] hover:text-[var(--accent)] flex items-center gap-1 mb-3"><ArrowLeft className="w-3 h-3" /> All Topics</Link>

      <StageHeader
        title={topic.name}
        sentence={
          topic.status !== "active"
            ? "Archived — discovery skips it; everything tagged with it stays tagged."
            : mini.length === 0
              ? "Nothing about this yet. Discover ideas for it, or tag existing ones on the board."
              : `${openCount} idea${openCount === 1 ? "" : "s"} open, ${made} thing${made === 1 ? "" : "s"} made from it.`
        }
        counts={[
          ...STATES.map((s) => ({ label: s.state, n: by(s.state).length, hue: s.hue })),
          { label: "made", n: made, href: "#made" },
        ]}
      />

      {(ok || err) && (
        <p className="text-xs mb-3 px-3 py-2 rounded-lg" style={ok ? { background: "var(--green-soft)", color: "var(--green-on)" } : { background: "var(--rose-soft)", color: "var(--rose-on)" }}>{ok ?? err}</p>
      )}

      {/* What it is, and the actions */}
      <div className="card mb-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-64">
            {topic.description ? <p className="text-sm m-0">{topic.description}</p> : <p className="text-sm text-[var(--mute)] m-0">No description yet.</p>}
            {phrases.length > 0 && <p className="text-[11px] font-mono text-[var(--mute)] mt-1.5 flex items-center gap-1 flex-wrap"><Tags className="w-3 h-3" /> {phrases.join(" · ")}</p>}
            {topic.priority > 0 && <p className="text-[11px] mt-1.5" style={{ color: "var(--violet-on)" }}>Priority {topic.priority} — leads discovery and is filled first.</p>}
          </div>
          {editor && (
            <div className="flex flex-wrap items-center gap-2">
              {topic.status === "active" && (
                <form action={discoverIdeasAction}>
                  <input type="hidden" name="topicId" value={topic.id} />
                  <input type="hidden" name="formats" value="article" />
                  <SubmitButton className="btn primary sm" pendingText="Discovering…"><Sparkles className="w-3.5 h-3.5" /> Discover ideas for this Topic</SubmitButton>
                </form>
              )}
              <form action={updateTopicAction} className="flex items-center gap-1.5">
                <input type="hidden" name="id" value={topic.id} />
                <input type="hidden" name="back" value={back} />
                <label className="text-[11px] text-[var(--mute)]">Priority</label>
                <input name="priority" type="number" min={0} max={10} step={1} defaultValue={topic.priority} className="w-14 font-mono text-xs" aria-label="Priority 0–10" />
                <SubmitButton className="btn sm" pendingText="…">Set</SubmitButton>
              </form>
              <form action={toggleTopicStatusAction}>
                <input type="hidden" name="id" value={topic.id} />
                <input type="hidden" name="back" value={back} />
                <button className="btn sm" title={topic.status === "active" ? "Archive — stops discovery for it; nothing tagged with it changes" : "Reactivate"}>
                  {topic.status === "active" ? <><Archive className="w-3.5 h-3.5" /> Archive</> : <><Check className="w-3.5 h-3.5" /> Reactivate</>}
                </button>
              </form>
            </div>
          )}
        </div>
        <p className="text-[11px] text-[var(--mute)] mt-2 m-0">Edit the description and phrases on <Link href="/ideas/topics" className="underline">Topics</Link>.</p>
      </div>

      {/* Ideas about it, the board's three columns */}
      <h2 className="font-mono text-[13px] font-bold mb-2">Ideas</h2>
      {mini.length === 0 ? (
        <div className="mb-4">
          <EmptyState
            line="No ideas carry this Topic yet."
            note={topic.status === "active" ? "Discover runs for this Topic alone and every idea it writes is tagged with it. Existing ideas can be tagged on the board." : "It is archived, so discovery skips it."}
            action={editor && topic.status === "active" ? { label: "Discover ideas for this Topic", run: discoverIdeasAction, pendingText: "Discovering…", fields: { topicId: topic.id, formats: "article" } } : { label: "Open the board", href: "/ideas" }}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          {STATES.map((col) => {
            const items = by(col.state);
            return (
              <section key={col.state} className="card">
                <h3 className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: `var(--${col.hue}-on)` }}>
                  {col.title} <span className="font-mono">{items.length}</span>
                </h3>
                {items.length === 0 ? (
                  <p className="text-[11px] text-[var(--mute)] py-1">—</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {items.slice(0, 15).map((m) => (
                      <li key={m.key} className="text-xs flex items-start gap-1.5">
                        <StateChip label={m.format === "article" ? "Article" : m.format === "video" ? "Video" : "Post"} hue={m.format === "article" ? "rose" : m.format === "video" ? "violet" : "blue"} />
                        {m.href ? <Link href={m.href} className="hover:underline leading-snug">{m.title}</Link> : <span className="leading-snug">{m.title}</span>}
                      </li>
                    ))}
                    {items.length > 15 && <li className="text-[11px] text-[var(--mute)]"><Link href="/ideas" className="underline">and {items.length - 15} more on the board</Link></li>}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* Made and out */}
      <h2 id="made" className="font-mono text-[13px] font-bold mb-2">Made from it</h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
        <section className="card">
          <h3 className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--rose-on)" }}>Articles <span className="font-mono">{articles.length}</span></h3>
          {articles.length === 0 ? <p className="text-[11px] text-[var(--mute)] py-1">None yet.</p> : (
            <ul className="flex flex-col gap-1.5">
              {articles.map((a) => (
                <li key={a.id} className="text-xs flex items-start gap-1.5">
                  <StateChip label={a.status.replace("_", " ")} hue={a.status === "published" ? "green" : a.status === "final_approval" ? "blue" : "amber"} />
                  <Link href={`/blog/${a.id}`} className="hover:underline leading-snug flex-1">{a.title}</Link>
                  {a.publishedAt && <span className="font-mono text-[10px] text-[var(--mute)] shrink-0">{fmtDate(a.publishedAt)}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h3 className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--violet-on)" }}>Scripts &amp; renders <span className="font-mono">{scripts.length + renders.length}</span></h3>
          {scripts.length + renders.length === 0 ? <p className="text-[11px] text-[var(--mute)] py-1">None yet.</p> : (
            <ul className="flex flex-col gap-1.5">
              {scripts.map((s) => (
                <li key={`s-${s.id}`} className="text-xs flex items-start gap-1.5">
                  <StateChip label="script" hue="violet" />
                  <Link href={s.workflow === "builder" ? `/scripts/${s.id}/builder` : `/scripts/${s.id}`} className="hover:underline leading-snug">{s.title}</Link>
                </li>
              ))}
              {renders.map((r) => (
                <li key={`r-${r.id}`} className="text-xs flex items-start gap-1.5">
                  <StateChip label={r.status} hue={r.status === "done" ? "green" : r.status === "failed" ? "rose" : "amber"} />
                  <Link href={`/videos/${r.id}`} className="hover:underline leading-snug">{r.title}</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h3 className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--blue-on)" }}>Social posts <span className="font-mono">{posts.length}</span></h3>
          {posts.length === 0 ? <p className="text-[11px] text-[var(--mute)] py-1">None yet.</p> : (
            <ul className="flex flex-col gap-1.5">
              {posts.map((p) => (
                <li key={p.id} className="text-xs flex items-start gap-1.5">
                  <StateChip label={p.status} hue={p.status === "posted" ? "green" : p.status === "scheduled" ? "blue" : p.status === "failed" ? "rose" : "amber"} />
                  <Link href={`/social/${p.id}/edit`} className="hover:underline leading-snug flex-1 line-clamp-1">{p.text}</Link>
                  {(p.publishedAt ?? p.scheduledAt) && <span className="font-mono text-[10px] text-[var(--mute)] shrink-0">{fmtDate(p.publishedAt ?? p.scheduledAt)}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
