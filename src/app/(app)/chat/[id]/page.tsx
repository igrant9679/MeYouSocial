import Link from "next/link";
import { ArrowLeft, MessageCircle, Link2, Send, PenLine } from "lucide-react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { postMessageAction, addChatContextAction } from "@/app/actions/chat";
import { UploadButton } from "@/components/UploadButton";
import { PromptLibrary } from "@/components/PromptLibrary";

// Chat thread (MU-07). FR-CHAT-02/03/11 — messages with channel context.

export default async function ChatThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await requireMembership();
  const chat = await db.chat.findFirst({
    where: { id, channel: { workspaceId: workspace.id } },
    include: {
      channel: true,
      messages: { orderBy: { createdAt: "asc" } },
      contextItems: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!chat) notFound();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 max-w-[1100px]">
      <main className="card flex flex-col p-0 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3 border-b border-[var(--line)] flex items-center gap-2">
          <Link href="/chat" className="text-xs font-mono text-[var(--mute)] hover:text-[var(--accent)] flex items-center gap-1"><ArrowLeft className="w-3 h-3" /> All chats</Link>
          <span className="flex-1" />
          <span className="text-xs text-[var(--mute)]">Channel: <b>{chat.channel.name}</b></span>
        </div>

        {/* Messages */}
        <div className="flex-1 px-5 py-4 overflow-auto flex flex-col gap-3 min-h-[400px]">
          {chat.messages.length === 0 && (
            <div className="text-center py-12">
              <span className="w-12 h-12 rounded-2xl grid place-items-center mx-auto mb-3" style={{ background: "#EDE7FB", color: "#6D28D9" }}>
                <MessageCircle className="w-6 h-6" />
              </span>
              <p className="text-sm text-[var(--mute)]">Ask anything about your niche, paste a YouTube URL to analyze, or say <i className="font-mono">turn this into a script</i> to spin up a Canvas.</p>
            </div>
          )}
          {chat.messages.map((m) => (
            <div key={m.id} className={"flex gap-3 " + (m.role === "user" ? "justify-end" : "")}>
              {m.role === "assistant" && (
                <span className="w-8 h-8 rounded-xl grid place-items-center flex-shrink-0 text-white" style={{ background: "linear-gradient(135deg,#6D28D9,#4F46E5)" }}>
                  <MessageCircle className="w-4 h-4" />
                </span>
              )}
              <div
                className={
                  "rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap max-w-[80%] " +
                  (m.role === "user"
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--zebra)] border border-[var(--line)]")
                }
              >
                {m.content}
                {m.model && m.role === "assistant" && (
                  <div className="mt-1 text-[10px] font-mono uppercase tracking-wider opacity-60">{m.model}</div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Composer */}
        <form action={postMessageAction} className="border-t border-[var(--line)] p-3 flex items-end gap-2">
          <input type="hidden" name="chatId" value={chat.id} />
          <textarea
            id="composer-textarea"
            name="content"
            required
            rows={2}
            placeholder='Ask, paste a URL, or say "turn this into a script"…'
            className="flex-1 border border-[var(--line-2)] rounded-lg p-2.5 text-sm resize-none"
          />
          <div className="flex flex-col gap-1 self-stretch">
            <PromptLibrary targetId="composer-textarea" />
            <button type="submit" className="btn primary flex items-center gap-1.5 flex-1">
              <Send className="w-4 h-4" /> Send
            </button>
          </div>
        </form>
      </main>

      {/* Sidebar: context items + script link */}
      <aside className="flex flex-col gap-3">
        {chat.scriptId && (
          <Link href={`/scripts/${chat.scriptId}`} className="card flex items-center gap-3 hover:border-[var(--accent)] transition">
            <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: "#E0F2E8", color: "#15924B" }}>
              <PenLine className="w-5 h-5" />
            </span>
            <div className="flex-1">
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Linked script</div>
              <div className="text-sm font-semibold">Open in Canvas →</div>
            </div>
          </Link>
        )}

        <section className="card">
          <h2 className="font-mono text-[14px] font-bold mb-3 flex items-center gap-2">
            <Link2 className="w-4 h-4" style={{ color: "#2563EB" }} /> Context
          </h2>

          {chat.contextItems.length === 0 && (
            <p className="text-xs text-[var(--mute)] mb-3">Attach YouTube URLs, web pages, or pasted text — they condition every reply (FR-CHAT-02/03).</p>
          )}

          <ul className="m-0 p-0 mb-3">
            {chat.contextItems.map((c) => (
              <li key={c.id} className="border-t border-[var(--line)] first:border-t-0 py-2 text-xs flex items-center gap-2">
                <span className="font-mono uppercase text-[10px] tracking-wider px-1.5 py-0.5 rounded" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{c.kind.replace("_", " ")}</span>
                <span className="flex-1 truncate font-mono" title={c.ref}>{c.ref}</span>
              </li>
            ))}
          </ul>

          <form action={addChatContextAction} className="flex flex-col gap-2">
            <input type="hidden" name="chatId" value={chat.id} />
            <select name="kind" className="border border-[var(--line-2)] rounded-md p-1.5 text-xs">
              <option value="youtube_url">YouTube URL</option>
              <option value="web_url">Web URL</option>
              <option value="text">Pasted text</option>
            </select>
            <input name="ref" required placeholder="paste URL or text" className="border border-[var(--line-2)] rounded-md p-2 text-xs" />
            <button type="submit" className="btn sm self-end">Add</button>
          </form>

          <div className="border-t border-[var(--line)] mt-3 pt-3">
            <UploadButton chatId={chat.id} />
          </div>
        </section>

        <section className="card">
          <h2 className="font-mono text-[14px] font-bold mb-2">Tip</h2>
          <p className="text-xs text-[var(--mute)]">Type <span className="font-mono bg-[var(--zebra)] px-1 rounded">turn this into a script</span> to spin up a Canvas with the conversation as context (FR-CHAT-10).</p>
        </section>
      </aside>
    </div>
  );
}
