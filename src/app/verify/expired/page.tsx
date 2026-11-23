import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { resendVerificationAction } from "@/app/actions/auth-flows";

export default function VerifyExpiredPage() {
  return (
    <div className="flex-1 grid place-items-center p-6 min-h-screen">
      <div className="card w-full max-w-md text-center">
        <h1 className="font-mono font-bold text-xl mb-2">Verification link expired</h1>
        <p className="text-sm text-[var(--mute)] mb-4">Get a fresh one.</p>
        <form action={resendVerificationAction}>
          <SubmitButton className="btn primary">Send a new link</SubmitButton>
        </form>
        <p className="text-xs text-[var(--mute)] mt-4">
          <Link href="/signin" className="text-[var(--accent-on)] font-semibold">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
