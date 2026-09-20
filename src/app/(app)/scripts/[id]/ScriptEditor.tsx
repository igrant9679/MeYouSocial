"use client";

import { useState, useEffect, useRef, useCallback, useTransition } from "react";
import { Wand2, Sparkles, Save } from "lucide-react";
import { saveBodyAction, improveSelectionAction, humanizeAction } from "@/app/actions/canvas";
import { countWords, durationSeconds, formatDuration, MAX_WORDS } from "@/lib/canvas/duration";

// + + + — editing surface.
// Autosaves on debounce, shows live wordcount + duration, exposes Highlight-and-Improve.

export function ScriptEditor({ scriptId, initialBody }: { scriptId: string; initialBody: string }) {
  const [body, setBody] = useState(initialBody);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [improveOpen, setImproveOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [pending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(initialBody);

  // Debounced autosave
  useEffect(() => {
    if (body === lastSaved.current) return;
    if (timer.current) clearTimeout(timer.current);
    setSaved("saving");
    timer.current = setTimeout(async () => {
      const fd = new FormData();
      fd.set("scriptId", scriptId);
      fd.set("body", body);
      await saveBodyAction(fd);
      lastSaved.current = body;
      setSaved("saved");
      setTimeout(() => setSaved("idle"), 1200);
    }, 800);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [body, scriptId]);

  const captureSelection = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start < end) setSelection({ start, end });
    else setSelection(null);
  }, []);

  const words = countWords(body);
  const dur = formatDuration(durationSeconds(words));
  const wordPct = Math.min(100, Math.round((words / MAX_WORDS) * 100));

  return (
    <div className="flex flex-col gap-3 h-full">
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
        <form action={humanizeAction}>
          <input type="hidden" name="scriptId" value={scriptId} />
          <button type="submit" className="btn primary sm flex items-center gap-1.5" disabled={words < 50}>
            <Wand2 className="w-3.5 h-3.5" /> Humanize
          </button>
        </form>
      </div>

      {/* Editor */}
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onSelect={captureSelection}
        onMouseUp={captureSelection}
        onKeyUp={captureSelection}
        placeholder="Your script appears here once you generate from the outline. You can also paste a draft directly and use Humanize to clean it up."
        className="flex-1 min-h-[420px] w-full border border-[var(--line-2)] rounded-xl p-4 text-[15px] leading-[1.7] font-mono resize-none focus:outline-none focus:border-[var(--accent)]"
        spellCheck
      />

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
                  <button key={q} type="button" onClick={() => setInstruction(q)} className="text-[11px] font-mono px-2 py-1 rounded-md border border-[var(--line-2)] hover:border-[var(--accent)] hover:text-[var(--accent)]">{q}</button>
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

function SaveBadge({ state }: { state: "idle" | "saving" | "saved" }) {
  if (state === "idle") return null;
  const color = state === "saving" ? "var(--amber)" : "var(--green)";
  const soft = state === "saving" ? "var(--amber-soft)" : "var(--green-soft)";
  return (
    <span className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-md" style={{ background: soft, color }}>
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
