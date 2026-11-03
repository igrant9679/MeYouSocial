"use client";

import { useEffect, useRef, useState } from "react";
import { Tags } from "lucide-react";
import { setBoardIdeaTopicAction } from "@/app/actions/ideas";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * One Topic picker for the whole board (E-IDE-17). Every card used to carry its
 * own form with a <select> of every Topic — cards × Topics options in the page
 * and again in its payload. Now a card carries only a small button
 * (`data-topic-pick` with its format, id and current Topic) and this one dialog
 * opens for it.
 */
export function IdeaTopicDialog({ topics }: { topics: { id: string; name: string }[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [card, setCard] = useState<{ format: string; id: string; topic: string; title: string } | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const b = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-topic-pick]") : null;
      if (!b) return;
      e.preventDefault();
      setCard({ format: b.dataset.format ?? "", id: b.dataset.id ?? "", topic: b.dataset.topic ?? "", title: b.dataset.title ?? "" });
      ref.current?.showModal();
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return (
    <dialog ref={ref} className="rounded-xl border border-[var(--line-2)] p-4 w-[min(92vw,26rem)] bg-[var(--card)] text-[var(--ink)]" data-topic-dialog onClose={() => setCard(null)}>
      {card && (
        <form
          key={`${card.format}:${card.id}`}
          action={async (fd) => {
            await setBoardIdeaTopicAction(fd);
            ref.current?.close();
          }}
          className="flex flex-col gap-3"
        >
          <p className="m-0 text-xs text-[var(--mute)] flex items-center gap-1.5"><Tags className="w-3.5 h-3.5" style={{ color: "var(--indigo-on)" }} /> Topic for</p>
          <p className="m-0 text-sm font-semibold leading-snug">{card.title}</p>
          <input type="hidden" name="format" value={card.format} />
          <input type="hidden" name="id" value={card.id} />
          <select name="topicId" defaultValue={card.topic} className="text-sm" aria-label="Topic" autoFocus>
            <option value="">no topic</option>
            {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn sm" onClick={() => ref.current?.close()}>Cancel</button>
            <SubmitButton className="btn sm primary" pendingText="Saving…">Set Topic</SubmitButton>
          </div>
        </form>
      )}
    </dialog>
  );
}
