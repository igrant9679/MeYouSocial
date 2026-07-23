"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * The live autopilot ticker — real audit-log events scrolling in the header.
 * Server passes the initial events (no pop-in); the client refreshes every
 * 60s. Pauses on hover; each item deep-links. Renders nothing when there is
 * nothing true to show, and holds still under prefers-reduced-motion (the
 * newest event is visible, just not scrolling).
 */

export type TickerEvent = { label: string; tone: "ok" | "warn" | "info"; href: string | null; at: string };

const TONE_COLOR: Record<TickerEvent["tone"], string> = {
  ok: "var(--green-on)",
  warn: "var(--rose-on)",
  info: "var(--amber-on)",
};

export function LiveTicker({ initial }: { initial: TickerEvent[] }) {
  const [events, setEvents] = useState(initial);

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/ticker");
        if (!res.ok) return;
        const data = (await res.json()) as { events?: TickerEvent[] };
        if (Array.isArray(data.events) && data.events.length) setEvents(data.events);
      } catch {
        // network hiccup — keep showing what we have
      }
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  if (events.length === 0) return null;

  const item = (e: TickerEvent, i: number) => {
    const time = new Date(e.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const body = (
      <>
        <b style={{ color: TONE_COLOR[e.tone] }}>{e.label.split(" ")[0]}</b>{" "}
        {e.label.split(" ").slice(1).join(" ")} <span className="opacity-60">{time}</span>
      </>
    );
    return e.href ? (
      <Link key={i} href={e.href} className="hover:underline">{body}</Link>
    ) : (
      <span key={i}>{body}</span>
    );
  };

  return (
    // Container-based visibility: the ticker needs real spare width, which the
    // XL content-size (body zoom) eats without moving viewport breakpoints.
    // flex-[2] against the header's flex-1 spacer = the ticker claims 2/3 of
    // free space, capped so it never crowds the right-side controls.
    <div className="hidden @4xl:flex items-center min-w-0 flex-[2] max-w-md @6xl:max-w-3xl rounded-lg border border-[var(--line)] overflow-hidden" aria-label="Recent activity">
      <span className="font-mono text-[9px] font-bold tracking-widest px-2 py-1.5 shrink-0 text-white" style={{ background: "var(--ink)" }}>
        LIVE
      </span>
      <div className="ticker-clip flex-1 min-w-0">
        <div className="ticker-track font-mono text-[10.5px] text-[var(--slate)]">
          {[...events, ...events].map((e, i) => (
            <span key={i} className="inline-flex items-center gap-1 mx-3">{item(e, i)}<span className="opacity-40 ml-3">·</span></span>
          ))}
        </div>
      </div>
    </div>
  );
}
