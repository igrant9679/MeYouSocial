"use client"; // Error boundaries must be Client Components

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

/**
 * A page or a button that failed inside the app keeps the app around it
 * (tracker #16). With no boundary here, any throw replaced the whole window
 * with Next's bare "This page couldn't load", rail and all, and the person
 * had nowhere to go but Reload.
 *
 * Says what's known and no more: production hides the message, so only the
 * digest (the id in the server's log) is shown, for support.
 */
export default function AppError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <div className="p-6 w-full max-w-2xl">
      <div className="card flex flex-col gap-3" style={{ borderColor: "var(--rose)" }} role="alert">
        <h1 className="font-mono text-lg font-bold m-0 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5" style={{ color: "var(--rose-on)" }} aria-hidden />
          Something went wrong on our side
        </h1>
        <p className="text-sm m-0">
          This page, or the button you pressed, failed before it could finish. Nothing you saw as done was undone — but
          if you were sending or saving, check it went through before trying again.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn primary" onClick={() => unstable_retry()}>Try again</button>
          <Link href="/inbox" className="btn">Go to the Inbox</Link>
        </div>
        {error.digest && (
          <p className="text-[11px] text-[var(--mute)] m-0">
            If it keeps happening, tell the platform operator this reference: <span className="font-code">{error.digest}</span>
          </p>
        )}
      </div>
    </div>
  );
}
