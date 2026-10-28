import { cookies } from "next/headers";
import type { MetricsRange } from "@/lib/metrics";
import { formatDay, zonedDayStart } from "@/lib/zoned-dates";
import { zonedParts, zonedTimeToUtc } from "@/lib/social/slots";

/**
 * One date range for all of Measure (E-MEA-01). Every tab used its own
 * window — Insights 90 days, Topics 90, Social performance 90, the YouTube
 * audit its own picker — so two tabs never described the same period.
 *
 * The range lives in the URL (`range=7|28|90|365`, or `range=custom&from=&to=`,
 * plus `compare=1`) so a view is a link; the picker also writes it to a cookie
 * (actions/measure.ts), so moving between Measure tabs keeps it without every
 * tab link carrying it. URL first, then the cookie, then 90 days.
 *
 * Custom days are whole days in the POSTING timezone, both ends included.
 */

export const MEASURE_PRESETS = [7, 28, 90, 365] as const;
export const DEFAULT_MEASURE_DAYS = 90;
export const MEASURE_RANGE_COOKIE = "mys.measure_range";
export const MAX_CUSTOM_DAYS = 730;
const DAY = 86_400_000;

export type RangeInput = { range?: string; from?: string; to?: string; compare?: string };

export type MeasureRange = MetricsRange & {
  /** Its length in whole days. */
  days: number;
  /** 7 | 28 | 90 | 365, or null for custom dates. */
  preset: number | null;
  /** YYYY-MM-DD in the posting zone — what the custom inputs show. */
  from: string;
  to: string;
  compare: boolean;
  /** The same length immediately before — for "compare to previous period". */
  previous: MetricsRange;
  /** Why a custom range was set aside, when it was. */
  problem: string | null;
};

const ymd = (at: Date, tz: string) => {
  const z = zonedParts(at, tz);
  return `${z.year}-${String(z.month).padStart(2, "0")}-${String(z.day).padStart(2, "0")}`;
};

function parseDay(s: string | undefined): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s ?? "").trim());
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDate() === d ? { y, m: mo, d } : null;
}

/** The query string a range is written as — the cookie holds the same. */
export function rangeQuery(r: Pick<MeasureRange, "preset" | "from" | "to" | "compare">): string {
  const q = new URLSearchParams();
  if (r.preset) q.set("range", String(r.preset));
  else { q.set("range", "custom"); q.set("from", r.from); q.set("to", r.to); }
  if (r.compare) q.set("compare", "1");
  return q.toString();
}

export function resolveRange(input: RangeInput, tz: string, now = new Date()): MeasureRange {
  const compare = input.compare === "1";
  let problem: string | null = null;
  if (input.range === "custom") {
    const f = parseDay(input.from);
    const t = parseDay(input.to);
    if (!f || !t) problem = "Pick both days for a custom range.";
    else {
      const since = zonedTimeToUtc(f.y, f.m, f.d, 0, 0, tz);
      const until = zonedTimeToUtc(t.y, t.m, t.d + 1, 0, 0, tz);
      const days = Math.round((until.getTime() - since.getTime()) / DAY);
      if (until <= since) problem = "The range ends before it starts.";
      else if (days > MAX_CUSTOM_DAYS) problem = `A custom range can cover at most ${MAX_CUSTOM_DAYS} days.`;
      else if (since > now) problem = "That range hasn't started yet.";
      else {
        const label = `period ${formatDay(since, tz)} – ${formatDay(new Date(until.getTime() - DAY / 2), tz)}`;
        return {
          since, until, label, days, preset: null, from: input.from!, to: input.to!, compare, problem: null,
          previous: { since: new Date(since.getTime() - days * DAY), until: since, label: `previous ${days} days` },
        };
      }
    }
  }
  const asked = Number(input.range);
  const days = (MEASURE_PRESETS as readonly number[]).includes(asked) ? asked : DEFAULT_MEASURE_DAYS;
  const since = new Date(now.getTime() - days * DAY);
  return {
    since, label: `last ${days} days`, days, preset: days,
    from: ymd(zonedDayStart(since, tz), tz), to: ymd(now, tz), compare, problem,
    previous: { since: new Date(since.getTime() - days * DAY), until: since, label: `previous ${days} days` },
  };
}

/** The range a Measure page shows: its URL's, else the one the picker saved, else 90 days. */
export async function measureRange(sp: RangeInput, tz: string): Promise<MeasureRange> {
  const fromUrl = sp.range || sp.from || sp.to || sp.compare;
  if (fromUrl) return resolveRange(sp, tz);
  const saved = (await cookies()).get(MEASURE_RANGE_COOKIE)?.value;
  if (!saved) return resolveRange({}, tz);
  const q = new URLSearchParams(saved);
  return resolveRange({ range: q.get("range") ?? undefined, from: q.get("from") ?? undefined, to: q.get("to") ?? undefined, compare: q.get("compare") ?? undefined }, tz);
}
