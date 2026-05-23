import Link from "next/link";
import { requestPasswordResetAction } from "@/app/actions/auth-flows";

export default async function ForgotPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams;
  return (
    <div className="flex-1 grid place-items-center p-6">
      <div className="card w-full max-w-md">
        <h1 className="font-mono font-bold text-xl mb-1">Reset your password</h1>
        <p className="text-sm text-[var(--mute)] mb-5">We'll email you a link.</p>
        {ok === "1" && <p className="text-sm bg-[var(--green-soft)] text-[var(--green)] rounded-md px-3 py-2 mb-3">If an account exists for that email, a reset link is on its way. The link expires in 1 hour.</p>}
        {error === "expired" && <p className="text-sm text-[var(--brand)] mb-3">That link expired. Request a new one below.</p>}
        <form action={requestPasswordResetAction} className="flex flex-col gap-3">
          <label className="text-xs font-mono uppercase text-[var(--mute)]">Email
            <input name="email" type="email" required className="mt-1 w-full border border-[var(--line-2)] rounded-lg px-3 py-2 text-sm" />
          </label>
          <button className="btn primary mt-2" type="submit">Send reset link</button>
        </form>
        <p className="text-xs text-[var(--mute)] mt-4 text-center">
          <Link href="/signin" className="text-[var(--accent)] font-semibold">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
