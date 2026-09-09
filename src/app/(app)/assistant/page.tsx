import Link from "next/link";
import { Bot, MessageSquarePlus, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { getActiveChannel } from "@/lib/channel";
import { AssistantComposer } from "@/components/AssistantComposer";
import { TOOLS, REFUSED_INTENTS } from "@/lib/assistant/tools";

const STARTERS = [
  "What should I do next?",
  "What needs my attention?",
  "Find three article ideas about donor retention",
  "Which articles are missing SEO metadata?",
  "What's going out on social this week?",
  "Show me this month's results",
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

      <div className="flex flex-wrap gap-1.5 mt-3">
        {STARTERS.map((s) => (
          <Link key={s} href={`/assistant?q=${encodeURIComponent(s)}`} className="btn sm inline-flex items-center gap-1"><Sparkles className="w-3 h-3" /> {s}</Link>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
        <div className="card">
          <h2 className="text-sm font-semibold mb-1">It reads</h2>
          <p className="text-[10px] text-[var(--mute)] mb-2">The pipeline, the Inbox, ideas, articles and their checks, social, keywords, topics, Intel channels and videos, transcripts, web pages, uploads, connections, dials, results, reports, the guide.</p>
          <ul className="text-[10px] font-mono text-[var(--mute)] flex flex-wrap gap-x-2 gap-y-0.5">
            {reads.map((t) => <li key={t.name}>{t.name}</li>)}
          </ul>
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold mb-1">It does</h2>
          <p className="text-[10px] text-[var(--mute)] mb-2">Everything that lands where you review it: ideas, keywords, topics, drafts, SEO, images, findings, scripts, social drafts, advancing an article.</p>
          <ul className="text-[10px] font-mono text-[var(--mute)] flex flex-wrap gap-x-2 gap-y-0.5">
            {acts.map((t) => <li key={t.name}>{t.name}</li>)}
          </ul>
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold mb-1">It asks first</h2>
          <p className="text-[10px] text-[var(--mute)] mb-2">Outward-facing or hard to undo — proposed as &ldquo;I&apos;m about to… Go ahead?&rdquo; and run only on your yes. Admin-only ones refuse for editors.</p>
          <ul className="text-[10px] font-mono text-[var(--mute)] flex flex-wrap gap-x-2 gap-y-0.5">
            {asks.map((t) => <li key={t.name}>{t.name}</li>)}
          </ul>
          <h3 className="text-xs font-semibold mt-3 mb-1">It won&apos;t</h3>
          <ul className="text-[10px] text-[var(--mute)] list-disc pl-4 flex flex-col gap-0.5">
            {REFUSED_INTENTS.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      </div>

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
