import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bot, User as UserIcon, Wrench } from "lucide-react";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { AssistantComposer } from "@/components/AssistantComposer";
import type { AssistantStep } from "@/lib/assistant/run";

/** One conversation. Tool calls are shown, not summarised — the point is that
 *  you can see what it actually did rather than take its word for it. */
export default async function AssistantThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace, user } = await requireRole("EDITOR");
  const thread = await db.assistantThread.findFirst({
    where: { id, workspaceId: workspace.id, userId: user.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!thread) notFound();

  return (
    <main className="p-6 w-full max-w-4xl">
      <Link href="/assistant" className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Assistant
      </Link>
      <h1 className="font-mono font-bold text-xl mb-4">{thread.title ?? "Conversation"}</h1>

      <div className="flex flex-col gap-3 mb-4">
        {thread.messages.map((m) => {
          const steps = readJson<AssistantStep[]>(m.steps, []);
          const tools = steps.filter((s): s is Extract<AssistantStep, { kind: "tool" }> => s.kind === "tool");
          return (
            <div key={m.id} className="card">
              <div className="flex items-center gap-2 mb-1">
                {m.role === "user"
                  ? <UserIcon className="w-3.5 h-3.5" style={{ color: "var(--mute)" }} />
                  : <Bot className="w-3.5 h-3.5" style={{ color: "var(--violet-on)" }} />}
                <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--mute)]">{m.role}</span>
              </div>
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</p>
              {tools.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[10px] font-mono text-[var(--mute)] inline-flex items-center gap-1">
                    <Wrench className="w-3 h-3" /> {tools.length} tool call{tools.length === 1 ? "" : "s"}
                  </summary>
                  <ul className="mt-1 flex flex-col gap-1">
                    {tools.map((s, i) => (
                      <li key={i} className="rounded bg-[var(--zebra)] px-2 py-1">
                        <span className="font-mono text-[10px]" style={{ color: s.ok ? "var(--green-on)" : "var(--rose-on)" }}>
                          {s.tool}
                        </span>
                        <span className="font-mono text-[10px] text-[var(--mute)]"> {JSON.stringify(s.args)}</span>
                        <pre className="text-[10px] whitespace-pre-wrap text-[var(--mute)] mt-0.5">{s.output}</pre>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          );
        })}
      </div>

      <AssistantComposer threadId={thread.id} />
    </main>
  );
}
