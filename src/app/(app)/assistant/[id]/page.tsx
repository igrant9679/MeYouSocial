import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bot, User as UserIcon, Wrench, ExternalLink, HelpCircle, ShieldQuestion } from "lucide-react";
import { requireRole } from "@/lib/acl";
import { getActiveChannel } from "@/lib/channel";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { AssistantComposer } from "@/components/AssistantComposer";
import { MarkdownMessage } from "@/components/MarkdownMessage";
import { ConfirmCard } from "@/components/ConfirmCard";
import { displayTimeZone } from "@/lib/display-zone";
import { formatZonedMoment } from "@/lib/zoned-dates";
import type { AssistantStep, PendingAction } from "@/lib/assistant/run";
// A quick reply is just a message — the same action the composer uses.
import { sendAssistantMessageAction as sendQuick } from "@/app/actions/assistant";
import { undoAssistantStepFormAction } from "@/app/actions/assistant-undo";
import { openUndos } from "@/lib/assistant/undo";
import { Undo2 } from "lucide-react";

/** One conversation. Tool calls are shown, not summarised — the point is that
 *  you can see what it actually did rather than take its word for it. A
 *  question's choices and an unanswered proposal render as buttons that post
 *  the reply, so the page is as interactive as the dock. */
export default async function AssistantThreadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params;
  const { ok, err } = await searchParams;
  const { workspace, user } = await requireRole("EDITOR");
  const { active } = await getActiveChannel();
  const thread = await db.assistantThread.findFirst({
    where: { id, workspaceId: workspace.id, userId: user.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!thread) notFound();
  const pending = thread.pending ? readJson<PendingAction | null>(thread.pending, null) : null;
  const last = thread.messages[thread.messages.length - 1];
  const lastSteps = last ? readJson<AssistantStep[]>(last.steps, []) : [];
  const lastAsk = lastSteps.find((s): s is Extract<AssistantStep, { kind: "ask" }> => s.kind === "ask");
  const lastAnswer = lastSteps.find((s): s is Extract<AssistantStep, { kind: "answer" }> => s.kind === "answer");
  const quick = pending ? ["Yes, do it", "No"] : lastAsk?.options ?? [];
  // The Yes is bound to the proposal it answers (E-ENG-01).
  const lastConfirm = lastSteps.find((s): s is Extract<AssistantStep, { kind: "confirm" }> => s.kind === "confirm");
  // E-SHL-09: the reader's own zone when they chose one — this page only shows times.
  const tz = await displayTimeZone(workspace.id);

  return (
    <main className="p-6 w-full max-w-4xl">
      <Link href="/assistant" className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Assistant
      </Link>
      <h1 className="font-mono font-bold text-xl mb-4">{thread.title ?? "Conversation"}</h1>
      {(ok || err) && (
        <p className="text-xs mb-3 px-3 py-2 rounded-lg" style={ok ? { background: "var(--green-soft)", color: "var(--green-on)" } : { background: "var(--rose-soft)", color: "var(--rose-on)" }}>{ok ?? err}</p>
      )}

      <div className="flex flex-col gap-3 mb-4">
        {thread.messages.map((m) => {
          const steps = readJson<AssistantStep[]>(m.steps, []);
          const tools = steps.filter((s): s is Extract<AssistantStep, { kind: "tool" }> => s.kind === "tool");
          const confirm = steps.find((s): s is Extract<AssistantStep, { kind: "confirm" }> => s.kind === "confirm");
          // E-ENG-09: the steps that can still be put back, and the ones that were.
          const undos = openUndos(steps);
          const undone = steps.flatMap((s) => (s.kind === "tool" && s.undo?.done ? [s] : []));
          return (
            <div key={m.id} className="card">
              <div className="flex items-center gap-2 mb-1">
                {m.role === "user"
                  ? <UserIcon className="w-3.5 h-3.5" style={{ color: "var(--mute)" }} />
                  : <Bot className="w-3.5 h-3.5" style={{ color: "var(--violet-on)" }} />}
                <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--mute)]">{m.role}</span>
                {m.role === "assistant" && (m.inputTokens != null || m.outputTokens != null) && (
                  <span className="font-mono text-[10px] text-[var(--mute)]" data-reply-tokens title="What this reply's model calls took — Settings → Usage has the month">
                    {(m.inputTokens ?? 0).toLocaleString("en-GB")} in · {(m.outputTokens ?? 0).toLocaleString("en-GB")} out
                  </span>
                )}
                {confirm && <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full inline-flex items-center gap-1" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}><ShieldQuestion className="w-3 h-3" /> waiting for your yes</span>}
              </div>
              {m.role === "user"
                ? <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</p>
                : <MarkdownMessage content={m.content} />}
              {confirm && (
                <ConfirmCard tool={confirm.tool} summary={confirm.summary} preview={confirm.preview}
                  expires={confirm.expiresAt ? formatZonedMoment(new Date(confirm.expiresAt), tz) : null} />
              )}
              {tools.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[10px] font-mono text-[var(--mute)] inline-flex items-center gap-1">
                    <Wrench className="w-3 h-3" /> {tools.length} tool call{tools.length === 1 ? "" : "s"}
                  </summary>
                  <ul className="mt-1 flex flex-col gap-1">
                    {tools.map((s, i) => (
                      <li key={i} className="rounded bg-[var(--zebra)] px-2 py-1">
                        <span className="font-mono text-[10px]" style={{ color: s.ok ? "var(--green-on)" : "var(--rose-on)" }}>{s.tool}</span>
                        <span className="font-mono text-[10px] text-[var(--mute)]"> {JSON.stringify(s.args)}</span>
                        <pre className="text-[10px] whitespace-pre-wrap text-[var(--mute)] mt-0.5">{s.output}</pre>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {(undos.length > 0 || undone.length > 0) && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {undos.map(({ index, undo }) => (
                    <form key={index} action={undoAssistantStepFormAction}>
                      <input type="hidden" name="messageId" value={m.id} />
                      <input type="hidden" name="index" value={index} />
                      <button className="btn sm inline-flex items-center gap-1" data-undo={index} title={`Offered until ${formatZonedMoment(new Date(undo.until), tz)}`}>
                        <Undo2 className="w-3 h-3" /> {undo.label}
                      </button>
                    </form>
                  ))}
                  {undone.map((s, i) => (
                    <span key={i} className="text-[10px] font-mono text-[var(--mute)]" data-undone>↩ undone {s.undo?.done ? formatZonedMoment(new Date(s.undo.done), tz) : ""}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {(quick.length > 0 || (lastAnswer?.links?.length ?? 0) > 0) && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {quick.map((o) => (
            <form key={o} action={sendQuick}>
              <input type="hidden" name="threadId" value={thread.id} />
              <input type="hidden" name="message" value={o} />
              {/^yes/i.test(o) && pending && lastConfirm?.nonce && <input type="hidden" name="confirm" value={lastConfirm.nonce} />}
              <button className={`btn sm ${/^yes/i.test(o) ? "primary" : ""}`}>{o}</button>
            </form>
          ))}
          {lastAnswer?.links?.map((l) => (
            <Link key={l.href} href={l.href} className="btn sm inline-flex items-center gap-1"><ExternalLink className="w-3 h-3" /> {l.label}</Link>
          ))}
        </div>
      )}

      <AssistantComposer threadId={thread.id} channelId={active?.id ?? null} />
      <p className="text-[10px] text-[var(--mute)] mt-2 inline-flex items-center gap-1"><HelpCircle className="w-3 h-3" /> Anything outward-facing or hard to undo is proposed first and runs only when you say yes. The same conversation is in the Ask dock on every page.</p>
    </main>
  );
}
