import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { ValidatedInput } from "@/components/ValidatedInput";
import { db } from "@/lib/db";
import { completePasswordResetAction } from "@/app/actions/auth-flows";

export default async function ResetPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const record = await db.verificationToken.findUnique({ where: { token } });
  const valid = record && record.identifier.startsWith("reset:") && record.expires > new Date();

  if (!valid) {
    return (
      <div className="flex-1 grid place-items-center p-6">
        <div className="card w-full max-w-md text-center">
          <h1 className="font-mono font-bold text-xl mb-2">Link expired</h1>
          <p className="text-sm text-[var(--mute)] mb-4">Reset links last one hour. Request a new one.</p>
          <Link href="/forgot" className="btn primary">Request new link</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 grid place-items-center p-6">
      <div className="card w-full max-w-md">
        <h1 className="font-mono font-bold text-xl mb-1">Choose a new password</h1>
        <p className="text-sm text-[var(--mute)] mb-5">8+ characters.</p>
        {error === "invalid" && <p className="text-sm text-[var(--brand-on)] mb-3">Password too short.</p>}
        <form action={completePasswordResetAction} className="flex flex-col gap-3">
          <input type="hidden" name="token" value={token} />
          <ValidatedInput label="New password" name="password" type="password" required minLength={8} autoComplete="new-password" errorMessage="Use at least 8 characters." className="w-full border border-[var(--line-2)] rounded-lg px-3 py-2 text-sm" />
          <SubmitButton className="btn primary mt-2">Reset password</SubmitButton>
        </form>
      </div>
    </div>
  );
}
