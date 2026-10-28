"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Check, X } from "lucide-react";

/**
 * Header chip showing every AI generation in flight for the active workspace —
 * background jobs (post images, Agent scripts, onboarding) and video renders.
 *
 * Hidden entirely when idle. While anything runs it pulses with a count and
 * expands (click) to per-item progress. When an item it was watching finishes,
 * it calls router.refresh() ONCE for that batch — the server components
 * re-render and the finished output (the image on a post card, the new ideas)
 * appears without the user reloading. Completed items linger for a few
 * seconds with a check/cross so completion is seen, not inferred.
 *
 * Polls /api/ai-activity every 5s while something runs or the person is
 * clicking around; idle, the gap doubles up to a minute. Nothing while the tab
 * is hidden — a background tab spending requests on a progress bar nobody can
 * see is waste.
 */

type Item = {
  id: string;
  label: string;
  state: "queued" | "running" | "done" | "failed";
  progress: number | null;
  detail: string | null;
};

// ENG-29: every 5 s while something is queued or running or the person just
// clicked; otherwise the gap doubles up to a minute (it polled every 5 s all
// day — ~17,000 requests per open tab).
const POLL_MS = 5_000;
const IDLE_MAX_MS = 60_000;

export function AiActivity() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  // Ids seen queued/running — the watch list a completion is judged against.
  const watched = useRef<Set<string>>(new Set());
  const stopped = useRef(false);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/ai-activity", { cache: "no-store" });
      if (res.status === 401) { stopped.current = true; return; }
      if (!res.ok) return;
      const { items: next } = (await res.json()) as { items: Item[] };

      // A watched item now done/failed — or gone entirely (finished while the
      // tab was hidden and its linger window passed) — means new output exists
      // server-side. One refresh per batch, not per item.
      const nextIds = new Set(next.map((i) => i.id));
      let finished = false;
      for (const id of watched.current) {
        const now = next.find((i) => i.id === id);
        if (!now || now.state === "done" || now.state === "failed") {
          finished = true;
          watched.current.delete(id);
        }
      }
      for (const i of next) if (i.state === "queued" || i.state === "running") watched.current.add(i.id);

      setItems(next);
      if (finished) router.refresh();
    } catch {
      // transient network failure — keep the last known state, try again next tick
    }
  }, [router]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let dueAt = 0;
    let gap = POLL_MS;
    // A chain stops once the run number moves on — hiding and showing the tab
    // during a poll would otherwise leave two chains polling.
    let run = 0;
    const schedule = (mine: number, ms: number) => {
      dueAt = Date.now() + ms;
      timer = setTimeout(() => void tick(mine), ms);
    };
    const tick = async (mine: number) => {
      timer = null;
      if (mine !== run || stopped.current || document.hidden) return;
      await poll();
      if (mine !== run) return;
      gap = watched.current.size > 0 ? POLL_MS : Math.min(IDLE_MAX_MS, gap * 2);
      if (!stopped.current && !document.hidden) schedule(mine, gap);
    };
    const start = () => {
      if (timer || stopped.current) return;
      run++;
      gap = POLL_MS;
      void tick(run);
    };
    const stop = () => {
      run++;
      if (timer) { clearTimeout(timer); timer = null; }
    };
    // A click or submit may have started work: poll within 5 s and keep the 5 s
    // cadence for a while (the gap then doubles from there).
    const nudge = () => {
      if (stopped.current || document.hidden) return;
      gap = Math.min(gap, POLL_MS / 2);
      if (timer && dueAt - Date.now() > POLL_MS) { clearTimeout(timer); schedule(run, POLL_MS); }
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("click", nudge, true);
    document.addEventListener("submit", nudge, true);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("click", nudge, true);
      document.removeEventListener("submit", nudge, true);
    };
  }, [poll]);

  const active = items.filter((i) => i.state === "queued" || i.state === "running");
  if (items.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-colors"
        style={{ background: active.length ? "var(--violet-soft)" : "var(--green-soft)", color: active.length ? "var(--violet-on)" : "var(--green-on)" }}
        title={active.length ? `${active.length} AI generation${active.length === 1 ? "" : "s"} running` : "AI work finished"}
        aria-label="AI activity"
      >
        <Sparkles className={`w-4 h-4 ${active.length ? "animate-pulse" : ""}`} strokeWidth={2.25} />
        {active.length > 0 ? active.length : <Check className="w-3.5 h-3.5" />}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-[var(--line)] shadow-lg p-3 z-50 flex flex-col gap-2.5" style={{ background: "var(--bg)" }}>
          <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">AI activity</div>
          {items.map((i) => (
            <div key={i.id} className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-xs">
                {i.state === "done" && <Check className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--green-on)" }} />}
                {i.state === "failed" && <X className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--rose-on)" }} />}
                <span className="font-semibold truncate">{i.label}</span>
                <span className="flex-1" />
                <span className="font-mono text-[10px] text-[var(--mute)]">
                  {i.state === "queued" ? "queued"
                    : i.state === "running" ? (i.progress != null ? `${Math.round(i.progress * 100)}%` : "working…")
                    : i.state}
                </span>
              </div>
              {(i.state === "running" || i.state === "queued") && (
                <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--zebra)" }}>
                  <div
                    className={i.progress == null ? "h-full w-full animate-pulse" : "h-full transition-[width] duration-500"}
                    style={{ background: "var(--violet)", width: i.progress == null ? "100%" : `${Math.max(4, Math.round(i.progress * 100))}%` }}
                  />
                </div>
              )}
              {i.detail && <div className="text-[10px] text-[var(--mute)] truncate" title={i.detail}>{i.detail}</div>}
            </div>
          ))}
          <div className="text-[10px] text-[var(--mute)]">
            The page refreshes itself when something finishes.
          </div>
        </div>
      )}
    </div>
  );
}
