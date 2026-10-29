"use client";

import { useSyncExternalStore } from "react";
import { noShellStale, shellStale, subscribeShell } from "@/lib/shell-live";

/**
 * Stops a stale tab from saving into the wrong company (E-SEC-13). Every server
 * action writes to the ACTIVE workspace — the cookie — so after a switch in
 * another tab, a form on this page (rendered for `name`) would save into the
 * other one. When the shell poll answers for a different workspace, this covers
 * the page until it's reloaded.
 */
export function WorkspaceGuard({ name }: { name: string }) {
  const stale = useSyncExternalStore(subscribeShell, shellStale, noShellStale);
  if (!stale) return null;
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="ws-guard-title" className="fixed inset-0 z-[60] grid place-items-center p-4" style={{ background: "color-mix(in srgb, var(--ink) 45%, transparent)" }}>
      <div className="card max-w-md text-sm flex flex-col gap-2">
        <b id="ws-guard-title">You switched workspace in another tab</b>
        <p className="m-0 text-xs">
          This page still shows <b>{name}</b>, but anything saved from it now would go to the workspace you switched to.
          Reload to see where you are.
        </p>
        <button type="button" className="btn primary sm self-start" onClick={() => window.location.reload()}>Reload</button>
      </div>
    </div>
  );
}
