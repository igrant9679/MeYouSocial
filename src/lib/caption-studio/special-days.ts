/**
 * The special-days list — the doc's steps 1–4 (gather, verify, organise,
 * client picks), as data the app keeps per workspace instead of an Excel
 * sheet rebuilt every month.
 *
 * ⚠ Dates are never guessed. A pasted line without a readable month AND day
 * is reported back, not filled in; a day copied from last year is marked
 * unverified, because observances move (Thanksgiving, Mother's Day, Easter,
 * Giving Tuesday…) — the doc's own "check whether the dates have changed".
 */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

export function isValidDay(day: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export type ParsedDay = { name: string; day: string; note: string | null };

/**
 * One line → a special day, or null. Accepts, with the year from `year` when
 * the line has none:
 *   "Nov 19 — Women's Entrepreneurship Day"      "November 19: …"
 *   "19 November - …"   "11/19 …"   "2026-11-19 …"
 * A trailing "(note: …)" or " | …" becomes the note.
 */
export function parseDayLine(line: string, year: number): ParsedDay | null {
  // Strip list furniture only: "- ", "* ", "• ", and "1. " / "1) " — never a
  // bare leading number, which is a date ("31 October", "11/11").
  let rest = line.trim().replace(/^(?:[-*•]+\s+|\d{1,2}[.)]\s+)/, "");
  if (!rest) return null;
  let y = year;
  let month = 0;
  let date = 0;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(rest))) {
    y = +m[1]; month = +m[2]; date = +m[3]; rest = rest.slice(m[0].length);
  } else if ((m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(rest))) {
    month = +m[1]; date = +m[2]; if (m[3]) y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; rest = rest.slice(m[0].length);
  } else if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b,?(?:\s+(\d{4}))?/.exec(rest)) && MONTHS[m[1].toLowerCase()]) {
    month = MONTHS[m[1].toLowerCase()]; date = +m[2]; if (m[3]) y = +m[3]; rest = rest.slice(m[0].length);
  } else if ((m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\b,?(?:\s+(\d{4}))?/.exec(rest)) && MONTHS[m[2].toLowerCase()]) {
    month = MONTHS[m[2].toLowerCase()]; date = +m[1]; if (m[3]) y = +m[3]; rest = rest.slice(m[0].length);
  } else {
    return null;
  }
  const day = `${y}-${pad(month)}-${pad(date)}`;
  if (!isValidDay(day)) return null;
  let name = rest.replace(/^[\s:–—-]+/, "").trim();
  let note: string | null = null;
  const noteMatch = /\s*(?:\(note:\s*([^)]*)\)|\|\s*(.+))$/i.exec(name);
  if (noteMatch) {
    note = (noteMatch[1] ?? noteMatch[2] ?? "").trim() || null;
    name = name.slice(0, noteMatch.index).trim();
  }
  if (!name) return null;
  return { name: name.slice(0, 120), day, note: note?.slice(0, 500) ?? null };
}

export function parsePastedDays(text: string, year: number): { days: ParsedDay[]; unreadable: string[] } {
  const days: ParsedDay[] = [];
  const unreadable: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const d = parseDayLine(line, year);
    if (d) days.push(d);
    else unreadable.push(line.slice(0, 80));
  }
  return { days, unreadable };
}

/** Same month and day one year later; Feb 29 has no twin, so it is reported. */
export function nextYearDay(day: string): string | null {
  const [y, m, d] = day.split("-").map(Number);
  const next = `${y + 1}-${pad(m)}-${pad(d)}`;
  return isValidDay(next) ? next : null;
}

/** "2026-11" → its first and last calendar days. */
export function monthRange(month: string): { from: string; to: string; year: number; label: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m || +m[2] < 1 || +m[2] > 12) return null;
  const y = +m[1];
  const mo = +m[2];
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const label = new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return { from: `${y}-${pad(mo)}-01`, to: `${y}-${pad(mo)}-${pad(last)}`, year: y, label };
}

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
}

/** "2026-11-19" → "Thu 19 Nov" for lists. */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
