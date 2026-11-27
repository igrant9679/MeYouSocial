"use client";

import { useActionState } from "react";
import { makeSigningSecretAction, type SecretState } from "@/app/actions/signups";
import { SubmitButton } from "@/components/SubmitButton";
import { CopyButton } from "@/components/CopyButton";

/** Make the website's signing secret (Settings → Sign-ups); shown here once and nowhere else. */
export function SigningSecretForm({ hasSecret }: { hasSecret: boolean }) {
  const [state, action] = useActionState<SecretState, FormData>(makeSigningSecretAction, null);
  return (
    <div className="flex flex-col gap-2">
      <form action={action} className="flex flex-wrap items-center gap-2">
        {hasSecret && (
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" name="confirm" /> Replace it — the website must switch within a day
          </label>
        )}
        <SubmitButton className={hasSecret ? "btn sm" : "btn sm primary"} pendingText="Making…">
          {hasSecret ? "Make a new secret" : "Make the signing secret"}
        </SubmitButton>
      </form>
      {state?.error && <p className="m-0" style={{ color: "var(--rose-on)" }}>{state.error}</p>}
      {state?.secret && (
        <div className="rounded-lg p-2.5 flex flex-col gap-1.5" style={{ background: "var(--green-soft)", color: "var(--green-on)" }} data-signing-secret>
          <b>Copy it now into the website&apos;s settings. It won&apos;t be shown again.</b>
          <div className="flex items-center gap-2">
            <code className="select-all break-all text-2xs flex-1">{state.secret}</code>
            <CopyButton text={state.secret} />
          </div>
          <span>
            Fingerprint {state.fingerprint}.{state.replaced ? " The previous secret keeps working for 24 hours, then stops." : ""}
          </span>
        </div>
      )}
    </div>
  );
}
