"use client";

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { bulkReviewSocialAction } from "@/app/actions/social-workflow";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * Approvals' bulk bar (E-SOC-02). Each pending post's card carries
 * `<input name="sel" form={formId}>` (PostCard `selectForm`), so ticking cards
 * fills this one form; "Select all" ticks every one of them. Approve runs each
 * post through its own Approve path; Request changes sends the same note to
 * every author.
 */
export function ApprovalBar({ formId, pending }: { formId: string; pending: number }) {
  const [count, setCount] = useState(0);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    const boxes = () => [...document.querySelectorAll<HTMLInputElement>(`input[name="sel"][form="${formId}"]`)];
    // "Select all" is left uncontrolled: React would restore a controlled box
    // before this document listener reads it.
    const recount = () => {
      const all = boxes();
      const n = all.filter((b) => b.checked).length;
      const toggle = document.querySelector<HTMLInputElement>(`input[data-select-all="${formId}"]`);
      if (toggle) toggle.checked = all.length > 0 && n === all.length;
      setCount(n);
    };
    const onChange = (e: Event) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement) || t.type !== "checkbox") return;
      if (t.dataset.selectAll === formId) for (const b of boxes()) b.checked = t.checked;
      else if (t.getAttribute("form") !== formId) return;
      recount();
    };
    recount();
    document.addEventListener("change", onChange);
    return () => document.removeEventListener("change", onChange);
  }, [formId]);

  return (
    <form id={formId} action={bulkReviewSocialAction} className="card mb-3 text-xs flex items-center gap-2 flex-wrap sticky top-0 z-10" aria-label="Review selected posts">
      <label className="inline-flex items-center gap-1.5 cursor-pointer">
        <input type="checkbox" data-select-all={formId} aria-label="Select every post awaiting approval" />
        Select all {pending}
      </label>
      {count === 0 ? (
        <span className="text-[var(--mute)]">Tick posts to approve them, or send them back, in one go.</span>
      ) : (
        <>
          <b>{count} selected</b>
          <SubmitButton name="op" value="approve" className="btn sm primary" pendingText="Approving…" formNoValidate><Check className="w-3.5 h-3.5" /> Approve</SubmitButton>
          {asking ? (
            <>
              <input name="note" maxLength={500} placeholder="What needs to change? Each author gets this note." aria-label="What needs to change" className="text-xs w-72" autoFocus />
              <SubmitButton name="op" value="changes" className="btn sm" pendingText="Sending back…"><X className="w-3.5 h-3.5" /> Send back</SubmitButton>
              <button type="button" className="btn sm" onClick={() => setAsking(false)}>Cancel</button>
            </>
          ) : (
            <button type="button" className="btn sm" onClick={() => setAsking(true)}><X className="w-3.5 h-3.5" /> Request changes</button>
          )}
        </>
      )}
    </form>
  );
}
