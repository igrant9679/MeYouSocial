"use client";

/**
 * How often a poller should run (E-PRF-04): its own pace while someone is
 * using the page, four times slower after five idle minutes, ten times after
 * thirty — and not at all while the tab is hidden (each poller checks
 * `document.hidden`). A tab left open overnight used to poll every minute all
 * night. Input anywhere on the page counts as activity.
 */
const IDLE_SOON = 5 * 60_000;
const IDLE_LONG = 30 * 60_000;
let lastInput = Date.now();
let wired = false;

function wire() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  const mark = () => { lastInput = Date.now(); };
  for (const e of ["pointerdown", "pointermove", "keydown", "scroll", "touchstart", "focus"]) {
    window.addEventListener(e, mark, { passive: true, capture: true });
  }
}

export function pollDelay(baseMs: number): number {
  wire();
  const idle = Date.now() - lastInput;
  return idle < IDLE_SOON ? baseMs : idle < IDLE_LONG ? baseMs * 4 : baseMs * 10;
}

/** True when the person has been away long enough that a fresh read is worth doing on their return. */
export function wasIdle(): boolean {
  wire();
  return Date.now() - lastInput >= IDLE_SOON;
}
