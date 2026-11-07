"use client";

import { useState, useEffect, useRef, useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Wand2, Sparkles, Save } from "lucide-react";
import { saveBodyAction, improveSelectionAction, humanizeAction } from "@/app/actions/canvas";
import { countWords, durationSeconds, formatDuration, MAX_WORDS } from "@/lib/canvas/duration";
import { ScriptOutline } from "./ScriptOutline";

// + + + — editing surface.
// Autosaves on debounce, shows live wordcount + duration, exposes Highlight-and-Improve.
//
// ⚠ VID-06: the AI actions read the body from the DATABASE, so what's on screen
// is saved first (flush) — Improve's offsets point into the saved text, and
// Humanize would otherwise rewrite a version without the last keystrokes. The
// page keys this component on the row's updatedAt, so a server rewrite
// remounts it on the new text; unsaved typing is flushed on hide and unmount.
//
// ⚠ E-VID-01: every save carries the hash of the stored text this editor last
// saw. An agent run (or Humanize in another tab) that rewrote the script while
// this one stayed open used to be overwritten by the next keystroke; now the
// save is refused, the typing is kept as a version, and the person chooses —
// load the new text, or keep theirs. While an agent run is writing, saves wait.

type SaveState = "idle" | "saving" | "saved" | "error" | "conflict" | "busy";

export function ScriptEditor({ scriptId, initialBody, serverHash }: { scriptId: string; initialBody: string; serverHash: string }) {
  const router = useRouter();
  const [body, setBody] = useState(initialBody);
  const [saved, setSaved] = useState<SaveState>("idle");
  const baseHash = useRef(serverHash);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [improveOpen, setImproveOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [pending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(initialBody);
  const latest = useRef(initialBody);
  useEffect(() => { latest.current = body; }, [body]);

  /** Save what's on screen now, if it isn't saved. False when the save failed or was refused. */
  const blocked = useRef(false);
  const flush = useCallback(async (force = false): Promise<boolean> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const text = latest.current;
    if (text === lastSaved.current) return true;
    if (blocked.current && !force) return false; // a conflict waits for the person's choice
    setSaved("saving");
    try {
      const fd = new FormData();
      fd.set("scriptId", scriptId);
      fd.set("body", text);
      fd.set("baseHash", baseHash.current);
      if (force) fd.set("force", "1");
      const r = await saveBodyAction(fd);
      if (r.ok) {
        baseHash.current = r.hash;
        blocked.current = false;
        lastSaved.current = text;
        setSaved("saved");
        setTimeout(() => setSaved((s) => (s === "saved" ? "idle" : s)), 1200);
        return true;
      }
      if ("busy" in r) { setSaved("busy"); return false; }
      // Keep the stale hash: "Keep mine" sends it with force, so the server
      // keeps the newer text as a version before writing this one.
      blocked.current = true;
      setSaved("conflict");
      return false;
    } catch {
      setSaved("error");
      return false;
    }
  }, [scriptId]);

  // Debounced autosave
  useEffect(() => {
    if (body === lastSaved.current || blocked.current) return;
    if (timer.current) clearTimeout(timer.current);
    setSaved("saving");
    timer.current = setTimeout(() => { void flush(); }, 800);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [body, flush]);

  // An agent run holds the script: try again every 10 s until it's done.
  useEffect(() => {
    if (saved !== "busy") return;
    const t = setInterval(() => { void flush(); }, 10_000);
    return () => clearInterval(t);
  }, [saved, flush]);

  // Leaving the tab or the page mustn't drop the last keystrokes.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") void flush(); };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void flush();
    };
  }, [flush]);

  const captureSelection = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start < end) setSelection({ start, end });
    else setSelection(null);
  }, []);

  // The outline's jumps (E-VID-10): select the place and bring it into view.
  // Line-based, so a long wrapped paragraph lands near rather than exactly.
  const jumpTo = useCallback((offset: number, length: number) => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(offset, offset + length);
    const line = el.value.slice(0, offset).split("\n").length - 1;
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 24;
    el.scrollTop = Math.max(0, line * lineHeight - el.clientHeight / 3);
    captureSelection();
  }, [captureSelection]);

  const words = countWords(body);
  const dur = formatDuration(durationSeconds(words));
  const wordPct = Math.min(100, Math.round((words / MAX_WORDS) * 100));

  return (
    <div className="flex flex-col gap-3 h-full">
      {saved === "conflict" && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-xs rounded-lg px-3 py-2" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }} data-script-conflict>
          <span className="flex-1 min-w-0">This script changed elsewhere — an agent run, Humanize, or another tab. Your text wasn&apos;t written over it; it&apos;s kept under Versions.</span>
          <button type="button" className="btn sm" onClick={() => { blocked.current = false; lastSaved.current = latest.current; router.refresh(); }}>Load the new text</button>
          <button type="button" className="btn sm" onClick={() => { void flush(true); }}>Keep mine</button>
        </div>
      )}
      {saved === "busy" && (
        <div role="status" className="text-xs rounded-lg px-3 py-2" style={{ background: "var(--blue-soft)", color: "var(--blue-on)" }} data-script-busy>
          An agent run is writing this script. Your typing stays here and saves when the run finishes — the page reloads with its result, so copy anything you need first.
        </div>
      )}
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <SaveBadge state={saved} />
        <span className="text-xs font-mono text-[var(--mute)]">
          {/* suppressHydrationWarning on both counts: viewer-locale grouping,
              intended, and a React #418 without it (audit A2). */}
          <b className={words >= MAX_WORDS ? "text-[var(--brand)]" : ""} suppressHydrationWarning>{words.toLocaleString()}</b> /{" "}
          <span suppressHydrationWarning>{MAX_WORDS.toLocaleString()}</span> words · {dur}
        </span>
        <div className="flex-1 min-w-[40px] h-1.5 rounded-full bg-[var(--line)] overflow-hidden">
          <div className="h-full rounded-full" style={{ width: wordPct + "%", background: wordPct > 90 ? "var(--brand)" : "var(--accent)" }} />
        </div>
        <button
          type="button"
          disabled={pending || !selection}
          onClick={() => setImproveOpen(true)}
          className="btn sm flex items-center gap-1.5"
          title="Select text first, then click to rewrite that passage"
        >
          <Sparkles className="w-3.5 h-3.5" /> Improve
        </button>
        <button
          type="button"
          className="btn primary sm flex items-center gap-1.5"
          disabled={words < 50 || pending}
          // A disabled button said nothing about why (tracker #10).
          title={words < 50 ? `Humanize rewrites a whole script — write at least 50 words first (${words} so far)` : "Rewrite the script so it reads as spoken, not written — what it is now is kept as a version"}
          onClick={() => startTransition(async () => {
            if (!(await flush())) return;
            const fd = new FormData();
            fd.set("scriptId", scriptId);
            await humanizeAction(fd);
          })}
        >
          <Wand2 className="w-3.5 h-3.5" /> {pending ? "Working…" : "Humanize"}
        </button>
      </div>

      {/* Editor, with the outline beside it on wide screens and under it otherwise */}
      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[1fr_250px] gap-3">
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onSelect={captureSelection}
          onMouseUp={captureSelection}
          onKeyUp={captureSelection}
          placeholder="Your script appears here once you generate from the outline. You can also paste a draft directly and use Humanize to clean it up."
          className="min-h-[420px] h-full w-full border border-[var(--line-2)] rounded-xl p-4 text-sm leading-[1.7] font-mono resize-none focus:outline-none focus:border-[var(--accent)]"
          spellCheck
        />
        <ScriptOutline body={body} onJump={jumpTo} onReplace={setBody} />
      </div>

      {/* Improve modal */}
      {improveOpen && selection && (
        <div className="fixed inset-0 bg-black/40 z-50 grid place-items-center p-4" onClick={() => !pending && setImproveOpen(false)}>
          <div className="card max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-mono font-bold mb-1 flex items-center gap-2"><Sparkles className="w-4 h-4" style={{ color: "var(--accent)" }} /> Improve this passage</h3>
            <p className="text-xs text-[var(--mute)] mb-2">{selection.end - selection.start} chars selected</p>
            <div className="bg-[var(--zebra)] rounded-md p-2.5 mb-3 text-xs font-mono max-h-32 overflow-auto whitespace-pre-wrap">
              {body.slice(selection.start, selection.end)}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                startTransition(async () => {
                  // The offsets are into the saved body — save first.
                  if (!(await flush())) return;
                  const fd = new FormData();
                  fd.set("scriptId", scriptId);
                  fd.set("start", String(selection.start));
                  fd.set("end", String(selection.end));
                  fd.set("instruction", instruction);
                  await improveSelectionAction(fd);
                  setImproveOpen(false);
                  setInstruction("");
                });
              }}
              className="flex flex-col gap-2"
            >
              <div className="flex flex-wrap gap-1.5">
                {QUICK_INSTRUCTIONS.map((q) => (
                  <button key={q} type="button" onClick={() => setInstruction(q)} className="text-2xs font-mono px-2 py-1 rounded-md border border-[var(--line-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]">{q}</button>
                ))}
              </div>
              <input
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="Custom instruction (optional)"
                className="border border-[var(--line-2)] rounded-md p-2 text-sm"
              />
              <div className="flex justify-end gap-2 mt-1">
                <button type="button" className="btn sm" onClick={() => setImproveOpen(false)} disabled={pending}>Cancel</button>
                <button type="submit" className="btn primary sm" disabled={pending}>{pending ? "Rewriting…" : "Rewrite"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  if (state === "idle" || state === "conflict" || state === "busy") return null;
  if (state === "error") {
    return (
      <span role="alert" className="flex items-center gap-1 text-micro font-mono uppercase tracking-wider px-2 py-1 rounded-md" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>
        <Save className="w-3 h-3" /> not saved — keep this tab open and type to retry
      </span>
    );
  }
  const color = state === "saving" ? "var(--amber)" : "var(--green)";
  const soft = state === "saving" ? "var(--amber-soft)" : "var(--green-soft)";
  return (
    <span className="flex items-center gap-1 text-micro font-mono uppercase tracking-wider px-2 py-1 rounded-md" style={{ background: soft, color }}>
      <Save className="w-3 h-3" /> {state}
    </span>
  );
}

const QUICK_INSTRUCTIONS = [
  "Tighter",
  "More vivid",
  "Punchier hook",
  "Cut hedging",
  "Simpler language",
  "More specific",
];
