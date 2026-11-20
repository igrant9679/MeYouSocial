// How long ago this container started, so a start-up's log lines say where its time went.
//
// The 2026-11-19 deploy of fdc530c failed Railway's 60-second health check. The container
// started and migrate finished three seconds later, but nothing in the log said where the
// next minute went. The seed and the server now print their timings counted from the
// container's start (see prisma/seed.ts and src/instrumentation.ts).
//
// Linux only. PID 1 starts with the container, and /proc/1/stat gives its start in clock
// ticks since the host booted, which is the same clock /proc/uptime counts. Anywhere else,
// or when /proc reads oddly, the answer is null and the lines simply leave the figure out.
// Never throws: this runs on every boot and must not stop one.

import { readFileSync } from "node:fs";

/** Linux reports process start times in USER_HZ ticks, 100 a second on every mainstream build. */
const TICKS_PER_SECOND = 100;

/**
 * Seconds since the container started, to one decimal, from the text of `/proc/1/stat` and
 * `/proc/uptime`. Null when either is unreadable or the answer isn't plausible.
 */
export function parseContainerAge(stat: string, uptime: string, ticksPerSecond = TICKS_PER_SECOND): number | null {
  // "1 (sh) S 0 1 1 …": the command name can hold spaces and parentheses, so count fields
  // from after the LAST ")". The first field after it is field 3 (state); starttime is field 22.
  const close = stat.lastIndexOf(")");
  if (close < 0) return null;
  const fields = stat.slice(close + 1).trim().split(/\s+/);
  const startTicks = Number(fields[19]);
  const upSeconds = Number(uptime.trim().split(/\s+/)[0]);
  if (!Number.isFinite(startTicks) || !Number.isFinite(upSeconds) || ticksPerSecond <= 0) return null;
  const age = upSeconds - startTicks / ticksPerSecond;
  // A negative age, or one over a year, means /proc isn't what this expects.
  if (!(age >= 0 && age < 365 * 24 * 3600)) return null;
  return Math.round(age * 10) / 10;
}

/** Seconds since this container started, or null off Linux or when /proc can't say. */
export function containerAgeSeconds(): number | null {
  if (process.platform !== "linux") return null;
  try {
    return parseContainerAge(readFileSync("/proc/1/stat", "utf8"), readFileSync("/proc/uptime", "utf8"));
  } catch {
    return null;
  }
}

/** "container up 8.1 s", or "" when the age isn't known, for the end of a log line. */
export function containerUpLabel(): string {
  const age = containerAgeSeconds();
  return age === null ? "" : `container up ${age.toFixed(1)} s`;
}
