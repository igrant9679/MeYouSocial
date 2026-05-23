"use client";

import { useState, useEffect } from "react";
import { Sparkles, X } from "lucide-react";
import { PROMPT_LIBRARY, PROMPT_SHORTCUT } from "@/lib/prompt-library";

/**
 * FR-CHAT-08 — Prompt Library. A floating panel of categorized prompts that
 * inserts the selected one into the target textarea (#composer-textarea by
 * default). Toggled with Ctrl+/ from anywhere on the page.
 */
export function PromptLibrary({ targetId = "composer-textarea" }: { targetId?: string }) {
  const [open, setOpen] = useState(false);
  const [activeCat, setActiveCat] = useState(PROMPT_LIBRARY[0].id);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "/") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function insert(body: string) {
    const el = document.getElementById(targetId) as HTMLTextAreaElement | HTMLInputElement | null;
    if (!el) {
      navigator.clipboard.writeText(body).catch(() => {});
    } else {
      const before = el.value.slice(0, el.selectionStart ?? el.value.length);
      const after = el.value.slice(el.selectionEnd ?? el.value.length);
      el.value = (before ? before + (before.endsWith("\n") ? "" : "\n") : "") + body + (after ? "\n" + after : "");
      el.focus();
      // dispatch input event so React's controlled value picks up the change
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn sm flex items-center gap-1.5"
        title={`Prompt library (${PROMPT_SHORTCUT})`}
      >
        <Sparkles className="w-3.5 h-3.5" /> Prompts
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex overflow-hidden">
            {/* Categories */}
            <aside className="w-44 bg-[var(--zebra)] p-3 border-r border-[var(--line)] flex flex-col gap-1">
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] mb-2 px-2 flex items-center justify-between">
                Library
                <button onClick={() => setOpen(false)}><X className="w-3.5 h-3.5" /></button>
              </div>
              {PROMPT_LIBRARY.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCat(cat.id)}
                  className={"text-left px-2 py-1.5 rounded-md text-xs font-mono uppercase tracking-wider transition flex items-center gap-2 " + (activeCat === cat.id ? "" : "text-[var(--mute)] hover:bg-white")}
                  style={activeCat === cat.id ? { background: cat.soft, color: cat.color } : {}}
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: cat.color }} />
                  {cat.label}
                </button>
              ))}
              <div className="mt-auto text-[10px] font-mono text-[var(--mute)] px-2 pt-2 border-t border-[var(--line)]">
                Shortcut: <kbd className="px-1 py-0.5 rounded bg-white border border-[var(--line-2)]">{PROMPT_SHORTCUT}</kbd>
              </div>
            </aside>

            {/* Prompt list */}
            <div className="flex-1 overflow-auto p-3 flex flex-col gap-2">
              {PROMPT_LIBRARY.find((c) => c.id === activeCat)!.prompts.map((p) => (
                <button
                  key={p.id}
                  onClick={() => insert(p.body)}
                  className="text-left card hover:border-[var(--accent)] hover:shadow-md transition"
                >
                  <div className="font-semibold text-sm mb-1">{p.label}</div>
                  <div className="text-xs text-[var(--mute)] line-clamp-3">{p.body}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
