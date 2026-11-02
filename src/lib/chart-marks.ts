/**
 * Chart annotations (E-MEA-04), the pure half: events placed onto a chart's
 * points. A curve that dips or jumps says nothing about why; a marker for the
 * article published that week, the autonomy switch flipped or a person's note
 * ("Google core update") does. The reader is `lib/chart-annotations.ts`; the
 * drawing is AreaChart's `marks` and `ChartMarkList`.
 *
 * Kept free of the database so the placement rules can be checked alone.
 */

export type MarkKind = "publish" | "autonomy" | "note" | "social";

export type ChartEvent = {
  at: Date;
  kind: MarkKind;
  text: string;
  href?: string;
  /** Who did it — a person's name, "the assistant", or absent for the engine's own. */
  by?: string;
  /** A chart note's id, so the list can offer its delete. */
  noteId?: string;
};

/** A point's span: events at or after `from` and before `to` belong to it. */
export type ChartBucket = { from: Date; to: Date };

export type PlacedMark = {
  /** The point the events fall in. */
  index: number;
  kinds: MarkKind[];
  /** Tooltip lines, social sends folded into one when there are several. */
  lines: string[];
  events: ChartEvent[];
};

/** Drawing order and colours; social sends are a tick on the baseline, the rest a dashed line. */
export const MARK_KINDS: MarkKind[] = ["publish", "autonomy", "note", "social"];
export const MARK_COLOR: Record<MarkKind, string> = { publish: "var(--green)", autonomy: "var(--amber)", note: "var(--ink)", social: "var(--violet)" };
export const MARK_LABEL: Record<MarkKind, string> = { publish: "Published", autonomy: "Automation", note: "Note", social: "Social sends" };

/** Lines in a tooltip before "+N more"; SVG text doesn't wrap, so each is cut too. */
export const MAX_TIP_LINES = 4;
export const TIP_LINE_CHARS = 52;

const cut = (s: string, n = TIP_LINE_CHARS) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Buckets for a chart whose points are readings at moments (a day each, not
 * always contiguous): each runs to the next reading, the last for `lastSpanMs`.
 */
export function bucketsFromMoments(moments: Date[], lastSpanMs: number): ChartBucket[] {
  return moments.map((m, i) => ({ from: m, to: moments[i + 1] ?? new Date(m.getTime() + lastSpanMs) }));
}

/**
 * Each event into the bucket that holds it; events outside every bucket are
 * left off (the chart doesn't reach them). One mark per bucket that has any.
 */
export function placeEvents(events: ChartEvent[], buckets: ChartBucket[]): PlacedMark[] {
  const per = new Map<number, ChartEvent[]>();
  for (const e of events) {
    const t = e.at.getTime();
    const i = buckets.findIndex((b) => t >= b.from.getTime() && t < b.to.getTime());
    if (i < 0) continue;
    per.set(i, [...(per.get(i) ?? []), e]);
  }
  return [...per.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, list]) => {
      const sorted = [...list].sort((a, b) => MARK_KINDS.indexOf(a.kind) - MARK_KINDS.indexOf(b.kind) || a.at.getTime() - b.at.getTime());
      const social = sorted.filter((e) => e.kind === "social");
      const rest = sorted.filter((e) => e.kind !== "social");
      const all = [
        ...rest.map((e) => e.text),
        ...(social.length === 1 ? [social[0].text] : social.length > 1 ? [`${social.length} social posts sent`] : []),
      ];
      const lines = all.length > MAX_TIP_LINES
        ? [...all.slice(0, MAX_TIP_LINES - 1), `+${all.length - (MAX_TIP_LINES - 1)} more — listed under the chart`]
        : all;
      return {
        index,
        kinds: MARK_KINDS.filter((k) => sorted.some((e) => e.kind === k)),
        lines: lines.map((l) => cut(l)),
        events: sorted,
      };
    });
}
