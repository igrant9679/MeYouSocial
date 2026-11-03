import Link from "next/link";

export default function EmailTakenPage() {
  return (
    <div className="flex-1 grid place-items-center p-6 min-h-screen">
      <div className="card w-full max-w-md text-center">
        <h1 className="font-mono font-bold text-xl mb-2">That address can&apos;t be used</h1>
        <p className="text-sm text-[var(--mute)] mb-4">Another account signed up with it after you asked, so your sign-in email wasn&apos;t changed.</p>
        <Link href="/settings#email" className="btn">Back to settings</Link>
      </div>
    </div>
  );
}
