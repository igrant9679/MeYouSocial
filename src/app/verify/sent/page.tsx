import Link from "next/link";
export default function VerifySentPage() {
  return (
    <div className="flex-1 grid place-items-center p-6 min-h-screen">
      <div className="card w-full max-w-md text-center">
        <h1 className="font-mono font-bold text-xl mb-2">Verification email sent</h1>
        <p className="text-sm text-[var(--mute)] mb-4">Check your inbox. The link is valid for 24 hours.</p>
        <Link href="/dashboard" className="btn">Back to dashboard</Link>
      </div>
    </div>
  );
}
