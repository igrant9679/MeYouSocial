import { CalendarRange } from "lucide-react";
import { setMeasureRangeAction } from "@/app/actions/measure";
import { MEASURE_PRESETS, type MeasureRange } from "@/lib/measure-range";

/**
 * The one date-range picker for Measure (E-MEA-01): presets, two days of your
 * own, and "compare to the previous period". A plain form — it works without
 * JavaScript — posting to setMeasureRangeAction, which writes the URL and the
 * cookie the other Measure tabs read. `note` says what on this page doesn't
 * follow the range (a fixed window, a source that only reports some lengths).
 */
export function RangePicker({ range, path, note }: { range: MeasureRange; path: string; note?: string }) {
  const chip = "font-mono text-[11px] px-2 py-0.5 rounded-full border";
  return (
    <form action={setMeasureRangeAction} className="card mb-4 !py-2 flex flex-wrap items-center gap-2 text-xs" aria-label="Date range">
      <input type="hidden" name="back" value={path} />
      <input type="hidden" name="current" value={range.preset ? String(range.preset) : "custom"} />
      {/* The days as shown: Apply with them untouched keeps a preset a preset. */}
      <input type="hidden" name="shownFrom" value={range.from} />
      <input type="hidden" name="shownTo" value={range.to} />
      <CalendarRange className="w-4 h-4 shrink-0" style={{ color: "var(--blue-on)" }} />
      <span className="text-[var(--mute)]">Range</span>
      {MEASURE_PRESETS.map((d) => {
        const on = range.preset === d;
        return (
          <button key={d} name="range" value={String(d)} aria-pressed={on} className={chip}
            style={on ? { background: "var(--ink)", color: "var(--panel)", borderColor: "var(--ink)" } : { background: "var(--panel)", color: "var(--mute)", borderColor: "var(--line)" }}>
            {d === 365 ? "12 months" : `${d} days`}
          </button>
        );
      })}
      <span className="inline-flex items-center gap-1">
        <input type="date" name="from" defaultValue={range.from} aria-label="From (first day)" className="text-xs border border-[var(--line-2)] rounded-lg px-1.5 py-0.5" />
        <span className="text-[var(--mute)]">to</span>
        <input type="date" name="to" defaultValue={range.to} aria-label="To (last day)" className="text-xs border border-[var(--line-2)] rounded-lg px-1.5 py-0.5" />
      </span>
      <label className="inline-flex items-center gap-1.5 cursor-pointer">
        <input type="checkbox" name="compare" value="1" defaultChecked={range.compare} />
        Compare to the previous period
      </label>
      <button name="range" value="apply" className="btn sm">Apply</button>
      <span className="text-[var(--mute)] basis-full sm:basis-auto">
        Showing the <b className="text-[var(--ink)]">{range.label}</b>{range.compare ? `, against the ${range.previous.label}` : ""}.
        {note ? ` ${note}` : ""}
      </span>
    </form>
  );
}
