"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, SendHorizonal } from "lucide-react";
import { sendAssistantMessageAction } from "@/app/actions/assistant";

/**
 * The assistant's input box.
 *
 * ⚠ A turn runs the whole tool loop inside the request — `draft_article` alone
 * is a minute or two — so the pending state has to say more than "…". A button
 * that just greys out reads as a hang at these durations, and the second click
 * that follows would start a second turn.
 */
function Send() {
  const { pending } = useFormStatus();
  return (
    <div className="flex items-center gap-2">
      <button type="submit" className="btn primary" disabled={pending}>
        {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <SendHorizonal className="w-3.5 h-3.5" />}
        {pending ? "Working…" : "Send"}
      </button>
      {pending && (
        <span className="text-[10px] text-[var(--mute)]">
          It may run several steps — writing an article takes a minute or two. Don&apos;t reload.
        </span>
      )}
    </div>
  );
}

export function AssistantComposer({ threadId, autoFocus }: { threadId: string | null; autoFocus?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <form action={sendAssistantMessageAction} className="card flex flex-col gap-2">
      {threadId && <input type="hidden" name="threadId" value={threadId} />}
      <textarea
        ref={ref}
        name="message"
        rows={3}
        required
        autoFocus={autoFocus}
        placeholder={'e.g. "What needs my attention?" · "Find three ideas about donor retention" · "Draft the idea about zero-volume keywords"'}
        className="w-full text-sm leading-relaxed"
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter breaks the line — the convention everywhere
          // else people type into a chat.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <Send />
    </form>
  );
}
