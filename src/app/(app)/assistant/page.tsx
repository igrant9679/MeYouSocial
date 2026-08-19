import Link from "next/link";
import { Bot, MessageSquarePlus } from "lucide-react";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { AssistantComposer } from "@/components/AssistantComposer";
import { TOOLS, REFUSED_INTENTS } from "@/lib/assistant/tools";

/** The cross-app assistant: a new conversation, plus what it can and can't do. */
export default async function AssistantPage() {
  const { workspace, user } = await requireRole("EDITOR");
  const threads = await db.assistantThread.findMany({
    where: { workspaceId: workspace.id, userId: user.id },
    orderBy: { updatedAt: "desc" },
    take: 12,
    select: { id: true, title: true, updatedAt: true },
  });

  return (
    <main className="p-6 w-full max-w-4xl">
      <div className="flex items-center gap-3 mb-5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--violet-soft)", color: "var(--violet-on)" }}>
          <Bot className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-2xl leading-tight">Assistant</h1>
          <p className="text-xs text-[var(--mute)]">
            Ask for work across the app — research, ideas, articles, social drafts. Everything it makes lands where you review it.
          </p>
        </div>
      </div>

      <AssistantComposer threadId={null} autoFocus />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
        <div className="card">
          <h2 className="text-sm font-semibold mb-1">What it can do</h2>
          <ul className="text-xs text-[var(--mute)] flex flex-col gap-1">
            {TOOLS.map((t) => (
              <li key={t.name}>
                <span className="font-mono text-[10px] text-[var(--ink)]">{t.name}</span>
                {t.readOnly && <span className="font-mono text-[10px]"> · reads only</span>}
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold mb-1">What it won&apos;t do</h2>
          <ul className="text-xs text-[var(--mute)] list-disc pl-4 flex flex-col gap-1">
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
