"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";

/**
 * App-wide flash message, rendered once in (app)/layout.tsx.
 *
 * WHY ITS OWN PARAMS, not the `ok`/`err` the pages already use: those are a
 * different convention. `/admin/api-keys` redirects with `ok=anthropic` and
 * renders "Saved anthropic key" around it — the value is a TOKEN, not a
 * sentence. A global banner keyed on `ok` would print a bare "anthropic" on
 * every such redirect, and would double up wherever a page already renders its
 * own. `flash` / `flashErr` carry a complete, ready-to-display sentence and
 * belong to nothing else.
 *
 * This exists because a refused delete used to be SILENT: the last-admin guard
 * returned its reason in the query string and no page displayed it, so a
 * deliberately blocked destructive action looked like a dead button.
 *
 * Errors persist until dismissed; successes clear themselves after a few
 * seconds. Both strip the param from the URL on dismissal, so a refresh or a
 * back-navigation doesn't resurrect a stale message.
 */
export function FlashBanner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const ok = params.get("flash");
  const err = params.get("flashErr");
  const message = err ?? ok;
  const isError = Boolean(err);

  // Dismissal is stored AS the message it applies to, not as a boolean.
  // A boolean needs an effect to reset it when a new message arrives, and
  // setting state synchronously inside an effect causes a cascading re-render
  // (react-hooks/purity rejects it). Deriving it costs nothing and means a
  // fresh message can never inherit the previous one's dismissed state.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const dismissed = message !== null && dismissedFor === message;

  useEffect(() => {
    if (!message || isError) return;
    const t = setTimeout(() => setDismissedFor(message), 6000);
    return () => clearTimeout(t);
  }, [message, isError]);

  // Strip the param once dismissed. `replace` so it doesn't add a history
  // entry, `scroll: false` so the page doesn't jump under the user.
  useEffect(() => {
    if (!dismissed || !message) return;
    const next = new URLSearchParams(params.toString());
    next.delete("flash");
    next.delete("flashErr");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [dismissed, message, params, pathname, router]);

  if (!message || dismissed) return null;

  return (
    <div
      role={isError ? "alert" : "status"}
      className="card mb-4 flex items-start gap-2"
      style={{
        background: isError ? "var(--rose-soft)" : "var(--green-soft)",
        borderColor: isError ? "var(--rose)" : "var(--green)",
        color: isError ? "var(--rose-on)" : "var(--green-on)",
      }}
    >
      {isError ? (
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      ) : (
        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
      )}
      <span className="text-sm flex-1 leading-relaxed">{message}</span>
      <button
        type="button"
        onClick={() => setDismissedFor(message)}
        aria-label="Dismiss message"
        className="shrink-0 p-0.5 rounded hover:opacity-70"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
