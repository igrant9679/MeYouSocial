"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Loader2, SendHorizonal, X, Wrench, ExternalLink, Sparkles } from "lucide-react";
import { MarkdownMessage } from "@/components/MarkdownMessage";
import type { AssistantStep } from "@/lib/assistant/run";

/**
 * The assistant, everywhere: a dock that opens on any page (the header
 * button, the floating button, or Ctrl+/ ), keeps one conversation going
 * across pages, knows which page you are on, asks with quick-reply choices,
 * shows what it did, and links to what it made. The full page at /assistant
 * is the same conversation with more room.
 *
 * The owner's brief (2026-09-08): "I should be able to use this so that I'm
 * never lost or don't know what to do next." Hence the opening suggestion.
 */

type Msg = { id: string; role: "user" | "assistant"; content: string; steps: AssistantStep[] };
type Reply = { threadId: string; answer: string; steps: AssistantStep[]; options: string[]; links: Array<{ label: string; href: string }>; pending: unknown; error: string | null };

const SUGGESTIONS = [
  "What should I do next?",
  "What needs my attention?",
  "Walk me through this page",
  "Draft the next approved idea",
  "What's going out this week?",
];

export function AssistantDock() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [options, setOptions] = useState<string[]>([]);
  const [links, setLinks] = useState<Array<{ label: string; href: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Remember the thread across pages (per browser), so the dock is one
  // conversation rather than a fresh one every navigation.
  useEffect(() => {
    try { const t = localStorage.getItem("mys.assistant.thread"); if (t) setThreadId(t); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { if (threadId) localStorage.setItem("mys.assistant.thread", threadId); } catch { /* ignore */ }
  }, [threadId]);

  // Load the thread when opened.
  useEffect(() => {
    if (!open || !threadId || messages.length) return;
    fetch(`/api/assistant?threadId=${encodeURIComponent(threadId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { messages?: Msg[]; pending?: unknown } | null) => {
        if (!d?.messages) { setThreadId(null); return; }
        setMessages(d.messages);
        if (d.pending) setOptions(["Yes, do it", "No"]);
      })
      .catch(() => null);
  }, [open, threadId, messages.length]);

  // Open from anywhere: the header button dispatches this; Ctrl+/ too.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "/") { e.preventDefault(); setOpen((o) => !o); } };
    window.addEventListener("assistant:open", onOpen);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("assistant:open", onOpen); window.removeEventListener("keydown", onKey); };
  }, []);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages, busy]);

  const send = useCallback(async (message: string) => {
    const m = message.trim();
    if (!m || busy) return;
    setBusy(true);
    setOptions([]);
    setLinks([]);
    setMessages((ms) => [...ms, { id: `u-${Date.now()}`, role: "user", content: m, steps: [] }]);
    setText("");
    try {
      const r = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ threadId, message: m, page: pathname }) });
      const d = (await r.json()) as Reply & { error?: string };
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setThreadId(d.threadId);
      setMessages((ms) => [...ms, { id: `a-${Date.now()}`, role: "assistant", content: d.answer, steps: d.steps ?? [] }]);
      setOptions(d.options ?? []);
      setLinks(d.links ?? []);
    } catch (e) {
      setMessages((ms) => [...ms, { id: `e-${Date.now()}`, role: "assistant", content: `Something went wrong: ${e instanceof Error ? e.message : String(e)}. Try again, or open the full page at /assistant.`, steps: [] }]);
    } finally {
      setBusy(false);
    }
  }, [busy, threadId, pathname]);

  const newThread = () => { setThreadId(null); setMessages([]); setOptions([]); setLinks([]); try { localStorage.removeItem("mys.assistant.thread"); } catch { /* ignore */ } };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 rounded-full shadow-lg px-4 py-2.5 flex items-center gap-2 text-sm font-semibold text-white"
          style={{ background: "#6D28D9" }}
          title="Ask the assistant (Ctrl+/)"
          aria-label="Open the assistant"
        >
          <Bot className="w-4 h-4" /> Ask
        </button>
      )}
      {open && (
        <aside
          className="fixed z-50 flex flex-col border border-[var(--line-2)] bg-[var(--panel)] shadow-2xl inset-x-0 bottom-0 h-[78vh] rounded-t-2xl sm:inset-auto sm:right-4 sm:bottom-4 sm:top-16 sm:h-auto sm:w-[420px] sm:rounded-2xl"
          role="dialog"
          aria-label="Assistant"
        >
          <header className="flex items-center gap-2 px-3 py-2 border-b border-[var(--line)]">
            <Bot className="w-4 h-4" style={{ color: "var(--violet-on)" }} />
            <span className="font-mono text-[12px] font-bold">Assistant</span>
            <span className="text-[10px] text-[var(--mute)] truncate">· on {pathname}</span>
            <span className="flex-1" />
            <button type="button" onClick={newThread} className="text-[10px] text-[var(--mute)] hover:text-[var(--ink)]" title="Start a new conversation">new</button>
            <Link href={threadId ? `/assistant/${threadId}` : "/assistant"} className="text-[10px] text-[var(--mute)] hover:text-[var(--ink)] inline-flex items-center gap-0.5" title="Open the full page"><ExternalLink className="w-3 h-3" /> full</Link>
            <button type="button" onClick={() => setOpen(false)} className="ml-1 text-[var(--mute)] hover:text-[var(--ink)]" aria-label="Close"><X className="w-4 h-4" /></button>
          </header>

          <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-2">
            {messages.length === 0 && (
              <div className="text-xs text-[var(--mute)] leading-relaxed">
                <p className="mb-2">I can do nearly everything you can do here — find and approve ideas, draft, review, publish, queue and send, read the numbers, change the dials — and I&apos;ll ask before anything goes out or changes a setting. Ask me what to do next whenever you&apos;re unsure.</p>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} className="btn sm inline-flex items-center gap-1"><Sparkles className="w-3 h-3" /> {s}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => {
              const tools = m.steps.filter((s): s is Extract<AssistantStep, { kind: "tool" }> => s.kind === "tool");
              return (
                <div key={m.id} className={`rounded-xl px-3 py-2 text-sm ${m.role === "user" ? "self-end max-w-[85%]" : "self-start max-w-[95%]"}`} style={m.role === "user" ? { background: "var(--accent-soft)" } : { background: "var(--zebra)" }}>
                  {m.role === "user" ? <p className="m-0 whitespace-pre-wrap leading-relaxed">{m.content}</p> : <MarkdownMessage content={m.content} />}
                  {tools.length > 0 && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[10px] font-mono text-[var(--mute)] inline-flex items-center gap-1"><Wrench className="w-3 h-3" /> {tools.length} step{tools.length === 1 ? "" : "s"}</summary>
                      <ul className="mt-1 flex flex-col gap-1">
                        {tools.map((s, i) => (
                          <li key={i} className="rounded bg-[var(--panel)] px-2 py-1">
                            <span className="font-mono text-[10px]" style={{ color: s.ok ? "var(--green-on)" : "var(--rose-on)" }}>{s.tool}</span>
                            <pre className="text-[10px] whitespace-pre-wrap text-[var(--mute)] mt-0.5 max-h-32 overflow-auto">{s.output}</pre>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              );
            })}
            {busy && <div className="self-start text-[11px] text-[var(--mute)] inline-flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Working — this may take a minute if it&apos;s writing something.</div>}
            {(options.length > 0 || links.length > 0) && !busy && (
              <div className="flex flex-wrap gap-1.5 self-start">
                {options.map((o) => <button key={o} type="button" onClick={() => send(o)} className={`btn sm ${/^yes/i.test(o) ? "primary" : ""}`}>{o}</button>)}
                {links.map((l) => <Link key={l.href} href={l.href} className="btn sm inline-flex items-center gap-1" onClick={() => setOpen(false)}><ExternalLink className="w-3 h-3" /> {l.label}</Link>)}
              </div>
            )}
          </div>

          <form
            className="border-t border-[var(--line)] p-2 flex items-end gap-2"
            onSubmit={(e) => { e.preventDefault(); void send(text); }}
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              placeholder={messages.length ? "Reply…" : "Ask anything, or tell me what to do…"}
              className="flex-1 text-sm leading-relaxed"
              disabled={busy}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(text); } }}
            />
            <button type="submit" className="btn primary sm" disabled={busy || !text.trim()} aria-label="Send">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <SendHorizonal className="w-3.5 h-3.5" />}
            </button>
          </form>
        </aside>
      )}
    </>
  );
}

/** The header's button — opens the dock from anywhere. */
export function AssistantDockButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("assistant:open"))}
      className="btn sm inline-flex items-center gap-1.5"
      title="Ask the assistant anything, or what to do next (Ctrl+/)"
    >
      <Bot className="w-3.5 h-3.5" style={{ color: "var(--violet-on)" }} /> Ask
    </button>
  );
}
