"use client";

import { useState, useTransition } from "react";
import { Undo2 } from "lucide-react";
import type { AssistantStep } from "@/lib/assistant/run";
import { undoAssistantStepAction } from "@/app/actions/assistant-undo";

/**
 * The dock's Undo buttons under a reply (E-ENG-09): one per step the server
 * marked undoable, while its ten minutes last. The server re-checks
 * everything; a refusal is shown here, not swallowed.
 */
export function UndoButtons({ messageId, steps, onUndone }: { messageId: string; steps: AssistantStep[]; onUndone: (index: number, said: string) => void }) {
  // The moment the reply was shown — a later render shouldn't flip buttons on its own.
  const [shownAt] = useState(() => Date.now());
  const [busy, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const open = steps.flatMap((s, index) => (s.kind === "tool" && s.undo && !s.undo.done && Date.parse(s.undo.until) > shownAt ? [{ index, label: s.undo.label }] : []));
  if (open.length === 0 && !note) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {open.map(({ index, label }) => (
        <button
          key={index}
          type="button"
          disabled={busy}
          data-undo={index}
          className="btn sm inline-flex items-center gap-1"
          onClick={() => startTransition(async () => {
            const r = await undoAssistantStepAction(messageId, index);
            setNote(r.ok ? null : r.message);
            if (r.ok) onUndone(index, `↩ ${r.message}`);
          })}
        >
          <Undo2 className="w-3 h-3" /> {label}
        </button>
      ))}
      {note && <span className="text-[10px]" style={{ color: "var(--rose-on)" }}>{note}</span>}
    </div>
  );
}
