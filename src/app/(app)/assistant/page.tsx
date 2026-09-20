import Link from "next/link";
import { Bot, MessageSquarePlus, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { getActiveChannel } from "@/lib/channel";
import { AssistantComposer } from "@/components/AssistantComposer";
import { TOOLS, REFUSED_INTENTS } from "@/lib/assistant/tools";

/**
 * ⚠ What you can ASK, in sentences — not the tool registry (audit B4/D5).
 *
 * This page used to print all 78 tool names in three columns of 10px mono:
 * `list_ideas`, `set_publish_day`, `intel_video`… It read as API documentation
 * for a product whose whole promise is that you talk to it. Nobody learns what
 * to say from a function name.
 *
 * Every example below is backed by a tool that genuinely exists — the name is
 * in `backedBy` so this list cannot drift into advertising something the
 * assistant can't do. The registry itself is still here, one disclosure down.
 */
const ASK_GROUPS: Array<{ title: string; blurb: string; examples: Array<{ q: string; backedBy: string }> }> = [
  {
    title: "Work out what to do",
    blurb: "It reads the same pipeline you do, and ranks what is worth doing now.",
    examples: [
      { q: "What should I do next?", backedBy: "next_steps" },
      { q: "What's waiting on me?", backedBy: "inbox_items" },
      { q: "Why is the donor-fatigue article still held?", backedBy: "article_checks" },
    ],
  },
  {
    title: "Find something worth writing",
    blurb: "Grounded in your organisation profile, keywords and indexed competitors.",
    examples: [
      { q: "Find three article ideas about grant reporting deadlines", backedBy: "discover_ideas" },
      { q: "Which competitor videos beat their own channel average this month?", backedBy: "list_outliers" },
      { q: "What keywords are we missing?", backedBy: "discover_keywords" },
    ],
  },
  {
    title: "Move the work forward",
    blurb: "Everything here lands somewhere you review it before it goes out.",
    examples: [
      { q: "Draft the approved idea about donor fatigue", backedBy: "draft_article" },
      { q: "Fill in the SEO for any article missing it", backedBy: "generate_seo" },
      { q: "Advance anything that passes every check", backedBy: "advance_article" },
    ],
  },
  {
    title: "Publish and post",
    blurb: "Anything outward-facing is proposed first and runs only on your yes.",
    examples: [
      { q: "What's going out on social this week?", backedBy: "list_social_posts" },
      { q: "Write a LinkedIn post about the newest article", backedBy: "draft_social_post" },
      { q: "Publish the article sitting at final approval", backedBy: "publish_article" },
    ],
  },
  {
    title: "Understand what happened",
    blurb: "Measured numbers only — a dash means not measured, never zero.",
    examples: [
      { q: "Show me this month's results", backedBy: "results_summary" },
      { q: "Audit my YouTube channel and give me a 90-day plan", backedBy: "youtube_audit" },
      { q: "When is the best time for us to post?", backedBy: "best_time" },
    ],
  },
  {
    title: "Change how the engine runs",
    blurb: "The dials under Settings, asked for in words. It confirms before each one.",
    examples: [
      { q: "Set the weekly article target to two", backedBy: "set_weekly_articles" },
      { q: "Stop posting to social for now", backedBy: "set_social_dial" },
      { q: "Run the autopilot now", backedBy: "run_autopilot_now" },
    ],
  },
];

/**
 * The cross-app assistant: a new conversation, plus what it can and can't do.
 * `?q=` pre-fills the composer — the Intel pages' "Ask about this channel /
 * video" arrive this way (the Research chat folded in here, 2026-09-09).
 */
export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { workspace, user, active } = await getActiveChannel();
  const { q } = await searchParams;
  const threads = await db.assistantThread.findMany({
    where: { workspaceId: workspace.id, userId: user.id },
    orderBy: { updatedAt: "desc" },
    take: 12,
    select: { id: true, title: true, updatedAt: true },
  });
  const reads = TOOLS.filter((t) => t.readOnly);
  const acts = TOOLS.filter((t) => !t.readOnly && !t.confirm);
  const asks = TOOLS.filter((t) => t.confirm);

  return (
    <main className="p-6 w-full max-w-4xl">
      <div className="flex items-center gap-3 mb-5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--violet-soft)", color: "var(--violet-on)" }}>
          <Bot className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-2xl leading-tight">Assistant</h1>
          <p className="text-xs text-[var(--mute)]">
            Talk through research, ideas, drafts, publishing and the numbers — it does the work with you, asks before anything goes out, and shows every step.
            {active ? <> Your active channel is <b>{active.name}</b>; it knows its niche, audience, voice and memory.</> : null}
            {" "}The same conversation is the <b>Ask</b> dock on every page (Ctrl+/).
          </p>
        </div>
      </div>

      <AssistantComposer threadId={null} autoFocus defaultText={typeof q === "string" ? q.slice(0, 2000) : undefined} channelId={active?.id ?? null} />

      {/* ── What you can ask ─────────────────────────────────────────────
          Sentences, grouped by what someone is trying to get done. Each chip
          pre-fills the composer, so an example is one click from being a real
          question rather than something to retype. */}
      <h2 className="text-sm font-semibold mt-6 mb-2">Things to ask it</h2>
      <div className="grid grid-cols-1 @3xl:grid-cols-2 gap-3">
        {ASK_GROUPS.map((g) => (
          <section key={g.title} className="card">
            <h3 className="text-[13px] font-semibold m-0">{g.title}</h3>
            <p className="text-[11px] text-[var(--mute)] mt-0.5 mb-2">{g.blurb}</p>
            <ul className="flex flex-col gap-1 m-0 p-0">
              {g.examples.map((e) => (
                <li key={e.q}>
                  <Link
                    href={`/assistant?q=${encodeURIComponent(e.q)}`}
                    className="text-[12.5px] text-[var(--slate)] hover:text-[var(--ink)] inline-flex items-start gap-1.5 leading-snug"
                    title={`Runs the ${e.backedBy} tool`}
                  >
                    <Sparkles className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: "var(--violet-on)" }} aria-hidden />
                    <span className="underline decoration-[var(--line)] underline-offset-2">{e.q}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="text-[11px] text-[var(--mute)] mt-2">
        Those are examples, not a menu — ask in your own words. It asks back when a question is ambiguous.
      </p>

      {/* The registry, one disclosure down. It is genuinely useful when you
          want to know whether a capability exists at all — it just isn't how
          anyone learns to use the thing. */}
      <details className="card mt-4">
        <summary className="text-sm font-semibold cursor-pointer select-none">
          Everything it can do <span className="font-normal text-[var(--mute)]">— all {TOOLS.length} tools, and the four it refuses</span>
        </summary>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3">
          <div>
            <h3 className="text-xs font-semibold mb-1">It reads</h3>
            <p className="text-[10px] text-[var(--mute)] mb-2">The pipeline, the Inbox, ideas, articles and their checks, social, keywords, topics, Intel channels and videos, transcripts, web pages, uploads, connections, dials, results, reports, the guide.</p>
            <ul className="text-[10px] font-mono text-[var(--mute)] flex flex-wrap gap-x-2 gap-y-0.5">
              {reads.map((t) => <li key={t.name}>{t.name}</li>)}
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-semibold mb-1">It does</h3>
            <p className="text-[10px] text-[var(--mute)] mb-2">Everything that lands where you review it: ideas, keywords, topics, drafts, SEO, images, findings, scripts, social drafts, advancing an article.</p>
            <ul className="text-[10px] font-mono text-[var(--mute)] flex flex-wrap gap-x-2 gap-y-0.5">
              {acts.map((t) => <li key={t.name}>{t.name}</li>)}
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-semibold mb-1">It asks first</h3>
            <p className="text-[10px] text-[var(--mute)] mb-2">Outward-facing or hard to undo — proposed as &ldquo;I&apos;m about to… Go ahead?&rdquo; and run only on your yes. Admin-only ones refuse for editors.</p>
            <ul className="text-[10px] font-mono text-[var(--mute)] flex flex-wrap gap-x-2 gap-y-0.5">
              {asks.map((t) => <li key={t.name}>{t.name}</li>)}
            </ul>
            <h4 className="text-xs font-semibold mt-3 mb-1">It won&apos;t</h4>
            <ul className="text-[10px] text-[var(--mute)] list-disc pl-4 flex flex-col gap-0.5">
              {REFUSED_INTENTS.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </div>
        </div>
      </details>

      {threads.length > 0 && (
        <div className="card mt-4">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <MessageSquarePlus className="w-4 h-4" style={{ color: "var(--mute)" }} /> Earlier conversations
          </h2>
          <ul className="flex flex-col gap-1">
            {threads.map((t) => (
              <li key={t.id}>
                <Link href={`/assistant/${t.id}`} className="text-xs underline">
                  {t.title ?? "Untitled"}
                </Link>
                <span className="font-mono text-[10px] text-[var(--mute)]"> · {t.updatedAt.toISOString().slice(0, 16).replace("T", " ")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
