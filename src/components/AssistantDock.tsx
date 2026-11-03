"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Loader2, SendHorizonal, X, Wrench, ExternalLink, Sparkles, Square } from "lucide-react";
import { MarkdownMessage } from "@/components/MarkdownMessage";
import { ConfirmCard } from "@/components/ConfirmCard";
import { UploadButton } from "@/components/UploadButton";
import { UndoButtons } from "@/components/AssistantUndo";
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

/** `tokens`: what the reply's model calls took, in + out (E-ENG-07); null when none were counted. */
type Msg = { id: string; role: "user" | "assistant"; content: string; steps: AssistantStep[]; tokens?: number | null };
type Reply = { threadId: string; messageId?: string; answer: string; steps: AssistantStep[]; options: string[]; links: Array<{ label: string; href: string }>; pending: unknown; error: string | null; usage?: { inputTokens: number; outputTokens: number } | null };

const SUGGESTIONS = [
  "What should I do next?",
  "What needs my attention?",
  "Walk me through this page",
  "Draft the next approved idea",
  "What's going out this week?",
];

/** Idle past this, the dock starts a new conversation rather than continuing (E-ENG-11). */
const IDLE_FRESH_MS = 6 * 3_600_000;

/** `readOnly`: a viewer's dock (E-ENG-15) — it says it can only look things up, and doesn't link to the editors' full page. */
export function AssistantDock({ activeChannelId = null, workspaceId, userId, readOnly = false }: { activeChannelId?: string | null; workspaceId: string; userId: string; readOnly?: boolean }) {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  // A conversation idle this long isn't continued in the dock (E-ENG-11) — the
  // next question starts a new one; the old one stays under Assistant.
  const [fresh, setFresh] = useState(false);
  const [recent, setRecent] = useState<Array<{ id: string; title: string | null }>>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [options, setOptions] = useState<string[]>([]);
  const [links, setLinks] = useState<Array<{ label: string; href: string }>>([]);
  const [busy, setBusy] = useState(false);
  // E-ENG-12: the step the running turn is on, and its thread (for Stop).
  const [live, setLive] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const runningThread = useRef<string | null>(null);
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Remember the thread across pages, so the dock is one conversation rather
  // than a fresh one every navigation — per workspace AND person (ENG-18).
  // One browser-wide key carried workspace A's thread into B, where every send
  // 404'd until "new" was pressed. The layout also remounts the dock on a switch.
  const storeKey = `mys.assistant.thread:${workspaceId}:${userId}`;
  useEffect(() => {
    try {
      localStorage.removeItem("mys.assistant.thread"); // the old unscoped key
      const t = localStorage.getItem(storeKey);
      if (t) setThreadId(t);
    } catch { /* ignore */ }
  }, [storeKey]);
  useEffect(() => {
    try { if (threadId) localStorage.setItem(storeKey, threadId); } catch { /* ignore */ }
  }, [threadId, storeKey]);

  // Load the thread when opened.
  useEffect(() => {
    if (!open || !threadId || messages.length) return;
    fetch(`/api/assistant?threadId=${encodeURIComponent(threadId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { messages?: Msg[]; pending?: unknown; updatedAt?: string } | null) => {
        if (!d?.messages) { setThreadId(null); return; }
        if (d.updatedAt && !d.pending && Date.now() - Date.parse(d.updatedAt) > IDLE_FRESH_MS) {
          setThreadId(null);
          setFresh(true);
          try { localStorage.removeItem(storeKey); } catch { /* ignore */ }
          return;
        }
        setMessages(d.messages);
        if (d.pending) setOptions(["Yes, do it", "No"]);
      })
      .catch(() => null);
  }, [open, threadId, messages.length, storeKey]);

  // The picker's list: this person's recent conversations here.
  useEffect(() => {
    if (!open) return;
    fetch("/api/assistant")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { threads?: Array<{ id: string; title: string | null }> } | null) => setRecent(d?.threads ?? []))
      .catch(() => null);
  }, [open, threadId]);

  // Open from anywhere: the header button dispatches this; Ctrl+/ too.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "/") { e.preventDefault(); setOpen((o) => !o); } };
    window.addEventListener("assistant:open", onOpen);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("assistant:open", onOpen); window.removeEventListener("keydown", onKey); };
  }, []);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages, busy]);

  const send = useCallback(async (message: string, confirm?: string) => {
    const m = message.trim();
    if (!m || busy) return;
    // A card's Yes carries its proposal's nonce (E-ENG-01); typed text never does.
    setBusy(true);
    setOptions([]);
    setLinks([]);
    setMessages((ms) => [...ms, { id: `u-${Date.now()}`, role: "user", content: m, steps: [] }]);
    setText("");
    setLive("Thinking");
    setStopping(false);
    runningThread.current = threadId;
    try {
      // Streamed (E-ENG-12): one JSON line per event — the thread, each step, then the reply.
      const post = (id: string | null) =>
        fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ threadId: id, message: m, page: pathname, stream: true, ...(confirm ? { confirm } : {}) }) });
      let r = await post(threadId);
      // The remembered conversation is gone (deleted, or another workspace's):
      // start a new one with this message instead of failing every send.
      if (r.status === 404 && threadId) {
        setMessages((ms) => ms.filter((x) => x.role === "user" && x.content === m));
        r = await post(null);
      }
      if (!r.ok || !r.body) {
        const e = (await r.json().catch(() => ({ error: `HTTP ${r.status}` }))) as { error?: string };
        throw new Error(e.error || `HTTP ${r.status}`);
      }
      let d: Reply | null = null;
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (value) buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as { type: string; threadId?: string; kind?: string; label?: string; error?: string } & Partial<Reply>;
          if (ev.type === "thread" && ev.threadId) { runningThread.current = ev.threadId; setThreadId(ev.threadId); }
          else if (ev.type === "progress" && ev.label) setLive(ev.label);
          else if (ev.type === "reply") d = ev as Reply;
          else if (ev.type === "error") throw new Error(ev.error || "the turn failed");
        }
        if (done) break;
      }
      if (!d) throw new Error("the reply never arrived");
      setThreadId(d.threadId);
      setMessages((ms) => [...ms, { id: d.messageId ?? `a-${Date.now()}`, role: "assistant", content: d.answer, steps: d.steps ?? [], tokens: d.usage ? d.usage.inputTokens + d.usage.outputTokens : null }]);
      setOptions(d.options ?? []);
      setLinks(d.links ?? []);
    } catch (e) {
      setMessages((ms) => [...ms, { id: `e-${Date.now()}`, role: "assistant", content: `Something went wrong: ${e instanceof Error ? e.message : String(e)}. Try again, or open the full page at /assistant.`, steps: [] }]);
    } finally {
      setBusy(false);
      setLive(null);
      runningThread.current = null;
    }
  }, [busy, threadId, pathname]);

  // Stop (E-ENG-12): the running turn finishes the step it's on and starts no other.
  const stop = useCallback(async () => {
    const id = runningThread.current;
    if (!id) return;
    setStopping(true);
    await fetch("/api/assistant/stop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ threadId: id }) }).catch(() => null);
  }, []);

  // The newest proposal on screen — its card's Yes carries this nonce (E-ENG-01).
  const lastNonce = [...messages].reverse().find((x) => x.role === "assistant")?.steps.find((x): x is Extract<AssistantStep, { kind: "confirm" }> => x.kind === "confirm")?.nonce;

  const newThread = () => { setThreadId(null); setFresh(false); setMessages([]); setOptions([]); setLinks([]); try { localStorage.removeItem(storeKey); } catch { /* ignore */ } };
  const pick = (id: string) => { if (!id || id === threadId) return; setFresh(false); setOptions([]); setLinks([]); setMessages([]); setThreadId(id); };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          // ⚠ md:hidden — on a desktop the header already carries an "Ask"
          // button that opens this same dock, and having both made "Ask"
          // appear twice on one screen (audit B1.5; the stage drawer was the
          // third). Below md the header collapses to MobileNav and this pill
          // is the ONLY way in, so it must not simply be deleted.
          className="md:hidden fixed bottom-5 right-5 z-40 rounded-full shadow-lg px-4 py-2.5 flex items-center gap-2 text-sm font-semibold text-white"
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
            {recent.length > 0 && (
              <select value={threadId ?? ""} onChange={(e) => pick(e.target.value)} className="text-[10px] max-w-28 bg-transparent border border-[var(--line)] rounded px-1 py-0.5" aria-label="Earlier conversations" data-dock-threads>
                <option value="">{threadId ? "Switch…" : "Earlier…"}</option>
                {recent.map((t) => <option key={t.id} value={t.id}>{(t.title ?? "Untitled").slice(0, 40)}</option>)}
              </select>
            )}
            <button type="button" onClick={newThread} className="text-[10px] text-[var(--mute)] hover:text-[var(--ink)]" title="Start a new conversation">new</button>
            {!readOnly && <Link href={threadId ? `/assistant/${threadId}` : "/assistant"} className="text-[10px] text-[var(--mute)] hover:text-[var(--ink)] inline-flex items-center gap-0.5" title="Open the full page"><ExternalLink className="w-3 h-3" /> full</Link>}
            <button type="button" onClick={() => setOpen(false)} className="ml-1 text-[var(--mute)] hover:text-[var(--ink)]" aria-label="Close"><X className="w-4 h-4" /></button>
          </header>

          <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-2">
            {messages.length === 0 && fresh && (
              <p className="text-[11px] text-[var(--mute)] m-0" data-dock-fresh>It&apos;s been a while, so this is a new conversation — {readOnly ? "pick the last one above" : <>the last one is under <Link href="/assistant#threads" className="underline">Assistant</Link> (or pick it above)</>}.</p>
            )}
            {messages.length === 0 && (
              <div className="text-xs text-[var(--mute)] leading-relaxed">
                {readOnly ? (
                  <p className="mb-2" data-dock-read-only>You&apos;re a viewer here, so I can look things up and explain them — what&apos;s waiting, what&apos;s scheduled, what the numbers say — but I can&apos;t change anything. An editor or admin can.</p>
                ) : (
                  <p className="mb-2">I can do nearly everything you can do here — find and approve ideas, draft, review, publish, queue and send, read the numbers, change the dials — and I&apos;ll ask before anything goes out or changes a setting. Ask me what to do next whenever you&apos;re unsure.</p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} className="btn sm inline-flex items-center gap-1"><Sparkles className="w-3 h-3" /> {s}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => {
              const tools = m.steps.filter((s): s is Extract<AssistantStep, { kind: "tool" }> => s.kind === "tool");
              const confirmStep = m.steps.find((s): s is Extract<AssistantStep, { kind: "confirm" }> => s.kind === "confirm");
              return (
                <div key={m.id} className={`rounded-xl px-3 py-2 text-sm ${m.role === "user" ? "self-end max-w-[85%]" : "self-start max-w-[95%]"}`} style={m.role === "user" ? { background: "var(--accent-soft)" } : { background: "var(--zebra)" }}>
                  {m.role === "user" ? <p className="m-0 whitespace-pre-wrap leading-relaxed">{m.content}</p> : <MarkdownMessage content={m.content} />}
                  {confirmStep && (
                    <ConfirmCard tool={confirmStep.tool} summary={confirmStep.summary} preview={confirmStep.preview}
                      expires={confirmStep.expiresAt ? new Date(confirmStep.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null} />
                  )}
                  {m.role === "assistant" && !m.id.startsWith("a-") && (
                    <UndoButtons messageId={m.id} steps={m.steps} onUndone={(index, said) => setMessages((ms) => [
                      ...ms.map((x) => (x.id === m.id ? { ...x, steps: x.steps.map((st, i) => (i === index && st.kind === "tool" && st.undo ? { ...st, undo: { ...st.undo, done: new Date().toISOString() } } : st)) } : x)),
                      { id: `u-${index}-${m.id}`, role: "assistant" as const, content: said, steps: [] },
                    ])} />
                  )}
                  {m.role === "assistant" && m.tokens != null && (
                    <p className="m-0 mt-1 text-[10px] font-mono text-[var(--mute)]" data-reply-tokens={m.tokens} title="Tokens this reply's model calls took, in and out — Settings → Usage has the month">{m.tokens.toLocaleString("en-GB")} tokens</p>
                  )}
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
            {busy && (
              <div className="self-start text-[11px] text-[var(--mute)] inline-flex items-center gap-1.5 flex-wrap" data-assistant-live>
                <Loader2 className="w-3 h-3 animate-spin" />
                <span data-live-step>{stopping ? "Stopping after this step…" : `${live ?? "Working"}…`}</span>
                {!stopping && (
                  <button type="button" onClick={stop} className="btn sm !py-0 !px-1.5 inline-flex items-center gap-1" data-stop title="Finish the step it's on and do nothing more">
                    <Square className="w-3 h-3" /> Stop
                  </button>
                )}
              </div>
            )}
            {(options.length > 0 || links.length > 0) && !busy && (
              <div className="flex flex-wrap gap-1.5 self-start">
                {options.map((o) => <button key={o} type="button" onClick={() => send(o, /^yes/i.test(o) ? lastNonce : undefined)} className={`btn sm ${/^yes/i.test(o) ? "primary" : ""}`}>{o}</button>)}
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
            <div className="flex flex-col gap-1 items-end">
              <button type="submit" className="btn primary sm" disabled={busy || !text.trim()} aria-label="Send">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <SendHorizonal className="w-3.5 h-3.5" />}
              </button>
              {activeChannelId && !busy && (
                <UploadButton
                  channelId={activeChannelId}
                  reload={false}
                  compact
                  onDone={(r) => setText((t) => (t.trim() ? t.replace(/\s+$/, "") + "\n" : "") + `[attached: ${r.title} (research source ${r.id}, ${r.words} words)]`)}
                />
              )}
            </div>
          </form>
        </aside>
      )}
    </>
  );
}

/**
 * The header's button — opens the dock from anywhere.
 *
 * ⚠ `!hidden md:!inline-flex` is the other half of the pill's `md:hidden`:
 * exactly one "Ask" is offered at any width (audit B1.5). The `!` marks are
 * load-bearing — `.btn` is unlayered in globals.css and beats a plain `hidden`.
 */
export function AssistantDockButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("assistant:open"))}
      className="btn sm !hidden md:!inline-flex items-center gap-1.5"
      title="Ask the assistant anything, or what to do next (Ctrl+/)"
    >
      <Bot className="w-3.5 h-3.5" style={{ color: "var(--violet-on)" }} /> Ask
    </button>
  );
}
