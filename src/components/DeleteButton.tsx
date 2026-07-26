"use client";

import { useState, useRef, useEffect } from "react";
import { Trash2, AlertTriangle } from "lucide-react";
import { deleteEntityAction } from "@/app/actions/delete-entity";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * The delete control used everywhere. Pair it with a kind declared in
 * src/lib/deletable.ts — that file decides the role, the tenancy query and
 * whether a typed confirmation is required.
 *
 * Two confirmation strengths, because treating a stray idea and a whole channel
 * the same way trains people to click through both:
 *   - default: a small inline "Delete? / Cancel" step, no modal;
 *   - `confirmName`: the name must be typed, and the button stays disabled
 *     until it matches. Used for channels, scripts, projects and workspaces.
 *
 * `impact` is rendered verbatim — the server counted it; this component never
 * guesses at what will be destroyed.
 */
export function DeleteButton({
  kind, id, name, confirmName, impact, returnTo, label, className, iconOnly,
}: {
  kind: string;
  id: string;
  name: string;
  /** True when the registry marks this kind typeToConfirm. */
  confirmName?: boolean;
  impact?: Array<[string, number]>;
  returnTo?: string;
  label?: string;
  className?: string;
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && confirmName) inputRef.current?.focus();
  }, [open, confirmName]);

  // Matching is case-insensitive and trimmed: the point is deliberate intent,
  // not a spelling test. It still forces you to read the name.
  const matches = !confirmName || typed.trim().toLowerCase() === name.trim().toLowerCase();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Delete ${name}`}
        className={className ?? "btn sm"}
        style={{ color: "var(--rose-on)" }}
      >
        <Trash2 className="w-3.5 h-3.5" />
        {!iconOnly && <span className="ml-1">{label ?? "Delete"}</span>}
      </button>
    );
  }

  return (
    <form action={deleteEntityAction} className="flex flex-col gap-2 rounded-lg p-2 w-full" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}

      <div className="flex items-start gap-2 text-[11px] leading-relaxed">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <div>
          <div>
            Delete <b>{name}</b>? This cannot be undone.
          </div>
          {impact && impact.length > 0 && (
            <div className="mt-1">
              Also deleted: {impact.map(([what, n]) => `${n} ${what}`).join(", ")}.
            </div>
          )}
          {impact && impact.length === 0 && confirmName && <div className="mt-1">Nothing else is attached to it.</div>}
        </div>
      </div>

      {confirmName && (
        <label className="text-[11px] flex flex-col gap-1">
          Type <b>{name}</b> to confirm
          <input
            ref={inputRef}
            name="confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="border border-[var(--line-2)] rounded-lg p-1.5 text-xs font-mono bg-[var(--bg)] text-[var(--fg)]"
          />
        </label>
      )}

      <div className="flex items-center gap-2">
        <SubmitButton className="btn sm !bg-[var(--rose)] !text-white" pendingText="Deleting…" disabled={!matches}>
          Delete permanently
        </SubmitButton>
        <button type="button" className="btn sm" onClick={() => { setOpen(false); setTyped(""); }}>
          Cancel
        </button>
      </div>
    </form>
  );
}
