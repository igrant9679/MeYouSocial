import { verifyEmailAction } from "@/app/actions/auth-flows";

// Auto-redirects on submit. We render a one-click confirm so this isn't done by accident
// (and email clients can't auto-GET-trigger it).

export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="flex-1 grid place-items-center p-6 min-h-screen">
      <div className="card w-full max-w-md text-center">
        <h1 className="font-mono font-bold text-xl mb-2">Verify your email</h1>
        <p className="text-sm text-[var(--mute)] mb-4">Click the button to confirm you own this address.</p>
        <form action={verifyEmailAction}>
          <input type="hidden" name="token" value={token} />
          <button className="btn primary" type="submit">Confirm email</button>
        </form>
      </div>
    </div>
  );
}
