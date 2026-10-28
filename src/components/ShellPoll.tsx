"use client";

import { useEffect, useLayoutEffect } from "react";
import { publishShell, type ShellSnapshot } from "@/lib/shell-live";

const POLL_MS = 60_000;

/**
 * The header's one poll (E-SHL-01), rendering nothing. It publishes the
 * layout's own values whenever the layout re-renders (navigation into a fresh
 * layout, a revalidated action), then /api/shell every minute while the tab is
 * visible, and once more when it becomes visible again. An answer for another
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
        if (data.workspaceId !== workspaceId || !Array.isArray(data.events) || !data.state || !data.counts) return;
        publishShell({ workspaceId, events: data.events, state: data.state, unread: data.unread ?? 0, counts: data.counts });
      } catch {
        // A network hiccup — keep what's on screen.
      }
    };
    const id = setInterval(() => void pull(), POLL_MS);
    const onVisible = () => { if (!document.hidden) void pull(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [workspaceId]);

  return null;
}
