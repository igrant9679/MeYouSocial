import { Archive, Check, Undo2 } from "lucide-react";
import { SubmitButton } from "@/components/SubmitButton";
import {
  dismissInboxItemAction,
  markInboxItemReadAction,
  restoreInboxItemAction,
} from "@/app/actions/social-inbox-events";

/**
 * The two verbs every Engage item carries, in one place so a review, a DM
 * thread and a comment all behave the same way.
 *
 *   Mark read — "I have seen this." It stays in the list, quieter.
 *   Set aside — "I have decided not to act." It moves to a collapsed group.
 *
 * ⚠ NEITHER TOUCHES THE NETWORK, and the copy says so wherever there is room.
 * A set-aside review is still public; a set-aside DM is still in the other
 * person's thread. Deleting either is not something this app can do — no
 * endpoint exists, and none could: you cannot remove somebody else's review or
 * their message. Only a comment on our OWN post can truly be deleted, which
 * the network decides per comment (`canDelete`) and which has its own button.
 *
 * ⚠ Must never be rendered INSIDE the row's <Link>. A DM row wraps the whole
 * row in an anchor, and a button inside an anchor is invalid HTML the parser
 * reshuffles — the same nesting trap that made the Inbox's Dismiss submit the
 * wrong action. These sit BESIDE the link.
 */
export function InboxItemState({
  kind,
  targetId,
  back,
  state,
  actorName,
  reason,
  compact = false,
}: {
  kind: "review" | "conversation" | "comment";
  targetId: string;
  back: string;
  /** null = untouched, or the state already recorded. */
  state: "read" | "aside" | null;
  actorName?: string | null;
  reason?: string | null;
  /** Drop the reason field, for a dense row. */
  compact?: boolean;
}) {
  const hidden = (
    <>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="targetId" value={targetId} />
      <input type="hidden" name="back" value={back} />
    </>
  );

  if (state === "aside") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[9.5px] text-[var(--mute)]">
          Set aside{actorName ? ` by ${actorName}` : ""}
          {reason ? ` — “${reason}”` : ""}
        </span>
        <form action={restoreInboxItemAction}>
          {hidden}
          <SubmitButton className="btn sm" pendingText="…" title="Put this back in the queue">
            <Undo2 className="w-3 h-3" /> Bring back
          </SubmitButton>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {state === "read" ? (
        <span className="font-mono text-[9.5px] text-[var(--mute)] inline-flex items-center gap-1">
          <Check className="w-3 h-3" style={{ color: "var(--green-on)" }} /> Read
        </span>
      ) : (
        <form action={markInboxItemReadAction}>
          {hidden}
          <SubmitButton className="btn sm" pendingText="…" title="You have seen it — it stays in the list">
            <Check className="w-3 h-3" /> Mark read
          </SubmitButton>
        </form>
      )}
      {/* Siblings, never nested — see the note above. */}
      <form action={dismissInboxItemAction} className="flex items-center gap-1.5">
        {hidden}
        {!compact && (
          <input
            name="reason"
            placeholder="why not (optional)"
            className="text-[11px] w-40"
            aria-label="Why this is being set aside"
          />
        )}
        <SubmitButton
          className="btn sm"
          pendingText="…"
          title="Stop offering this as work. Nothing changes on the network — it stays exactly where it is."
        >
          <Archive className="w-3 h-3" /> Set aside
        </SubmitButton>
      </form>
    </div>
  );
}
