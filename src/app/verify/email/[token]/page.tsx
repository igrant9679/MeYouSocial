import { confirmEmailChangeAction } from "@/app/actions/profile";
import { SubmitButton } from "@/components/SubmitButton";
import { db } from "@/lib/db";
import { EMAIL_CHANGE_PREFIX } from "@/lib/account";

// E-SHL-09: the link sent to a NEW sign-in address. One click confirms — a
// button, not the GET itself, so a mail client's link preview can't do it.

export default async function ConfirmEmailChangePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = await db.verificationToken.findUnique({ where: { token } }).catch(() => null);
  const valid = !!row && row.identifier.startsWith(EMAIL_CHANGE_PREFIX) && row.expires > new Date();
  const next = valid ? row!.identifier.slice(row!.identifier.indexOf(":", EMAIL_CHANGE_PREFIX.length) + 1) : null;
  return (
    <div className="flex-1 grid place-items-center p-6 min-h-screen">
      <div className="card w-full max-w-md text-center" data-email-change>
        <h1 className="font-mono font-bold text-xl mb-2">Confirm your new sign-in email</h1>
        {valid ? (
          <>
            <p className="text-sm text-[var(--mute)] mb-4">From now on you&apos;ll sign in as <b className="font-mono">{next}</b>.</p>
            <form action={confirmEmailChangeAction}>
              <input type="hidden" name="token" value={token} />
              <SubmitButton className="btn primary" pendingText="Confirming…">Use this address</SubmitButton>
            </form>
          </>
        ) : (
          <p className="text-sm text-[var(--mute)]">This link has expired or was already used. Ask for a new one under Settings → Profile.</p>
        )}
      </div>
    </div>
  );
}
