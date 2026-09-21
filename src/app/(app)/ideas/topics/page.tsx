import Link from "next/link";
import { Archive, Check, ChevronRight, Sparkles, Tags, Trash2 } from "lucide-react";
import { requireMembership, canEdit } from "@/lib/acl";
import { SubmitButton } from "@/components/SubmitButton";
import { EmptyState } from "@/components/EmptyState";
import { AiAssist } from "@/components/AiAssist";
import { StageHeader } from "@/components/StageShell";
import { topicLedgers, topicSuggestions, untaggedIdeaCount } from "@/lib/topics";
import { createTopicAction, deleteTopicAction, dismissTopicSuggestionAction, toggleTopicStatusAction, updateTopicAction } from "@/app/actions/brand-hub";
import { discoverIdeasAction } from "@/app/actions/ideas";

// Topics — the spine (2026-09-21). Moved here from Brand because a Topic is
// not identity, it is what the loop is ABOUT: Research is matched to it,
// ideas in every format are discovered per Topic, what gets made carries it,
// and Measure reports what each one earned. This tab manages them and shows
// each one's ledger; the per-Topic page (/ideas/topics/<id>) is the same
// ledger from the inside.

type SP = { ok?: string; err?: string };
const BACK = "/ideas/topics";

export default async function TopicsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { workspace, membership } = await requireMembership();
  const { ok, err } = await searchParams;
  const editor = canEdit(membership.role);
  const [ledgers, untagged, suggestions] = await Promise.all([topicLedgers(workspace.id), untaggedIdeaCount(workspace.id), topicSuggestions(workspace.id)]);
  const active = ledgers.filter((t) => t.status === "active");
  const archived = ledgers.filter((t) => t.status !== "active");
  const quiet = active.filter((t) => t.ideas.article + t.ideas.video + t.ideas.social === 0);

  return (
    <div>
      <StageHeader
        title="Topics"
        sentence={
          active.length === 0
            ? "The themes this company publishes about. Everything hangs off them — add one and discovery, the board and Measure all have somewhere to aim."
            : quiet.length > 0
              ? `${active.length} active Topic${active.length === 1 ? "" : "s"}; ${quiet.length} ${quiet.length === 1 ? "has" : "have"} no ideas yet — Discover fills ${quiet.length === 1 ? "it" : "them"}.`
              : `${active.length} active Topic${active.length === 1 ? "" : "s"}, each with ideas in the pipeline.`
        }
        counts={[
          { label: "active", n: active.length, hue: "violet" },
          { label: "archived", n: archived.length },
          { label: "ideas with no topic", n: untagged, href: "/ideas", hue: untagged > 0 ? "amber" : undefined },
        ]}
      />

      {(ok || err) && (
        <p className="text-xs mb-3 px-3 py-2 rounded-lg" style={ok ? { background: "var(--green-soft)", color: "var(--green-on)" } : { background: "var(--rose-soft)", color: "var(--rose-on)" }}>{ok ?? err}</p>
      )}

      {editor && (
        <form action={createTopicAction} className="card mb-4 flex flex-wrap items-end gap-2">
          <input type="hidden" name="back" value={BACK} />
          <label className="text-sm flex-1 min-w-[180px]">
            <span className="block text-xs text-[var(--mute)] mb-1">New Topic</span>
            <input name="name" required maxLength={120} placeholder="e.g. Nonprofit fundraising" className="w-full" />
          </label>
          <label className="text-sm flex-1 min-w-[200px]">
            <span className="block text-xs text-[var(--mute)] mb-1">One line on what it covers (optional)</span>
            <input name="description" maxLength={500} placeholder="What this topic covers" className="w-full" />
          </label>
          <label className="text-sm flex-[2] min-w-[220px]">
            <span className="block text-xs text-[var(--mute)] mb-1">Related phrases (comma-separated, optional)</span>
            <input name="keywords" placeholder="donor retention, giving days" className="w-full" />
          </label>
          <SubmitButton className="btn primary" id="add-topic">Add topic</SubmitButton>
        </form>
      )}

      {untagged > 0 && (
        <p className="text-[11px] text-[var(--mute)] mb-3">
          {untagged} idea{untagged === 1 ? "" : "s"} came before Topics and sit in the board&apos;s <Link href="/ideas" className="underline">No topic yet</Link> lane — tag each one and it moves to its Topic.
        </p>
      )}

      {/* Suggested: keyword clusters with no Topic of that name. The video
          count is a keyword match against indexed titles — computed, labelled,
          never stored. A person activates or discards; nothing here is
          created on its own. */}
      {editor && suggestions.length > 0 && (
        <section className="card mb-4" style={{ background: "var(--zebra)" }}>
          <h2 className="font-mono text-[12px] font-bold mb-0.5">Suggested from your keywords</h2>
          <p className="text-[11px] text-[var(--mute)] mb-2">Each is a keyword cluster that is not a Topic yet. Videos = indexed competitor titles its phrases match, by keyword.</p>
          <ul className="flex flex-col gap-1.5">
            {suggestions.map((sg) => (
              <li key={sg.name} className="flex items-center gap-2 flex-wrap text-xs">
                <span className="font-semibold">{sg.name}</span>
                <span className="font-mono text-[10px] text-[var(--mute)]">{sg.keywords} keyword{sg.keywords === 1 ? "" : "s"} · {sg.videos} video{sg.videos === 1 ? "" : "s"} matched</span>
                <span className="text-[10px] text-[var(--mute)] truncate max-w-md">{sg.phrases.slice(0, 6).join(" · ")}</span>
                <span className="flex-1" />
                <form action={createTopicAction}>
                  <input type="hidden" name="name" value={sg.name} />
                  <input type="hidden" name="keywords" value={sg.phrases.join(", ")} />
                  <input type="hidden" name="back" value={BACK} />
                  <SubmitButton className="btn sm primary" pendingText="Adding…">Add as Topic</SubmitButton>
                </form>
                <form action={dismissTopicSuggestionAction}>
                  <input type="hidden" name="name" value={sg.name} />
                  <input type="hidden" name="back" value={BACK} />
                  <SubmitButton className="btn sm" pendingText="…" title="Stop suggesting this cluster">Discard</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {ledgers.length === 0 ? (
        <EmptyState
          line="No Topics yet."
          note="A Topic is a theme this company publishes about — “Scholarship management”, “Grant compliance”. Research is matched to it, ideas in every format are discovered per Topic, and Measure reports what each one earned."
          action={editor ? { label: "Add the first topic", href: "#add-topic" } : null}
          tone="attention"
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {active.map((t) => <TopicRow key={t.id} t={t} editor={editor} />)}
          </ul>
          {archived.length > 0 && (
            <details className="mt-4">
              <summary className="text-xs cursor-pointer text-[var(--mute)]">Archived · {archived.length} — not discovered for, still on what they tagged</summary>
              <ul className="flex flex-col gap-2 mt-2">
                {archived.map((t) => <TopicRow key={t.id} t={t} editor={editor} />)}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function TopicRow({ t, editor }: { t: Awaited<ReturnType<typeof topicLedgers>>[number]; editor: boolean }) {
  const archived = t.status !== "active";
  const ideas = t.ideas.article + t.ideas.video + t.ideas.social;
  const made = t.made.articles + t.made.scripts + t.made.posts;
  const out = t.out.articles + t.out.posts;
  return (
    <li className="card" style={archived ? { opacity: 0.7 } : undefined}>
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <Link href={`/ideas/topics/${t.id}`} className="font-semibold text-sm hover:underline flex items-center gap-1">{t.name} <ChevronRight className="w-3.5 h-3.5 text-[var(--mute)]" /></Link>
        {archived && <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 rounded-full" style={{ background: "var(--panel)", color: "var(--mute)" }}>archived</span>}
        {/* A raised priority used to be invisible everywhere: only the
            recommendation engine set it, and nothing displayed it. */}
        {t.priority > 0 && (
          <span
            className="font-mono text-[10px] px-1.5 py-0.5 rounded-full"
            style={{ background: "var(--violet-soft)", color: "var(--violet-on)" }}
            title={`Priority ${t.priority} — this topic leads discovery. Set it back to 0 below to undo.`}
          >
            priority {t.priority}
          </span>
        )}
        <span className="flex-1" />
        {editor && !archived && (
          <form action={discoverIdeasAction}>
            <input type="hidden" name="topicId" value={t.id} />
            <input type="hidden" name="formats" value="article" />
            <SubmitButton className="btn sm" pendingText="Discovering…" title="Discover article ideas for this Topic only"><Sparkles className="w-3.5 h-3.5" /> Discover</SubmitButton>
          </form>
        )}
        {editor && (
          <>
            <form action={toggleTopicStatusAction}>
              <input type="hidden" name="id" value={t.id} />
              <input type="hidden" name="back" value={BACK} />
              <button className="btn sm" title={archived ? "Reactivate" : "Archive — stops discovery for it; nothing tagged with it changes"}>
                {archived ? <Check className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
              </button>
            </form>
            <form action={deleteTopicAction}>
              <input type="hidden" name="id" value={t.id} />
              <input type="hidden" name="back" value={BACK} />
              <button className="btn sm" title="Delete — clears the tag from everything that carried it; deletes no content"><Trash2 className="w-3.5 h-3.5" /></button>
            </form>
          </>
        )}
      </div>

      {/* The ledger: counts only, every one a fact. What the Topic EARNED is
          on Measure → Topics, where a dash can mean "not measured". */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--mute)] mb-2 font-mono">
        <span title="Ideas in any state, by format">
          <b className="text-[var(--ink)] tabular-nums">{ideas}</b> ideas{ideas > 0 ? ` · ${[t.ideas.article ? `${t.ideas.article} article` : "", t.ideas.video ? `${t.ideas.video} video` : "", t.ideas.social ? `${t.ideas.social} social` : ""].filter(Boolean).join(", ")}` : ""}
        </span>
        <span title="Discovered, waiting on a yes or no"><b className="text-[var(--ink)] tabular-nums">{t.ideas.discovered}</b> to triage</span>
        <span title="Articles, scripts and social posts that exist for it"><b className="text-[var(--ink)] tabular-nums">{made}</b> made</span>
        <span title="Published articles and posted social"><b className="text-[var(--ink)] tabular-nums">{out}</b> out</span>
      </div>

      {editor ? (
        <form action={updateTopicAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={t.id} />
          <input type="hidden" name="back" value={BACK} />
          <label className="text-xs flex-1 min-w-[180px]">
            <span className="block text-[10px] text-[var(--mute)] mb-1">Description</span>
            <input name="description" defaultValue={t.description ?? ""} className="w-full text-xs" placeholder="What this topic covers" />
          </label>
          <AiAssist field="topic.description" target="description" extra={{ "Topic name": t.name }} label="Draft" className="!mt-0" />
          <label className="text-xs flex-1 min-w-[180px]">
            <span className="block text-[10px] text-[var(--mute)] mb-1">Related phrases</span>
            <input name="keywords" defaultValue={t.phrases.join(", ")} className="w-full text-xs" />
          </label>
          <label className="text-xs">
            <span className="block text-[10px] text-[var(--mute)] mb-1">Priority</span>
            <input
              name="priority"
              type="number"
              min={0}
              max={10}
              step={1}
              defaultValue={t.priority}
              className="w-16 font-mono text-xs"
              title="0–10. Higher topics lead discovery and are filled first. Reset to 0 to undo a “raise priority” recommendation."
            />
          </label>
          <SubmitButton className="btn sm">Save</SubmitButton>
        </form>
      ) : (
        <>
          {t.description && <p className="text-xs text-[var(--slate)]">{t.description}</p>}
          {t.phrases.length > 0 && <p className="text-[11px] font-mono text-[var(--mute)] mt-1 flex items-center gap-1"><Tags className="w-3 h-3" /> {t.phrases.join(" · ")}</p>}
        </>
      )}
    </li>
  );
}
