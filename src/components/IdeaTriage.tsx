"use client";

import { useEffect, useState } from "react";
import { Check, Keyboard, Tags, Trash2, X } from "lucide-react";
import { bulkIdeasAction } from "@/app/actions/ideas-bulk";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * The board's bulk toolbar and keys (E-IDE-01). The cards stay server-rendered:
 * each selectable card carries `<input name="sel" form={formId}>`, so ticking
 * boxes anywhere on the page fills this one form, and a lane's "select all"
 * box (`data-lane-toggle`) ticks the boxes that carry its `data-lane`.
 *
 * Keys, never while typing: j / k move between visible cards (`data-idea-card`),
 * x ticks the focused one, a / r press its own Approve / Reject button
 * (`data-key`), ? shows the list.
 */
export function IdeaTriage({ formId, back, topics }: { formId: string; back: string; topics: { id: string; name: string }[] }) {
  const [count, setCount] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    const boxes = () => [...document.querySelectorAll<HTMLInputElement>(`input[name="sel"][form="${formId}"]`)];
    const recount = () => setCount(boxes().filter((b) => b.checked).length);
    const onChange = (e: Event) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement) || t.type !== "checkbox") return;
      const lane = t.dataset.laneToggle;
      if (lane !== undefined) {
        for (const b of boxes()) if (b.dataset.lane === lane) b.checked = t.checked;
      }
      if (lane !== undefined || t.getAttribute("form") === formId) recount();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      const typing = t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement
        || (t instanceof HTMLElement && t.isContentEditable)
        || (t instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit"].includes(t.type));
      if (typing) return;
      const k = e.key;
      if (k === "?") { setHelp((h) => !h); return; }
      if (k === "Escape") { setHelp(false); return; }
      if (!["j", "k", "x", "a", "r"].includes(k)) return;
      // Cards inside a closed lane or the Rejected fold aren't on screen — skip
      // them. ⚠ The closed-details test is the one that works: Chrome still
      // reports a client rect for content in a closed <details>.
      const cards = [...document.querySelectorAll<HTMLElement>("[data-idea-card]")]
        .filter((c) => !c.closest("details:not([open])") && c.getClientRects().length > 0);
      const cur = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>("[data-idea-card]") : null;
      const i = cur ? cards.indexOf(cur) : -1;
      if (k === "j" || k === "k") {
        const next = cards[k === "j" ? Math.min(cards.length - 1, i + 1) : Math.max(0, i - 1)];
        if (!next) return;
        e.preventDefault();
        next.focus();
        next.scrollIntoView({ block: "nearest" });
        return;
      }
      if (!cur) return;
      if (k === "x") {
        const box = cur.querySelector<HTMLInputElement>('input[name="sel"]');
        if (box) { e.preventDefault(); box.click(); }
        return;
      }
      const btn = cur.querySelector<HTMLButtonElement>(`[data-key="${k}"]`);
      if (btn) { e.preventDefault(); btn.click(); }
    };
    // Boxes keep their state across a soft navigation's re-render; read it once.
    recount();
    document.addEventListener("change", onChange);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("change", onChange);
      document.removeEventListener("keydown", onKey);
    };
  }, [formId]);

  const n = count === 1 ? "1 idea" : `${count} ideas`;
  return (
    <form id={formId} action={bulkIdeasAction} className="card mb-3 text-xs flex items-center gap-2 flex-wrap sticky top-0 z-10" aria-label="Act on selected ideas">
      <input type="hidden" name="back" value={back} />
      {count === 0 ? (
        <span className="text-[var(--mute)]">
          Tick ideas to act on several at once — or press <Kbd>j</Kbd> <Kbd>k</Kbd> to move, <Kbd>x</Kbd> to tick, <Kbd>a</Kbd> to approve, <Kbd>r</Kbd> to reject.
        </span>
      ) : confirmDelete ? (
        <>
          <b>Delete {n}?</b>
          <span className="text-[var(--mute)]">Ideas already made into an article, script or post are kept. This can&apos;t be undone.</span>
          <input type="hidden" name="confirm" value="yes" />
          <SubmitButton name="op" value="delete" className="btn sm !bg-[var(--rose)] !text-white" pendingText="Deleting…">Yes, delete</SubmitButton>
          <button type="button" className="btn sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
        </>
      ) : (
        <>
          <b>{n} selected</b>
          <SubmitButton name="op" value="approve" className="btn sm primary" pendingText="Approving…"><Check className="w-3.5 h-3.5" /> Approve</SubmitButton>
          <SubmitButton name="op" value="reject" className="btn sm" pendingText="Rejecting…"><X className="w-3.5 h-3.5" /> Reject</SubmitButton>
          {topics.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <select name="topicId" defaultValue="" aria-label="Topic to tag them with" className="text-xs max-w-44">
                <option value="" disabled>Topic…</option>
                {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                <option value="none">no Topic</option>
              </select>
              <SubmitButton name="op" value="topic" className="btn sm" pendingText="Tagging…"><Tags className="w-3.5 h-3.5" /> Tag</SubmitButton>
            </span>
          )}
          <button type="button" className="btn sm" onClick={() => setConfirmDelete(true)} title="Delete the selected ideas"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
        </>
      )}
      <span className="flex-1" />
      <button type="button" className="btn sm" onClick={() => setHelp((h) => !h)} aria-expanded={help} title="Keyboard shortcuts (?)"><Keyboard className="w-3.5 h-3.5" /></button>
      {help && (
        <ul className="w-full grid grid-cols-2 sm:grid-cols-5 gap-1 text-[11px] text-[var(--mute)] border-t border-[var(--line)] pt-2">
          <li><Kbd>j</Kbd> / <Kbd>k</Kbd> next / previous card</li>
          <li><Kbd>x</Kbd> tick or untick it</li>
          <li><Kbd>a</Kbd> approve it</li>
          <li><Kbd>r</Kbd> reject it</li>
          <li><Kbd>?</Kbd> show these</li>
        </ul>
      )}
    </form>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="font-mono text-[10px] px-1 py-px rounded border border-[var(--line-2)] bg-[var(--panel)]">{children}</kbd>;
}
