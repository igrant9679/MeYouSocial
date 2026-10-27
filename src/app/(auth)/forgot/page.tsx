import Link from "next/link";
import { requestPasswordResetAction } from "@/app/actions/auth-flows";
import { SubmitButton } from "@/components/SubmitButton";
import { ValidatedInput } from "@/components/ValidatedInput";

export default async function ForgotPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams;
  return (
    <div className="flex-1 grid place-items-center p-6">
      <div className="card w-full max-w-md">
        <h1 className="font-mono font-bold text-xl mb-1">Reset your password</h1>
        <p className="text-sm text-[var(--mute)] mb-5">We'll email you a link.</p>
        {ok === "1" && <p className="text-sm bg-[var(--green-soft)] text-[var(--green)] rounded-md px-3 py-2 mb-3">If an account exists for that email, a reset link is on its way from your workspace's mailbox. The link expires in 1 hour. Nothing after a few minutes? Your workspace may have no mailbox connected — ask one of its admins for a reset link (Settings → People).</p>}
        {error === "expired" && <p className="text-sm text-[var(--brand)] mb-3">That link expired. Request a new one below.</p>}
        <form action={requestPasswordResetAction} className="flex flex-col gap-3">
          <ValidatedInput label="Email" name="email" type="email" required autoComplete="email" className="w-full border border-[var(--line-2)] rounded-lg px-3 py-2 text-sm" />
          <SubmitButton className="btn primary mt-2" pendingText="Sending…">Send reset link</SubmitButton>
        </form>
        <p className="text-xs text-[var(--mute)] mt-4 text-center">
          <Link href="/signin" className="text-[var(--accent)] font-semibold">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
