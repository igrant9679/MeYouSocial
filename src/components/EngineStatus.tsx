"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { EngineEvent } from "@/lib/dashboard-data";

/**
 * One plain-English status pill, where a three-chip marquee used to scroll.
 *
 * ⚠ What it replaced (audit A7, 2026-09-20): a ticker rendering audit rows as
 * all-caps tokens — `LIVE · RENDERED 12:13 · SOCIAL queued "- No-code worki…"`
 * — in the most valuable strip of every page, one item always truncated
 * mid-word. It scrolled, so it was never still long enough to read, and nobody
 * could say what "RENDERED 12:13" meant.
 *
 * The pill answers one question ("is the engine working, and what did it last
 * do?") in a sentence. Everything the ticker carried is still here, in the
 * panel behind it — with full titles, real times and their links.
 *
 * Nothing is invented: with no events it says so rather than showing a zero,
 * and the time comes from the caller's fixed `timeZone` so the server and the
 * browser format the same string (the hydration mismatch the ticker hit — see
 * the note that used to live in LiveTicker).
 */

export type EngineState = {
  paused: boolean;
  autonomous: boolean;
};

const DOT: Record<EngineEvent["tone"], string> = {
  ok: "var(--green-on)",
  warn: "var(--rose-on)",
  info: "var(--amber-on)",
};

function timeIn(at: string, timeZone: string) {
  return new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
}

function dayIn(at: string, timeZone: string) {
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone });
}

export function EngineStatus({
  initial,
  state: initialState,
  timeZone,
}: {
  initial: EngineEvent[];
  state: EngineState;
  timeZone: string;
}) {
  const [events, setEvents] = useState(initial);
  const [state, setState] = useState(initialState);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/ticker");
        if (!res.ok) return;
        const data = (await res.json()) as { events?: EngineEvent[]; state?: EngineState };
        if (Array.isArray(data.events)) setEvents(data.events);
        if (data.state) setState(data.state);
      } catch {
        // network hiccup — keep showing what we have
      }
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // Click-away and Escape, so the panel never strands over the page.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const latest = events[0] ?? null;

  // The sentence on the pill. Paused outranks everything: it is the one state
  // where "nothing happened recently" is the point rather than a lull.
  const headline = state.paused
    ? "Paused"
    : latest
      ? `${latest.what[0].toUpperCase()}${latest.what.slice(1)}`
      : "Nothing has run yet";
  const dot = state.paused ? "var(--rose-on)" : latest ? DOT[latest.tone] : "var(--mute)";

  // The line under the panel's title — what the engine is set to do at all.
  const mode = state.paused
    ? "Everything is on hold until you resume it."
    : state.autonomous
      ? "Running on its own — it drafts, reviews, publishes and posts without waiting for a click."
      : "Running with your approval at the checkpoints you set.";

  return (
    <div ref={box} className="relative hidden @2xl:block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex items-center gap-2 max-w-[22rem] px-2.5 py-1.5 rounded-lg border border-[var(--line)] hover:bg-[var(--zebra)] transition-colors text-left"
        title="What the engine has been doing"
      >
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: dot }} aria-hidden />
        <span className="text-[12px] text-[var(--slate)] truncate min-w-0">
          {headline}
          {latest && !state.paused && (
            <span className="text-[var(--mute)]"> · {timeIn(latest.at, timeZone)}</span>
          )}
        </span>
        <ChevronDown className={"w-3.5 h-3.5 flex-shrink-0 text-[var(--mute)] transition-transform" + (open ? " rotate-180" : "")} aria-hidden />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Recent engine activity"
          className="absolute top-full left-0 mt-1.5 w-[26rem] max-w-[90vw] card z-50 shadow-xl"
        >
          <h2 className="text-sm font-semibold mb-0.5">What the engine is doing</h2>
          <p className="text-xs text-[var(--mute)] mb-3">{mode}</p>

          {events.length === 0 ? (
            <p className="text-xs text-[var(--mute)]">
              Nothing has run yet in this workspace. It has not failed — there has just been nothing to do.
            </p>
          ) : (
            <ul className="flex flex-col gap-2 max-h-[22rem] overflow-y-auto">
              {events.map((e, i) => {
                const line = (
                  <>
                    <span className="font-mono text-[10px] text-[var(--mute)] tabular-nums flex-shrink-0 pt-0.5">
                      {timeIn(e.at, timeZone)}
                    </span>
                    <span className="min-w-0">
                      <span className="text-[12px]" style={{ color: DOT[e.tone] }}>{e.what}</span>
                      {e.title && <span className="text-[12px] text-[var(--slate)]"> — “{e.title}”</span>}
                      <span className="block font-mono text-[10px] text-[var(--mute)]">{dayIn(e.at, timeZone)}</span>
                    </span>
                  </>
                );
                return (
                  <li key={i} className="flex gap-2">
                    {e.href ? (
                      <Link href={e.href} className="flex gap-2 hover:underline" onClick={() => setOpen(false)}>
                        {line}
                      </Link>
                    ) : (
                      line
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-3 pt-3 border-t border-[var(--line)]">
            <Link href="/setup/automation" className="text-xs text-[var(--brand-on)] hover:underline" onClick={() => setOpen(false)}>
              Change what runs by itself →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
