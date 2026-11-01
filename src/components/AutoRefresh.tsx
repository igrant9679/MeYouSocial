"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { pollDelay } from "@/components/poll-pace";

/**
 * Re-reads the page every `seconds` while it's open and visible — for work that
 * finishes on the server, such as a render (audit VID-09: the pages never
 * refreshed, so a finished or failed render looked stuck until a reload).
 * Slower while nobody's using the page, and a fresh read on coming back to
 * the tab (E-PRF-04).
 */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
      t = setTimeout(tick, pollDelay(seconds * 1000));
    };
    t = setTimeout(tick, pollDelay(seconds * 1000));
    const onVisible = () => { if (document.visibilityState === "visible") router.refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(t); document.removeEventListener("visibilitychange", onVisible); };
  }, [router, seconds]);
  return null;
}
