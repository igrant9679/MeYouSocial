"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-reads the page every 3 s while its jobs run, for 90 s at most, so a stuck
 * job can never trap anyone in a refresh loop.
 *
 * It was an inline <script> until 2026-11-24: the strict page policy
 * (lib/csp.ts `pageCsp`) runs only scripts that carry the page's nonce, and a
 * script React adds on a client-side visit never ran at all.
 */
export function RefreshWhileWorking({ ready }: { ready: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (ready) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started >= 90_000) clearInterval(timer);
      else router.refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [ready, router]);
  return null;
}
