"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * The reply box in Engage.
 *
 * ⚠ There is no draft, no queue and no undo behind this button — it reaches a
 * real person (or a public comment thread) the moment it succeeds, unlike a
 * scheduled post which passes the approval gate and can be cancelled up to its
 * slot. So the UI does the two things it can: it names the account the reply
 * goes out AS, and it refuses to enable Send on empty or over-long text rather
 * than letting the server bounce it back after the fact.
 *
 * Client-side only for the counter and the disabled state; the send itself is a
 * plain server-action form, so it works the same if the JS never arrives.
 */
export function InboxReply({
  action,
  hidden,
  asLabel,
  placeholder,
  publicNote,
  maxLength = 2000,
}: {
  action: (formData: FormData) => void | Promise<void>;
  /** Hidden identifiers the action needs (conversation/post + account). */
  hidden: Record<string, string>;
  /** Which connected account this goes out as. */
  asLabel: string;
  placeholder: string;
  /** Shown when the reply is public rather than private. */
  publicNote?: string;
  maxLength?: number;
}) {
  const [text, setText] = useState("");
  const trimmed = text.trim();
  const over = trimmed.length > maxLength;
  const empty = trimmed.length === 0;

  return (
    <form action={action} className="mt-3 pt-3 border-t border-[var(--line)]">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <textarea
        name="message"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full text-xs border border-[var(--line-2)] rounded-lg px-2 py-1.5 resize-y"
      />
      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
        <span className="text-[10px] text-[var(--mute)]">
          Sends as <b>{asLabel}</b>
          {publicNote && <> · <span style={{ color: "var(--amber-on)" }}>{publicNote}</span></>}
        </span>
        <span className="flex-1" />
        <span
          className="font-mono text-[10px]"
          style={{ color: over ? "var(--rose-on)" : "var(--mute)" }}
        >
          {trimmed.length}/{maxLength}
        </span>
        <SubmitButton
          className="btn sm primary"
          pendingText="Sending…"
          disabled={empty || over}
          title={empty ? "Write something first" : over ? "Too long" : "Send now — this can't be undone"}
        >
          <Send className="w-3.5 h-3.5" /> Send
        </SubmitButton>
      </div>
    </form>
  );
}
