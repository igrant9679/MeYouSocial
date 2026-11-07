"use client";

import { useEffect, useRef, useState } from "react";
import { Send, FileText, X, Clock } from "lucide-react";
import { SubmitButton } from "@/components/SubmitButton";
import { formatWindowLeft, WINDOW_WARN_MS, type SavedReply } from "@/lib/inbox-team-shared";

/**
 * The reply box in Engage.
 *
 * ⚠ There is no queue and no undo behind Send — it reaches a real person (or a
 * public comment thread) the moment it succeeds, unlike a scheduled post which
 * passes the approval gate and can be cancelled up to its slot. So the UI does
 * the three things it can: it names the account the reply goes out AS, it
 * refuses to enable Send on empty or over-long text rather than letting the
 * server bounce it back after the fact, and — where the caller supplies a
 * `draftAction` — it offers somewhere to put an answer that isn't ready.
 *
 * ⚠ A DRAFT IS NOT A QUEUE. Saving one publishes nothing and schedules nothing;
 * the text simply waits until a person comes back and presses Send. Both
 * buttons submit this same form (via `formAction`), so the draft that gets
 * saved is character-for-character the one that would have gone out.
 *
 * Client-side only for the counter and the disabled states; the send itself is
 * a plain server-action form, so it works the same if the JS never arrives.
 */
export function InboxReply({
  action,
  hidden,
  asLabel,
  placeholder,
  publicNote,
  maxLength = 2000,
  draftAction,
  discardDraftAction,
  initialText,
  draftNote,
  draftLabel,
  draftTitle,
  savedReplies,
  windowClosesAt,
}: {
  /**
   * The send. OMIT IT to get a draft-only box — that is what an editor sees
   * while `social:require_approval` reserves publishing for admins: they can
   * still write the answer, they just can't be the one to release it.
   */
  action?: (formData: FormData) => void | Promise<void>;
  /** Hidden identifiers the action needs (conversation/post/review + account). */
  hidden: Record<string, string>;
  /** Which connected account this goes out as. */
  asLabel: string;
  placeholder: string;
  /** Shown when the reply is public rather than private. */
  publicNote?: string;
  maxLength?: number;
  /** Supplying this turns on "Save draft". Omit it and the box is send-only. */
  draftAction?: (formData: FormData) => void | Promise<void>;
  discardDraftAction?: (formData: FormData) => void | Promise<void>;
  /** A saved draft, loaded back into the box so it can be edited or sent. */
  initialText?: string;
  /** e.g. "Draft saved 10 Aug by Idris" — only when one actually exists. */
  draftNote?: string;
  /** The draft button's words and tooltip, when "Save draft" isn't what it does (E-SOC-17: "Submit for approval"). */
  draftLabel?: string;
  draftTitle?: string;
  /** The workspace's saved snippets, to drop into the reply (E-SOC-17). */
  savedReplies?: SavedReply[];
  /** ISO time the 24-hour DM window shuts — shown as a live countdown. */
  windowClosesAt?: string | null;
}) {
  const [text, setText] = useState(initialText ?? "");
  const box = useRef<HTMLTextAreaElement>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!windowClosesAt) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [windowClosesAt]);
  const trimmed = text.trim();
  const over = trimmed.length > maxLength;
  const empty = trimmed.length === 0;
  const closes = windowClosesAt ? new Date(windowClosesAt) : null;
  const leftMs = closes ? closes.getTime() - now : 0;

  // A saved reply goes in at the cursor (or replaces a selection), not over what's written.
  const insert = (body: string) => {
    const el = box.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + body + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + body.length, start + body.length);
    });
  };

  // Enter-to-submit and a bare click both fall through to the form's own
  // action, so the DEFAULT must be the safe one when there is no Send button.
  return (
    <form action={action ?? draftAction} className="mt-3 pt-3 border-t border-[var(--line)]">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {draftNote && (
        // Stated above the text, not below the buttons: someone opening this
        // page is looking at words they may not have written, and needs to know
        // that before they read them — and that they are still unpublished.
        <p className="text-micro font-mono mb-1" style={{ color: "var(--amber-on)" }}>
          <FileText className="w-3 h-3 inline-block mr-1 -mt-0.5" aria-hidden />
          {draftNote} · not sent
        </p>
      )}
      {(closes || (savedReplies && savedReplies.length > 0)) && (
        <div className="flex flex-wrap items-center gap-2 mb-1.5">
          {closes && (
            <span
              className="inline-flex items-center gap-1 font-mono text-micro px-1.5 py-0.5 rounded-full"
              data-reply-window={leftMs > 0 ? "open" : "closed"}
              title="Meta only accepts a reply within 24 hours of their last message"
              style={
                leftMs <= 0 ? { background: "var(--rose-soft)", color: "var(--rose-on)" }
                  : leftMs < WINDOW_WARN_MS ? { background: "var(--amber-soft)", color: "var(--amber-on)" }
                  : { background: "var(--panel)", color: "var(--mute)" }
              }
            >
              <Clock className="w-3 h-3" aria-hidden />
              Reply window: {formatWindowLeft(closes, new Date(now))}
            </span>
          )}
          <span className="flex-1" />
          {savedReplies && savedReplies.length > 0 && (
            <select
              aria-label="Insert a saved reply"
              className="text-2xs max-w-[16rem]"
              value=""
              data-saved-replies=""
              onChange={(e) => {
                const r = savedReplies.find((s) => s.id === e.target.value);
                if (r) insert(r.body);
              }}
            >
              <option value="">Insert a saved reply…</option>
              {savedReplies.map((r) => (
                <option key={r.id} value={r.id}>{r.category ? `${r.category} · ` : ""}{r.name}</option>
              ))}
            </select>
          )}
        </div>
      )}
      <textarea
        ref={box}
        name="message"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full text-xs border border-[var(--line-2)] rounded-lg px-2 py-1.5 resize-y"
      />
      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
        <span className="text-micro text-[var(--mute)]">
          {action ? "Sends as" : "Would send as"} <b>{asLabel}</b>
          {publicNote && <> · <span style={{ color: "var(--amber-on)" }}>{publicNote}</span></>}
        </span>
        <span className="flex-1" />
        <span
          className="font-mono text-micro"
          style={{ color: over ? "var(--rose-on)" : "var(--mute)" }}
        >
          {trimmed.length}/{maxLength}
        </span>
        {draftNote && discardDraftAction && (
          <SubmitButton
            className="btn sm"
            formAction={discardDraftAction}
            pendingText="Discarding…"
            title="Throw the saved draft away. The review itself is untouched."
          >
            <X className="w-3.5 h-3.5" /> Discard draft
          </SubmitButton>
        )}
        {draftAction && (
          <SubmitButton
            className="btn sm"
            formAction={draftAction}
            pendingText="Saving…"
            disabled={empty || over}
            title={
              empty ? "Write something first"
                : over ? "Too long"
                : draftTitle ?? "Save this to come back to. Nothing is sent."
            }
          >
            <FileText className="w-3.5 h-3.5" /> {draftLabel ?? "Save draft"}
          </SubmitButton>
        )}
        {action && (
          <SubmitButton
            className="btn sm primary"
            pendingText="Sending…"
            disabled={empty || over}
            title={empty ? "Write something first" : over ? "Too long" : "Send now — this can't be undone"}
          >
            <Send className="w-3.5 h-3.5" /> Send
          </SubmitButton>
        )}
      </div>
    </form>
  );
}
