"use client";

import { useActionState } from "react";
import { createApiTokenAction, type CreateTokenState } from "@/app/actions/api-tokens";
import { SubmitButton } from "@/components/SubmitButton";
import { CopyButton } from "@/components/CopyButton";

/** Make an API token (E-SEC-16); the token is shown here once and nowhere else. */
export function CreateTokenForm() {
  const [state, action] = useActionState<CreateTokenState, FormData>(createApiTokenAction, null);
  return (
    <div className="card mb-4 text-xs flex flex-col gap-2">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 flex-1 min-w-48">
          <span className="text-[var(--mute)]">Name — what will use it</span>
          <input name="name" required maxLength={80} placeholder="e.g. Zapier, the reporting sheet" className="border border-[var(--line-2)] rounded-lg px-2 py-1.5 text-xs" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[var(--mute)]">Can</span>
          <select name="scope" defaultValue="read" className="border border-[var(--line-2)] rounded-lg px-2 py-1.5 text-xs">
            <option value="read">read</option>
            <option value="write">read and write</option>
          </select>
        </label>
        <SubmitButton className="btn sm primary" pendingText="Making…">Make a token</SubmitButton>
      </form>
      {state?.error && <p className="m-0" style={{ color: "var(--rose-on)" }}>{state.error}</p>}
      {state?.token && (
        <div className="rounded-lg p-2.5 flex flex-col gap-1.5" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}>
          <b>“{state.name}” — copy it now. It won&apos;t be shown again.</b>
          <div className="flex items-center gap-2">
            <code className="select-all break-all text-[11px] flex-1" data-token>{state.token}</code>
            <CopyButton text={state.token} />
          </div>
          <span>Send it as <code>Authorization: Bearer …</code> to /api/v1.</span>
        </div>
      )}
    </div>
  );
}
