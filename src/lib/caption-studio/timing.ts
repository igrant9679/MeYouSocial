import { zonedParts, zonedTimeToUtc } from "@/lib/social/slots";

/**
 * When each caption should go out — proposed, never imposed: every time is
 * editable on the review page before anything is scheduled.
 *
 * All times are WALL CLOCK in the workspace's posting timezone (slots.ts is
 * the only converter), at the batch's "post at" time — 08:00 by default,
 * which is when the team's Socialmonials queue sends holiday posts.
 */

export const COUNTDOWN_STAGES = [
  { key: "announce", label: "Initial announcement", daysBefore: null as number | null },
  { key: "announce2", label: "Second announcement / reminder", daysBefore: null as number | null },
  { key: "2w", label: "2 weeks before", daysBefore: 14 },
  { key: "1w", label: "1 week before", daysBefore: 7 },
  { key: "3d", label: "3 days before", daysBefore: 3 },
  { key: "48h", label: "48 hours / 2 days before", daysBefore: 2 },
  { key: "1d", label: "1 day before", daysBefore: 1 },
  { key: "day", label: "Event day — happening today", daysBefore: 0 },
  { key: "after", label: "Post-event appreciation", daysBefore: -1 },
] as const;
export type StageKey = (typeof COUNTDOWN_STAGES)[number]["key"];

/** "08:00" → 480; invalid → 480. */
export function parsePostAt(v: string | null | undefined): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? "").trim());
  if (!m) return 8 * 60;
  const h = Math.min(23, parseInt(m[1], 10));
  const mm = Math.min(59, parseInt(m[2], 10));
  return h * 60 + mm;
}

/** A calendar day ("2026-11-19") at `minute` in `tz`. */
export function dayAt(day: string, minute: number, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  return zonedTimeToUtc(+m[1], +m[2], +m[3], Math.floor(minute / 60), minute % 60, tz);
}

/** The calendar day `n` days from `day` (negative = before). */
export function shiftDay(day: string, n: number): string {
  const [y, mo, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d) + n * 86_400_000);
  return t.toISOString().slice(0, 10);
}

/** Today's calendar day in `tz`. */
export function todayIn(tz: string): string {
  const z = zonedParts(new Date(), tz);
  return `${z.year}-${String(z.month).padStart(2, "0")}-${String(z.day).padStart(2, "0")}`;
}

/**
 * Proposed day for each chosen stage. The two announcements have no fixed
 * offset: the first goes tomorrow (or 4 weeks out, whichever is LATER — no
 * point announcing a big event two months early is the doc's intent; the
 * person moves it), the second halfway between the first and "2 weeks
 * before". Stages already in the past are returned with `past: true` so the
 * review page can say so instead of scheduling into yesterday.
 */
export function countdownDays(eventDay: string, stages: StageKey[], tz: string): Array<{ key: StageKey; label: string; day: string; past: boolean }> {
  const today = todayIn(tz);
  const tomorrow = shiftDay(today, 1);
  const fourWeeks = shiftDay(eventDay, -28);
  const first = fourWeeks > tomorrow ? fourWeeks : tomorrow;
  const twoWeeks = shiftDay(eventDay, -14);
  const gap = Math.round((Date.parse(twoWeeks) - Date.parse(first)) / 86_400_000);
  const second = gap > 2 ? shiftDay(first, Math.round(gap / 2)) : shiftDay(first, 1);
  return COUNTDOWN_STAGES.filter((s) => stages.includes(s.key)).map((s) => {
    const day = s.key === "announce" ? first : s.key === "announce2" ? second : shiftDay(eventDay, -(s.daysBefore ?? 0));
    return { key: s.key, label: s.label, day, past: day < today };
  });
}
