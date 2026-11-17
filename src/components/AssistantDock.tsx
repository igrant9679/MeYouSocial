"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, ChevronDown, Lightbulb, Loader2, PanelRight, PanelRightClose, SendHorizonal, X, Wrench, ExternalLink, Sparkles, Square } from "lucide-react";
import { MarkdownMessage } from "@/components/MarkdownMessage";
import { ConfirmCard } from "@/components/ConfirmCard";
import { UploadButton } from "@/components/UploadButton";
import { UndoButtons } from "@/components/AssistantUndo";
import type { AssistantStep } from "@/lib/assistant/run";
import type { ElsieSuggestion, ElsieSuggestions } from "@/lib/elsie/suggestions";
import { elsiePageLabel, elsiePrompts } from "@/lib/elsie/page";
import { elsieCount, noElsieCount, publishElsieCount, subscribeElsie } from "@/lib/elsie-live";
import { setGuideEnabledAction } from "@/app/actions/guide";

/**
 * Elsie, everywhere: a pane that opens on any page (the header button, the
 * floating button, or Ctrl+/ ), keeps one conversation going across pages,
 * knows which page you are on, asks with quick-reply choices, shows what she
 * did, and links to what she made. The full page at /assistant is the same
 * conversation with more room.
 *
 * The owner's brief (2026-09-08): "I should be able to use this so that I'm
 * never lost or don't know what to do next." Hence the opening suggestion.
 *
 * Since 2026-11-16 (the owner's "Elsie pane") she is one name for the assistant
 * and the guided tour, and the pane does two more things:
 *   - It can stay AT THE SIDE of the page (the header's panel button): on a wide
 *     shell it is a column beside <main>, open on every page, remembered in the
 *     cookie `mys_elsie` so the server renders it in place. Narrower than that
 *     it is the floating card it always was (`.elsie-side` in globals.css).
 *   - It lists her SUGGESTIONS for the page (/api/elsie, lib/elsie/suggestions.ts
 *     — from data, no model call), each with its page's own button, an "Ask
 *     Elsie" that starts an ordinary turn, and "don't suggest this again".
 * ⚠ She never opens herself and never acts from a suggestion: Ask Elsie is a
 * message like any typed one, so anything that changes something still waits
 * on its card's Yes.
 */

/** `tokens`: what the reply's model calls took, in + out (E-ENG-07); null when none were counted. */
type Msg = { id: string; role: "user" | "assistant"; content: string; steps: AssistantStep[]; tokens?: number | null };
type Reply = { threadId: string; messageId?: string; answer: string; steps: AssistantStep[]; options: string[]; links: Array<{ label: string; href: string }>; pending: unknown; error: string | null; usage?: { inputTokens: number; outputTokens: number } | null };

/** Idle past this, the dock starts a new conversation rather than continuing (E-ENG-11). */
const IDLE_FRESH_MS = 6 * 3_600_000;

/** While she's closed, the number on her button is re-read no more often than this. */
const SUGGESTIONS_STALE_MS = 120_000;

export type ElsieMode = "float" | "side";

/** Where she sits and whether she's open there — read by the layout so a side pane is in the first paint. */
function remember(mode: ElsieMode, open: boolean): void {
  try {
    document.cookie = mode === "side"
      ? `mys_elsie=${open ? "side-open" : "side-closed"}; path=/; max-age=31536000; samesite=lax`
      : "mys_elsie=; path=/; max-age=0; samesite=lax";
  } catch { /* a blocked cookie only costs the memory */ }
}

/** `readOnly`: a viewer's dock (E-ENG-15) — it says it can only look things up, and doesn't link to the editors' full page. */
export function AssistantDock({ activeChannelId = null, workspaceId, userId, readOnly = false, floatingButton = true, initialMode = "float", initialOpen = false, guideEnabled = false, guideSteps = 0 }: {
  activeChannelId?: string | null; workspaceId: string; userId: string; readOnly?: boolean; floatingButton?: boolean;
  /** From the `mys_elsie` cookie: at the side of the page, or the floating card. */
  initialMode?: ElsieMode;
  /** Only a side pane comes back open by itself. */
  initialOpen?: boolean;
  /** The guided tour is switched on, with this many steps still to see. */
  guideEnabled?: boolean;
  guideSteps?: number;
}) {
  const pathname = usePathname() ?? "/";
  const [mode, setMode] = useState<ElsieMode>(initialMode);
  const [open, setOpen] = useState(initialMode === "side" && initialOpen);
  // Open because the cookie said so, not because someone just asked. On a shell
  // too narrow for a side pane that would be a card over the page on every
  // load, so there `.elsie-side[data-auto]` keeps it out of sight (globals.css)
  // until a person opens her — which is what `visible` below is for.
  const [auto, setAuto] = useState(initialMode === "side" && initialOpen);
  const asideRef = useRef<HTMLElement>(null);
  const modeRef = useRef(mode);
  const openRef = useRef(open);
  useEffect(() => { modeRef.current = mode; openRef.current = open; }, [mode, open]);
  /** Part of the page's row (a wide shell, side mode) rather than a card over it. */
  const inFlow = () => Boolean(asideRef.current) && getComputedStyle(asideRef.current!).position === "static";
  /** Open AND on screen — an auto-opened side pane on a narrow shell is neither card nor column. */
  const visible = () => openRef.current && Boolean(asideRef.current) && getComputedStyle(asideRef.current!).display !== "none";
  /** A person opened or closed her: remembered, and no longer "auto". */
  const show = useCallback((next: boolean) => { setOpen(next); setAuto(false); remember(modeRef.current, next); }, []);
  const [sug, setSug] = useState<ElsieSuggestions | null>(null);
  const sugAt = useRef(0);
  // Her suggestions fold away once a conversation is under way; a click overrides either way.
  const [sugOpen, setSugOpen] = useState<boolean | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  // A conversation idle this long isn't continued in the dock (E-ENG-11) — the
  // next question starts a new one; the old one stays on her page.
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
    const onOpen = () => show(true);
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "/") { e.preventDefault(); show(!visible()); } };
    window.addEventListener("assistant:open", onOpen);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("assistant:open", onOpen); window.removeEventListener("keydown", onKey); };
  }, [show]);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages, busy]);

  // Her suggestions for this page (/api/elsie — counts, no model call).
  const loadSug = useCallback(async () => {
    try {
      const r = await fetch(`/api/elsie?page=${encodeURIComponent(pathname)}`, { cache: "no-store" });
      // Signed out, the answer is the sign-in page — not JSON, and not hers.
      if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return;
      const d = (await r.json()) as ElsieSuggestions;
      if (!Array.isArray(d.here) || !Array.isArray(d.next)) return;
      sugAt.current = Date.now();
      setSug(d);
      publishElsieCount(d.count);
    } catch { /* keep what's on screen */ }
  }, [pathname]);
  // Open: for every page she sits beside. Closed: only for the number on her
  // button — once the page has settled, then when it has gone stale.
  useEffect(() => {
    if (readOnly) return; // a viewer has none (lib/elsie/suggestions.ts)
    if (open) { void loadSug(); return; }
    if (Date.now() - sugAt.current < SUGGESTIONS_STALE_MS) return;
    const t = setTimeout(() => void loadSug(), 1500);
    return () => clearTimeout(t);
  }, [open, loadSug, readOnly]);
  // The next workspace's pane publishes its own number.
  useEffect(() => () => publishElsieCount(0), []);

  const changeSug = useCallback(async (body: { dismiss: string } | { restore: true }) => {
    if ("dismiss" in body) {
      setSug((cur) => cur && { ...cur, here: cur.here.filter((x) => x.key !== body.dismiss), next: cur.next.filter((x) => x.key !== body.dismiss) });
    }
    try {
      const r = await fetch("/api/elsie", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, page: pathname }) });
      if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) { void loadSug(); return; }
      const d = (await r.json()) as ElsieSuggestions;
      sugAt.current = Date.now();
      setSug(d);
      publishElsieCount(d.count);
    } catch { void loadSug(); }
  }, [pathname, loadSug]);

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
      // What she just did may have answered a suggestion.
      if (!readOnly) void loadSug();
    }
  }, [busy, threadId, pathname, loadSug, readOnly]);

  // Ctrl+K's "Ask the assistant: …" (E-SHL-06): open the dock and send it.
  useEffect(() => {
    const onAsk = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      if (typeof text !== "string" || !text.trim()) return;
      show(true);
      void send(text);
    };
    window.addEventListener("assistant:ask", onAsk);
    return () => window.removeEventListener("assistant:ask", onAsk);
  }, [send, show]);

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

  /** A link out of the pane: the floating card gets out of the way, the side pane stays. */
  const leaveIfFloating = () => { if (!inFlow()) show(false); };
  const toggleMode = () => {
    const next: ElsieMode = mode === "side" ? "float" : "side";
    setMode(next);
    setAuto(false);
    remember(next, true);
  };
  const tour = () => { window.dispatchEvent(new CustomEvent("elsie:open")); leaveIfFloating(); };
  const showSug = sugOpen ?? messages.length === 0;
  const prompts = elsiePrompts(pathname, readOnly);
  const suggestion = (s: ElsieSuggestion) => (
    <li key={s.key} data-elsie-suggestion={s.key} className="rounded-lg px-2 py-1.5 flex items-start gap-1.5" style={{ background: "var(--zebra)" }}>
      <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: s.urgent ? "var(--amber-on)" : "var(--mute)" }} title={s.urgent ? "Waiting on a person" : "Worth a look"} />
      <div className="min-w-0 flex-1">
        <p className="m-0 text-xs font-semibold leading-snug">{s.title}</p>
        <p className="m-0 text-2xs text-[var(--mute)] leading-snug">{s.why}</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <Link href={s.href} className="btn sm" onClick={leaveIfFloating}>{s.cta}</Link>
          <button type="button" className="btn sm inline-flex items-center gap-1" disabled={busy} onClick={() => { setSugOpen(false); void send(s.ask); }} title={`Ask Elsie: ${s.ask}`} data-elsie-ask>
            <Sparkles className="w-3 h-3" /> Ask Elsie
          </button>
        </div>
      </div>
      <button type="button" onClick={() => void changeSug({ dismiss: s.key })} className="text-[var(--mute)] hover:text-[var(--ink)] p-0.5" title="Don't suggest this again" aria-label={`Don't suggest this again: ${s.title}`} data-elsie-dismiss>
        <X className="w-3.5 h-3.5" />
      </button>
    </li>
  );

  return (
    <>
      {!open && floatingButton && (
        <button
          type="button"
          onClick={() => show(true)}
          // ⚠ md:hidden — on a desktop the header already carries an "Ask"
          // button that opens this same dock, and having both made "Ask"
          // appear twice on one screen (audit B1.5; the stage drawer was the
          // third). Below md the header collapses to MobileNav and this pill
          // is the ONLY way in, so it must not simply be deleted.
          className="md:hidden fixed bottom-5 right-5 z-40 rounded-full shadow-lg px-4 py-2.5 flex items-center gap-2 text-sm font-semibold text-white"
          style={{ background: "var(--violet)" }}
          title="Ask Elsie (Ctrl+/)"
          aria-label="Open Elsie"
        >
          <Bot className="w-4 h-4" /> Elsie
        </button>
      )}
      {open && (
        <aside
          ref={asideRef}
          // `.elsie-side` (globals.css) makes it a column of the page's row on a wide shell; below that, and in float mode, it is this card.
          className={"fixed z-50 flex flex-col border border-[var(--line-2)] bg-[var(--panel)] shadow-2xl inset-x-0 bottom-0 h-[78vh] rounded-t-2xl sm:inset-auto sm:right-4 sm:bottom-4 sm:top-16 sm:h-auto sm:w-[420px] sm:rounded-2xl" + (mode === "side" ? " elsie-side" : "")}
          role={mode === "side" ? "complementary" : "dialog"}
          aria-label="Elsie"
          data-elsie-pane={mode}
          data-auto={auto ? "1" : undefined}
        >
          <header className="flex items-center gap-2 px-3 py-2 border-b border-[var(--line)]">
            <Bot className="w-4 h-4 shrink-0" style={{ color: "var(--violet-on)" }} />
            <span className="font-mono text-xs font-bold">Elsie</span>
            <span className="text-micro text-[var(--mute)] truncate" title={pathname} data-elsie-page>· on {elsiePageLabel(pathname)}</span>
            <span className="flex-1" />
            {recent.length > 0 && (
              <select value={threadId ?? ""} onChange={(e) => pick(e.target.value)} className="text-micro max-w-28 bg-transparent border border-[var(--line)] rounded px-1 py-0.5" aria-label="Earlier conversations" data-dock-threads>
                <option value="">{threadId ? "Switch…" : "Earlier…"}</option>
                {recent.map((t) => <option key={t.id} value={t.id}>{(t.title ?? "Untitled").slice(0, 40)}</option>)}
              </select>
            )}
            <button type="button" onClick={newThread} className="text-micro text-[var(--mute)] hover:text-[var(--ink)]" title="Start a new conversation">new</button>
            {!readOnly && <Link href={threadId ? `/assistant/${threadId}` : "/assistant"} className="text-micro text-[var(--mute)] hover:text-[var(--ink)] inline-flex items-center gap-0.5" title="Open the full page"><ExternalLink className="w-3 h-3" /> full</Link>}
            <button type="button" onClick={toggleMode} className="elsie-side-toggle text-[var(--mute)] hover:text-[var(--ink)]" aria-pressed={mode === "side"} data-elsie-mode
              title={mode === "side" ? "Float Elsie over the page instead" : "Keep Elsie at the side of the page, open on every page"}
              aria-label={mode === "side" ? "Float Elsie over the page" : "Keep Elsie at the side of the page"}>
              {mode === "side" ? <PanelRightClose className="w-4 h-4" /> : <PanelRight className="w-4 h-4" />}
            </button>
            <button type="button" onClick={() => show(false)} className="ml-1 text-[var(--mute)] hover:text-[var(--ink)]" aria-label="Close"><X className="w-4 h-4" /></button>
          </header>

          <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-2">
            {!readOnly && sug && (sug.count > 0 || sug.hidden > 0) && (
              <section className="rounded-xl border border-[var(--line)] shrink-0" data-elsie-suggestions={sug.count}>
                <button type="button" onClick={() => setSugOpen(!showSug)} aria-expanded={showSug} className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left">
                  <Lightbulb className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--amber-on)" }} />
                  <span className="font-mono text-2xs font-bold">{sug.count === 0 ? "No suggestions right now" : `${sug.count} suggestion${sug.count === 1 ? "" : "s"} from what I can see`}</span>
                  <span className="flex-1" />
                  <ChevronDown className={"w-3.5 h-3.5 text-[var(--mute)] transition-transform motion-reduce:transition-none " + (showSug ? "rotate-180" : "")} />
                </button>
                {showSug && (
                  <div className="px-2 pb-2 flex flex-col gap-1.5">
                    {sug.here.length > 0 && (
                      <>
                        <span className="font-mono text-micro uppercase tracking-wider text-[var(--mute)] px-0.5">On this page</span>
                        <ul className="m-0 p-0 list-none flex flex-col gap-1.5" data-elsie-here>{sug.here.map(suggestion)}</ul>
                      </>
                    )}
                    {sug.next.length > 0 && (
                      <>
                        <span className="font-mono text-micro uppercase tracking-wider text-[var(--mute)] px-0.5">{sug.here.length > 0 ? "Elsewhere" : "Next"}</span>
                        <ul className="m-0 p-0 list-none flex flex-col gap-1.5" data-elsie-next>{sug.next.map(suggestion)}</ul>
                      </>
                    )}
                    {sug.more > 0 && (
                      <p className="m-0 text-2xs text-[var(--mute)] px-0.5">And {sug.more} more — everything waiting is in the <Link href="/inbox" className="underline" onClick={leaveIfFloating}>Inbox</Link>.</p>
                    )}
                    {sug.hidden > 0 && (
                      <p className="m-0 text-2xs text-[var(--mute)] px-0.5" data-elsie-hidden={sug.hidden}>
                        {sug.hidden} you asked me not to suggest. <button type="button" className="underline" onClick={() => void changeSug({ restore: true })}>Show {sug.hidden === 1 ? "it" : "them"} again</button>
                      </p>
                    )}
                  </div>
                )}
              </section>
            )}
            {messages.length === 0 && fresh && (
              <p className="text-2xs text-[var(--mute)] m-0" data-dock-fresh>It&apos;s been a while, so this is a new conversation — {readOnly ? "pick the last one above" : <>the last one is on <Link href="/assistant#threads" className="underline" onClick={leaveIfFloating}>my page</Link> (or pick it above)</>}.</p>
            )}
            {messages.length === 0 && (
              <div className="text-xs text-[var(--mute)] leading-relaxed">
                {readOnly ? (
                  <p className="mb-2" data-dock-read-only>I&apos;m Elsie. You&apos;re a viewer here, so I can look things up and explain them — what&apos;s waiting, what&apos;s scheduled, what the numbers say — but I can&apos;t change anything. An editor or admin can.</p>
                ) : (
                  <p className="mb-2">I&apos;m Elsie. I can do nearly everything you can do here — find and approve ideas, draft, review, publish, queue and send, read the numbers, change the dials — and I&apos;ll ask before anything goes out or changes a setting. Ask me what to do next whenever you&apos;re unsure.</p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {prompts.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} className="btn sm inline-flex items-center gap-1 text-left" data-elsie-prompt><Sparkles className="w-3 h-3 shrink-0" /> {s}</button>
                  ))}
                </div>
                {/* Her tour: switching it on starts it; once on, this picks it up where it was left. */}
                {!guideEnabled ? (
                  <form action={setGuideEnabledAction} className="mt-2">
                    <input type="hidden" name="on" value="1" />
                    <button className="underline text-2xs" data-elsie-tour="start">New here? Take my guided tour</button>
                  </form>
                ) : guideSteps > 0 ? (
                  <button type="button" className="mt-2 underline text-2xs" onClick={tour} data-elsie-tour="resume">Pick my guided tour back up</button>
                ) : null}
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
                    <p className="m-0 mt-1 text-micro font-mono text-[var(--mute)]" data-reply-tokens={m.tokens} title="Tokens this reply's model calls took, in and out — Settings → Usage has the month">{m.tokens.toLocaleString("en-GB")} tokens</p>
                  )}
                  {tools.length > 0 && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-micro font-mono text-[var(--mute)] inline-flex items-center gap-1"><Wrench className="w-3 h-3" /> {tools.length} step{tools.length === 1 ? "" : "s"}</summary>
                      <ul className="mt-1 flex flex-col gap-1">
                        {tools.map((s, i) => (
                          <li key={i} className="rounded bg-[var(--panel)] px-2 py-1">
                            <span className="font-mono text-micro" style={{ color: s.ok ? "var(--green-on)" : "var(--rose-on)" }}>{s.tool}</span>
                            <pre className="text-micro whitespace-pre-wrap text-[var(--mute)] mt-0.5 max-h-32 overflow-auto">{s.output}</pre>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              );
            })}
            {busy && (
              <div className="self-start text-2xs text-[var(--mute)] inline-flex items-center gap-1.5 flex-wrap" data-assistant-live>
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
                {links.map((l) => <Link key={l.href} href={l.href} className="btn sm inline-flex items-center gap-1" onClick={leaveIfFloating}><ExternalLink className="w-3 h-3" /> {l.label}</Link>)}
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
export function AssistantDockButton({ phone = false }: { phone?: boolean }) {
  // How many suggestions she has — her pane writes it (lib/elsie-live.ts).
  const n = useSyncExternalStore(subscribeElsie, elsieCount, noElsieCount);
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("assistant:open"))}
      data-elsie-count={n}
      style={{ position: "relative" }}
      // With the phone's bottom tabs the floating pill is gone (it sat on them),
      // so this is the phone's Ask too (E-SHL-10).
      className={`btn sm ${phone ? "!inline-flex" : "!hidden md:!inline-flex"} items-center gap-1.5`}
      title={n > 0 ? `Elsie has ${n} suggestion${n === 1 ? "" : "s"} — ask her anything, or what to do next (Ctrl+/)` : "Ask Elsie anything, or what to do next (Ctrl+/)"}
    >
      <Bot className="w-3.5 h-3.5" style={{ color: "var(--violet-on)" }} /> Elsie
      {n > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 rounded-full text-micro font-mono font-bold grid place-items-center text-white" style={{ background: "var(--violet)" }} aria-hidden>
          {n > 9 ? "9+" : n}
        </span>
      )}
    </button>
  );
}
