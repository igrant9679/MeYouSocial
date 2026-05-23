import Link from "next/link";
import { MessageCircle, Plus } from "lucide-react";
import { getActiveChannel } from "@/lib/channel";
import { db } from "@/lib/db";
import { createChatAction } from "@/app/actions/chat";

// MU-07 — Ideation chat. FR-CHAT-01 channel-scoped, FR-CHAT-12 grouped history (this/last week).

export default async function ChatListPage() {
  const { workspace, active } = await getActiveChannel();

  if (!active) {
    return (
      <div className="card max-w-md mx-auto text-center py-10">
        <span className="w-12 h-12 rounded-2xl grid place-items-center mx-auto mb-3" style={{ background: "#EDE7FB", color: "#6D28D9" }}>
          <MessageCircle className="w-6 h-6" />
        </span>
        <h1 className="font-mono font-bold text-lg mb-2">Pick a channel first</h1>
        <p className="text-sm text-[var(--mute)] mb-4">Chat is channel-scoped (FR-CHAT-01) — voice and audience condition every reply.</p>
        <Link href="/onboarding/channel/new" className="btn primary">Create a channel</Link>
      </div>
    );
  }

  const chats = await db.chat.findMany({
    where: { channelId: active.id },
    orderBy: { updatedAt: "desc" },
    take: 50,
    include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  const now = Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;
  const buckets = {
    thisWeek: chats.filter((c) => now - c.updatedAt.getTime() < week),
    lastWeek: chats.filter((c) => { const d = now - c.updatedAt.getTime(); return d >= week && d < 2 * week; }),
    older:    chats.filter((c) => now - c.updatedAt.getTime() >= 2 * week),
  };

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "#EDE7FB", color: "#6D28D9" }}>
          <MessageCircle className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-2xl leading-tight">Ideation chat</h1>
          <p className="text-xs text-[var(--mute)]">Channel: <b>{active.name}</b></p>
        </div>
        <span className="flex-1" />
        <form action={createChatAction}>
          <input type="hidden" name="channelId" value={active.id} />
          <button type="submit" className="btn primary flex items-center gap-2"><Plus className="w-4 h-4" /> New chat</button>
        </form>
      </div>

      {chats.length === 0 && (
        <div className="card text-center py-10">
          <p className="text-sm text-[var(--mute)] mb-3">No chats yet.</p>
          <form action={createChatAction}>
            <input type="hidden" name="channelId" value={active.id} />
            <button type="submit" className="btn primary">Start a chat</button>
          </form>
        </div>
      )}

      {(["thisWeek", "lastWeek", "older"] as const).map((key) =>
        buckets[key].length > 0 ? (
          <section key={key} className="mb-5">
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-[var(--mute)] mb-2">{labelOf(key)}</h2>
            <ul className="m-0 p-0 flex flex-col gap-2">
              {buckets[key].map((c) => (
                <li key={c.id}>
                  <Link href={`/chat/${c.id}`} className="card flex items-center gap-3 hover:border-[var(--accent)] hover:shadow-md transition">
                    <span className="w-9 h-9 rounded-xl grid place-items-center" style={{ background: "#EDE7FB", color: "#6D28D9" }}>
                      <MessageCircle className="w-4 h-4" strokeWidth={2.5} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate">{c.title ?? c.messages[0]?.content?.slice(0, 80) ?? "New chat"}</div>
                      <div className="text-xs text-[var(--mute)]">{new Date(c.updatedAt).toLocaleString()}</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}
    </div>
  );
}

function labelOf(key: "thisWeek" | "lastWeek" | "older"): string {
  if (key === "thisWeek") return "This week";
  if (key === "lastWeek") return "Last week";
  return "Older";
}
