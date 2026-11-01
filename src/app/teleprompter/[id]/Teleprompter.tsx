"use client";

import { useState, useEffect, useRef, useSyncExternalStore } from "react";
import { Play, Pause, Minus, Plus, RotateCcw, FlipHorizontal2, Maximize, Minimize, Timer } from "lucide-react";
import { WORDS_PER_MINUTE } from "@/lib/canvas/duration";
import { clock, WPM_MAX, WPM_MIN, WPM_STEP, type PrompterBlock } from "@/lib/teleprompter";

// A teleprompter a presenter can drive with the keyboard (E-VID-02): the speed
// is words per minute against the script's own spoken words, a reading line
// marks where to look, and mirror / fullscreen / countdown are one key each.

type Prefs = { wpm: number; fontSize: number; mirror: boolean; countdown: boolean };
const DEFAULTS: Prefs = { wpm: WORDS_PER_MINUTE, fontSize: 48, mirror: false, countdown: true };
const PREFS_KEY = "mys.teleprompter.prefs";
const SIZE_MIN = 24, SIZE_MAX = 112, SIZE_STEP = 4;
/** Where the reading line sits, as a share of the view's height. */
const LINE_AT = 0.35;
const COUNTDOWN_FROM = 3;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Saved per browser: the pace and size a presenter settles on. An external
// store, so the server renders the defaults and the browser its own without a
// mismatch; memory is the truth once read, so a private window (storage
// refused) still has working controls for the session.
let current: Prefs | null = null;
const listeners = new Set<() => void>();
function parsePrefs(raw: string | null): Prefs {
  try {
    const saved = JSON.parse(raw ?? "null") as Partial<Prefs> | null;
    if (!saved) return DEFAULTS;
    return {
      wpm: clamp(Number(saved.wpm) || DEFAULTS.wpm, WPM_MIN, WPM_MAX),
      fontSize: clamp(Number(saved.fontSize) || DEFAULTS.fontSize, SIZE_MIN, SIZE_MAX),
      mirror: saved.mirror === true,
      countdown: saved.countdown !== false,
    };
  } catch {
    return DEFAULTS;
  }
}
function prefsSnapshot(): Prefs {
  if (!current) {
    let raw: string | null = null;
    try { raw = localStorage.getItem(PREFS_KEY); } catch { /* private window */ }
    current = parsePrefs(raw);
  }
  return current;
}
function savePrefs(next: Prefs) {
  current = next;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* kept in memory */ }
  listeners.forEach((l) => l());
}
function subscribePrefs(onChange: () => void) {
  const fromOtherTab = (e: StorageEvent) => { if (e.key === PREFS_KEY) { current = null; onChange(); } };
  listeners.add(onChange);
  window.addEventListener("storage", fromOtherTab);
  return () => { listeners.delete(onChange); window.removeEventListener("storage", fromOtherTab); };
}

export function Teleprompter({ blocks, words }: { blocks: PrompterBlock[]; words: number }) {
  const prefs = useSyncExternalStore(subscribePrefs, prefsSnapshot, () => DEFAULTS);
  const [playing, setPlaying] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [left, setLeft] = useState(words);
  const [fullscreen, setFullscreen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);

  const update = (patch: Partial<Prefs>) => savePrefs({ ...prefsSnapshot(), ...patch });

  // Scrolling: pixels per second from words per minute — the text's height
  // over its spoken words is how far one word moves the page.
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const el = scrollRef.current, text = textRef.current;
      if (words === 0) { setPlaying(false); return; } // nothing to read
      if (el && text) {
        el.scrollTop += (prefs.wpm / 60) * (text.offsetHeight / words) * dt;
        // At the end, stop rather than spin.
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) { setPlaying(false); return; }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, prefs.wpm, words]);

  // The countdown — each number for a second — then go.
  useEffect(() => {
    if (count == null) return;
    const t = setTimeout(() => {
      if (count <= 1) { setCount(null); setPlaying(true); } else setCount(count - 1);
    }, 1000);
    return () => clearTimeout(t);
  }, [count]);

  // Words still to read, from how far down the text the reading line is.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const range = el.scrollHeight - el.clientHeight;
      setLeft(range > 0 ? Math.round(words * (1 - el.scrollTop / range)) : words);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure); };
    el.addEventListener("scroll", onScroll, { passive: true });
    measure();
    return () => { el.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [words]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = () => {
    if (count != null) { setCount(null); return; }             // a press during the countdown cancels it
    if (playing) { setPlaying(false); return; }
    if (prefs.countdown) setCount(COUNTDOWN_FROM); else setPlaying(true);
  };
  const restart = () => { setPlaying(false); setCount(null); scrollRef.current?.scrollTo({ top: 0 }); };
  const nudge = (lines: number) => scrollRef.current?.scrollBy({ top: lines * prefs.fontSize * 1.5 });
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void rootRef.current?.requestFullscreen().catch(() => {});
  };

  // The keyboard drives it. Keys typed into a field, or pressed on a focused
  // control (Space on a button is that button's own press), are left alone.
  const keys = { toggle, restart, nudge, toggleFullscreen, update, prefs };
  const keysRef = useRef(keys);
  useEffect(() => { keysRef.current = keys; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (t && (t.closest("input, textarea, select, [contenteditable]") || (e.key === " " && t.closest("button, a")))) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = keysRef.current;
      const handled = (() => {
        switch (e.key) {
          case " ": k.toggle(); return true;
          case "ArrowUp": k.update({ wpm: clamp(k.prefs.wpm + WPM_STEP, WPM_MIN, WPM_MAX) }); return true;
          case "ArrowDown": k.update({ wpm: clamp(k.prefs.wpm - WPM_STEP, WPM_MIN, WPM_MAX) }); return true;
          case "ArrowLeft": case "PageUp": k.nudge(-3); return true;
          case "ArrowRight": case "PageDown": k.nudge(3); return true;
          case "+": case "=": k.update({ fontSize: clamp(k.prefs.fontSize + SIZE_STEP, SIZE_MIN, SIZE_MAX) }); return true;
          case "-": case "_": k.update({ fontSize: clamp(k.prefs.fontSize - SIZE_STEP, SIZE_MIN, SIZE_MAX) }); return true;
          case "m": case "M": k.update({ mirror: !k.prefs.mirror }); return true;
          case "c": case "C": k.update({ countdown: !k.prefs.countdown }); return true;
          case "f": case "F": k.toggleFullscreen(); return true;
          case "r": case "R": case "Home": k.restart(); return true;
          default: return false;
        }
      })();
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const busy = playing || count != null;
  const secondsLeft = (left / prefs.wpm) * 60;

  return (
    <div ref={rootRef} className="flex-1 min-h-0 flex flex-col relative bg-black text-white" data-teleprompter data-playing={playing ? "1" : "0"}>
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-auto px-6 md:px-12 text-center font-mono tracking-wide [scrollbar-width:none]"
        style={{ fontSize: prefs.fontSize, lineHeight: 1.5, paddingTop: `${LINE_AT * 100}vh`, paddingBottom: `${(1 - LINE_AT) * 100}vh` }}
        data-prompter-scroll
      >
        <div
          ref={textRef}
          className="max-w-5xl mx-auto flex flex-col gap-[0.6em]"
          style={prefs.mirror ? { transform: "scaleX(-1)" } : undefined}
          data-prompter-text
          data-mirror={prefs.mirror ? "1" : "0"}
        >
          {blocks.length === 0 ? (
            <p className="m-0 text-white/50">(empty script)</p>
          ) : blocks.map((b, i) =>
            b.kind === "heading" ? (
              <p key={i} className="m-0 text-[0.4em] uppercase tracking-[0.2em] text-amber-300/80" data-block="heading">{b.text}</p>
            ) : b.kind === "cue" ? (
              <p key={i} className="m-0 text-[0.55em] italic text-white/45" data-block="cue">{b.text}</p>
            ) : (
              <p key={i} className="m-0" data-block="spoken">{b.text}</p>
            ),
          )}
        </div>
      </div>

      {/* The reading line: look here; the text above it is fading out. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black via-black/70 to-transparent" style={{ height: `calc(${LINE_AT * 100}% - 0.6em)`, fontSize: prefs.fontSize }} />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 flex items-center" style={{ top: `${LINE_AT * 100}%` }} data-reading-line>
        <span className="border-y-[10px] border-y-transparent border-l-[14px] border-l-red-500" />
        <span className="flex-1 h-px bg-red-500/50" />
        <span className="border-y-[10px] border-y-transparent border-r-[14px] border-r-red-500" />
      </div>

      {count != null && (
        <div className="absolute inset-0 grid place-items-center bg-black/60 pointer-events-none" data-countdown={count} aria-live="assertive">
          <span className="font-mono font-bold text-[30vh] leading-none">{count}</span>
        </div>
      )}

      <div
        // Full width on a phone; on wider screens one row as wide as its content
        // (a centred fixed box shrinks to half the screen and folds into two rows).
        className={"fixed bottom-4 inset-x-4 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-max md:max-w-[calc(100vw-2rem)] flex flex-wrap items-center justify-center gap-2 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl px-3 py-2 transition-opacity " + (busy ? "opacity-25 hover:opacity-100 focus-within:opacity-100" : "")}
        data-prompter-controls
      >
        <button type="button" onClick={toggle} className="w-10 h-10 rounded-full grid place-items-center bg-white text-black hover:scale-105 transition" title={busy ? "Pause (Space)" : "Play (Space)"} aria-label={busy ? "Pause" : "Play"}>
          {busy ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
        </button>
        <Stepper label="Speed" shown={`${prefs.wpm} wpm`} keysHint="↑ ↓" onLess={() => update({ wpm: clamp(prefs.wpm - WPM_STEP, WPM_MIN, WPM_MAX) })} onMore={() => update({ wpm: clamp(prefs.wpm + WPM_STEP, WPM_MIN, WPM_MAX) })} />
        <Stepper label="Size" shown={`${prefs.fontSize}px`} keysHint="− +" onLess={() => update({ fontSize: clamp(prefs.fontSize - SIZE_STEP, SIZE_MIN, SIZE_MAX) })} onMore={() => update({ fontSize: clamp(prefs.fontSize + SIZE_STEP, SIZE_MIN, SIZE_MAX) })} />
        <Toggle on={prefs.mirror} onClick={() => update({ mirror: !prefs.mirror })} label="Mirror (M)"><FlipHorizontal2 className="w-4 h-4" /></Toggle>
        <Toggle on={prefs.countdown} onClick={() => update({ countdown: !prefs.countdown })} label={`${COUNTDOWN_FROM}-second countdown (C)`}><Timer className="w-4 h-4" /></Toggle>
        <Toggle on={fullscreen} onClick={toggleFullscreen} label="Fullscreen (F)">{fullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}</Toggle>
        <Toggle onClick={restart} label="Back to the top (R)"><RotateCcw className="w-4 h-4" /></Toggle>
        <div className="text-[11px] font-mono text-white/80 text-center leading-tight min-w-20" data-prompter-left>
          <b>{clock(secondsLeft)}</b> left<br /><span className="opacity-70">{left.toLocaleString()} / {words.toLocaleString()} words</span>
        </div>
      </div>
    </div>
  );
}

function Stepper({ label, shown, keysHint, onLess, onMore }: { label: string; shown: string; keysHint: string; onLess: () => void; onMore: () => void }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button type="button" onClick={onLess} aria-label={`Less ${label.toLowerCase()}`} className="w-7 h-7 rounded-full grid place-items-center bg-white/10 hover:bg-white/20"><Minus className="w-3.5 h-3.5" /></button>
      <div className="text-[11px] font-mono text-white/80 w-16 text-center leading-tight" title={`${label}: ${keysHint}`}><b>{label}</b><br /><span className="opacity-70" data-stepper={label.toLowerCase()}>{shown}</span></div>
      <button type="button" onClick={onMore} aria-label={`More ${label.toLowerCase()}`} className="w-7 h-7 rounded-full grid place-items-center bg-white/10 hover:bg-white/20"><Plus className="w-3.5 h-3.5" /></button>
    </div>
  );
}

/** A round control; `on` makes it a toggle (pressed state), without it a plain button. */
function Toggle({ on, onClick, label, children }: { on?: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={on}
      className={"w-9 h-9 rounded-full grid place-items-center transition " + (on ? "bg-white text-black" : "bg-white/10 hover:bg-white/20")}
    >
      {children}
    </button>
  );
}
