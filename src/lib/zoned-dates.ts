import { zonedParts, zonedTimeToUtc } from "@/lib/social/slots";

// Day and month boundaries in the workspace's POSTING timezone (audit MEA-20):
// "this month", "today" and every printed time used the server's UTC, so the
// same autopilot cycle read 00:50 in the Inbox and 04:50 on Settings. One set
// of helpers, and the zone is named wherever a time is shown.

export function zonedDayStart(at: Date, timeZone: string): Date {
  const p = zonedParts(at, timeZone);
  return zonedTimeToUtc(p.year, p.month, p.day, 0, 0, timeZone);
}

/** The 1st of the month `monthsBack` months before `at`'s, at midnight in `timeZone`. */
export function zonedMonthStart(at: Date, timeZone: string, monthsBack = 0): Date {
  const p = zonedParts(at, timeZone);
  let y = p.year;
  let m = p.month - monthsBack;
  while (m < 1) { m += 12; y--; }
  return zonedTimeToUtc(y, m, 1, 0, 0, timeZone);
}

/** A short, readable zone name for labels: "EDT", "GMT+1", or the IANA id. */
export function zoneLabel(timeZone: string, at = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "short" }).formatToParts(at).find((x) => x.type === "timeZoneName")?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

/** "28 Oct, 04:50 EDT" — a moment, in the posting zone, with the zone said. */
export function formatZonedMoment(at: Date, timeZone: string): string {
  return `${at.toLocaleString("en-GB", { timeZone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} ${zoneLabel(timeZone, at)}`;
}
