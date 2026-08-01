"use client";

import { useState, useRef } from "react";
import { Sparkles, Check, X, Loader2 } from "lucide-react";
import { draftFieldAction } from "@/app/actions/assist";

/**
 * AI assistance for one description field.
 *
 * ⚠ PROPOSES, never overwrites. The draft appears above the field with Use it /
 * Discard; nothing touches the textarea until the user accepts. Typing into a
 * box and having a button silently replace your words is the kind of thing
 * people stop trusting after exactly one occurrence.
 *
 * ⚠ `type="button"` is load-bearing — every one of these sits inside a form,
 * and a bare <button> submits it. Same trap HelpTip documents.
 *
 * ⚠ Never render this inside a <label> or an <a>: both retarget the click.
 *
 * Works with the app's UNCONTROLLED fields (defaultValue + server actions), so
 * accepting writes `.value` directly and dispatches an input event for anything
 * listening (character counters, dirty-state tracking).
 */
export function AiAssist({
  field,
  target,
  siblings,
  extra,
  channelId,
  label = "Draft with AI",
  className = "",
}: {
  /** Key from ASSIST_FIELDS. */
  field: string;
  /** `name` of the textarea/input this assists, within the same form. */
  target: string;
  /** Other fields in the same form to send as context, as `{ name: "Label" }`.
   *  Onboarding needs it — the channel name is typed in a sibling input and
   *  isn't saved yet, so without this the draft has no idea what it's naming. */
  siblings?: Record<string, string>;
  /** Facts the SERVER already knows, as `{ Label: value }` — a topic's name, a
   *  page title. Use this rather than a sibling when the value isn't in the
   *  form: passing a hidden `id` teaches the model nothing, and a cuid in the
   *  prompt is pure noise. */
  extra?: Record<string, string>;
  channelId?: string;
  label?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [isMock, setIsMock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);

  function fieldEl(): HTMLTextAreaElement | HTMLInputElement | null {
    const form = anchorRef.current?.closest("form");
    if (!form) return null;
    return form.elements.namedItem(target) as HTMLTextAreaElement | HTMLInputElement | null;
  }

  async function run() {
    setBusy(true);
    setError(null);
    setDraft(null);
    try {
      const form = anchorRef.current?.closest("form");
      const collected: Record<string, string> = { ...(extra ?? {}) };
      for (const [name, labelText] of Object.entries(siblings ?? {})) {
        const el = form?.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null;
        if (el?.value?.trim()) collected[labelText] = el.value;
      }

      const res = await draftFieldAction({
        field,
        current: fieldEl()?.value ?? "",
        channelId,
        siblings: collected,
      });
      if (res.ok) {
        setDraft(res.text);
        setIsMock(res.mock);
      } else {
        setError(res.error);
      }
    } catch {
      setError("Couldn't reach the model. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function accept() {
    const el = fieldEl();
    if (el && draft) {
      // ⚠ Assign through the PROTOTYPE's value setter, not `el.value = …`.
      // React keeps a `_valueTracker` on the node and swallows an input event
      // whose value it believes hasn't changed — so a plain assignment updates
      // the DOM but leaves a controlled component's state on the old text, and
      // the next keystroke reverts the whole field. Uncontrolled fields don't
      // care either way, so this path is correct for both.
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, draft);
      else el.value = draft;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.focus();
    }
    setDraft(null);
  }

  return (
    <div className={"mt-1 " + className}>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          ref={anchorRef}
          type="button"
          onClick={run}
          disabled={busy}
          className="btn sm"
          title="Draft this field with AI, then review it before it goes in"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {busy ? "Drafting…" : label}
        </button>
        {error && (
          <span className="text-[11px]" style={{ color: "var(--rose-on)" }}>{error}</span>
        )}
      </div>

      {draft && (
        <div className="mt-2 rounded-xl border p-3" style={{ borderColor: "var(--line-2)", background: "var(--zebra)" }}>
          {isMock && (
            // The single most important element here. Without a key the router
            // silently answers from the mock, and mock prose is fluent — it
            // would be pasted into a real brand config as though generated.
            <div
              className="text-[11px] mb-2 px-2 py-1.5 rounded-lg leading-snug"
              style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}
            >
              ⚠ Placeholder text — no working AI key resolved for this workspace, so this is a stand-in, not a real
              suggestion. Add a key under Admin → API keys.
            </div>
          )}
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{draft}</p>
          <div className="flex items-center gap-2 mt-2">
            <button type="button" onClick={accept} className="btn primary sm">
              <Check className="w-3.5 h-3.5" /> Use it
            </button>
            <button type="button" onClick={() => setDraft(null)} className="btn sm">
              <X className="w-3.5 h-3.5" /> Discard
            </button>
            <button type="button" onClick={run} disabled={busy} className="btn sm">
              <Sparkles className="w-3.5 h-3.5" /> Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
