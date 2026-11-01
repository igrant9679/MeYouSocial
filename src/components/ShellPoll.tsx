"use client";

import { useEffect, useLayoutEffect } from "react";
import { publishShell, publishStale, type ShellSnapshot } from "@/lib/shell-live";
import { pollDelay, wasIdle } from "@/components/poll-pace";

const POLL_MS = 60_000;

/**
 * The header's one poll (E-SHL-01), rendering nothing. It publishes the
 * layout's own values whenever the layout re-renders (navigation into a fresh
 * layout, a revalidated action), then /api/shell every minute while the tab is
 * visible and someone is using it — slower the longer they're away, never while
 * hidden (E-PRF-04) — and once more when it becomes visible or they come back. An answer for another
 * workspace — the person switched in a second tab — is ignored: this page
 * belongs to the one it was rendered for.
 *
 * AiActivity keeps its own, faster poll: it watches work that finishes in
 * seconds, and folding it in here would mean polling the whole shell that often.
 */
export function ShellPoll({ initial }: { initial: ShellSnapshot }) {
  // The server's values are the newest whenever they arrive.
  useLayoutEffect(() => {
    publishShell(initial);
  }, [initial]);

  const workspaceId = initial.workspaceId;
  useEffect(() => {
    let stopped = false;
    const pull = async () => {
      if (stopped || document.hidden) return;
      try {
        const res = await fetch("/api/shell", { cache: "no-store" });
        if (res.status === 401) { stopped = true; return; }
        if (!res.ok) return;
        const data = (await res.json()) as Partial<ShellSnapshot>;
        // Another workspace answered: the person switched in a second tab. Say so (WorkspaceGuard).
        if (data.workspaceId && data.workspaceId !== workspaceId) { publishStale(data.workspaceId); return; }
        if (!Array.isArray(data.events) || !data.state || !data.counts) return;
        publishShell({ workspaceId, events: data.events, state: data.state, unread: data.unread ?? 0, counts: data.counts });
      } catch {
        // A network hiccup — keep what's on screen.
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next = () => { if (!stopped) timer = setTimeout(() => void pull().then(next), pollDelay(POLL_MS)); };
    const now = () => { clearTimeout(timer); void pull().then(next); };
    next();
    const onVisible = () => { if (!document.hidden) now(); };
    // Back from a long idle: read now rather than wait out the slow pace.
    const onReturn = () => { if (wasIdle()) now(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pointerdown", onReturn, { capture: true });
    window.addEventListener("keydown", onReturn, { capture: true });
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pointerdown", onReturn, { capture: true });
      window.removeEventListener("keydown", onReturn, { capture: true });
    };
  }, [workspaceId]);

  return null;
}
