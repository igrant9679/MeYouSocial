"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, SendHorizonal } from "lucide-react";
import { sendAssistantMessageAction } from "@/app/actions/assistant";
import { PromptLibrary } from "@/components/PromptLibrary";
import { UploadButton } from "@/components/UploadButton";

/**
 * The assistant's input box.
 *
 * ⚠ A turn runs the whole tool loop inside the request — `draft_article` alone
 * is a minute or two — so the pending state has to say more than "…". A button
 * that just greys out reads as a hang at these durations, and the second click
 * that follows would start a second turn.
 *
 * Since the Research chat folded in (2026-09-09) it also carries the prompt
 * library and, when there is an active channel, the paperclip: an upload
 * becomes a research source on the channel and "[attached: …]" is appended to
 * the message so the assistant reads it (read_research_source).
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

export function AssistantComposer({ threadId, autoFocus, defaultText, channelId }: { threadId: string | null; autoFocus?: boolean; defaultText?: string; channelId?: string | null }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const append = (line: string) => {
    const el = ref.current;
    if (!el) return;
    el.value = (el.value.trim() ? el.value.replace(/\s+$/, "") + "\n" : "") + line;
    el.focus();
  };
  return (
    <form action={sendAssistantMessageAction} className="card flex flex-col gap-2">
      {threadId && <input type="hidden" name="threadId" value={threadId} />}
      <textarea
        ref={ref}
        id="assistant-composer"
        name="message"
        rows={3}
        required
        autoFocus={autoFocus}
        defaultValue={defaultText ?? ""}
        placeholder={'e.g. "What should I do next?" · "Find three ideas about donor retention" · "Draft the idea about zero-volume keywords" · paste a YouTube link · "turn this into a script"'}
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
      <div className="flex items-center gap-2 flex-wrap">
        <Send />
        <span className="flex-1" />
        <PromptLibrary targetId="assistant-composer" />
        {channelId && (
          <UploadButton
            channelId={channelId}
            reload={false}
            compact
            onDone={(r) => append(`[attached: ${r.title} (research source ${r.id}, ${r.words} words)]`)}
          />
        )}
      </div>
    </form>
  );
}
