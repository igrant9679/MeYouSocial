"use client";

import { useActionState } from "react";
import { issueResetLinkAction, type ResetLinkState } from "@/app/actions/people";

/** "Reset link" on a member row: shows the one-hour link to pass on by hand. */
export function ResetLinkButton({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState<ResetLinkState, FormData>(issueResetLinkAction, null);
  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="userId" value={userId} />
      <button type="submit" className="btn sm" disabled={pending} title="A one-hour, single-use link to set a new password — for when the reset email can't arrive">
        {pending ? "Making…" : "Reset link"}
      </button>
      {state?.link && (
        <span className="max-w-72 text-left">
          <code className="block text-[11px] select-all break-all">{state.link}</code>
          <span className="text-[10px] text-[var(--mute)]">Works once, for an hour. Give it to them directly — anyone with it can set the password.</span>
        </span>
      )}
      {state?.error && <span className="max-w-72 text-[11px] text-left" style={{ color: "var(--rose-on)" }}>{state.error}</span>}
    </form>
  );
}
