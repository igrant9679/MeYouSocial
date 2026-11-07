import Link from "next/link";
import { DeleteButton } from "@/components/DeleteButton";
import { SubmitButton } from "@/components/SubmitButton";
import { addChartNoteAction } from "@/app/actions/chart-notes";
import { MARK_COLOR, MARK_KINDS, MARK_LABEL, type ChartEvent, type MarkKind, type PlacedMark } from "@/lib/chart-marks";
import { NOTE_MAX } from "@/lib/chart-annotations";
import { zonedParts } from "@/lib/social/slots";
import { formatShortDay } from "@/lib/zoned-dates";
import { requestNow } from "@/lib/request-time";

/** The glyph a kind has on the chart, as a legend swatch. */
function Glyph({ kind }: { kind: MarkKind }) {
  const c = MARK_COLOR[kind];
  return (
    <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true" className="inline-block shrink-0">
      {kind === "publish" ? <circle cx="5" cy="5" r="3.6" fill={c} />
        : kind === "autonomy" ? <rect x="2" y="2" width="6" height="6" transform="rotate(45 5 5)" fill={c} />
        : kind === "note" ? <rect x="1.5" y="1.5" width="7" height="7" rx="1" fill={c} />
        : <line x1="5" y1="1" x2="5" y2="9" stroke={c} strokeWidth="2.5" strokeLinecap="round" />}
    </svg>
  );
}

type Row = { at: Date; kind: MarkKind; text: string; href?: string; by?: string; noteId?: string };

/** One row per event, a point's several social sends folded into one. */
function rowsOf(marks: PlacedMark[]): Row[] {
  return marks.flatMap((m) => {
    const social = m.events.filter((e) => e.kind === "social");
    const rest: Row[] = m.events.filter((e) => e.kind !== "social");
    return social.length > 1
      ? [...rest, { at: social[0].at, kind: "social" as const, text: `${social.length} social posts sent`, href: "/social/sent" }]
      : [...rest, ...social];
  }).sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * The chart's events as text (E-MEA-04): the tooltip needs a pointer, so on a
 * phone or a screen reader this is the annotation. Open when it's short.
 */
export function ChartMarkList({ marks, timeZone, canDelete, returnTo }: { marks: PlacedMark[]; timeZone: string; canDelete: boolean; returnTo: string }) {
  const rows = rowsOf(marks);
  if (!rows.length) return null;
  const kinds = MARK_KINDS.filter((k) => rows.some((r) => r.kind === k));
  return (
    <details className="mt-2 text-2xs" open={rows.length <= 6} data-chart-marks>
      <summary className="cursor-pointer text-[var(--mute)] select-none">
        <span className="font-semibold">{rows.length} event{rows.length === 1 ? "" : "s"} on this chart</span>
        {kinds.map((k) => (
          <span key={k} className="inline-flex items-center gap-1 ml-2.5"><Glyph kind={k} />{MARK_LABEL[k]}</span>
        ))}
      </summary>
      <ul className="m-0 mt-1.5 p-0 list-none flex flex-col gap-1">
        {rows.map((r, i) => (
          <li key={i} className="flex items-start gap-2" data-chart-event={r.kind}>
            <span className="font-mono tabular-nums text-[var(--mute)] w-12 shrink-0">{formatShortDay(r.at, timeZone)}</span>
            <span className="mt-[3px]"><Glyph kind={r.kind} /></span>
            <span className="min-w-0 flex-1">
              {r.href ? <Link href={r.href} className="hover:underline">{r.text}</Link> : r.text}
              {r.by && <span className="text-[var(--mute)]"> · {r.by}</span>}
            </span>
            {r.noteId && canDelete && (
              <DeleteButton kind="chartNote" id={r.noteId} name={`the note “${r.text.length > 40 ? `${r.text.slice(0, 39)}…` : r.text}”`} returnTo={returnTo} iconOnly />
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Editors add a note for a day; it shows on every chart that spans it. */
export function ChartNoteForm({ timeZone }: { timeZone: string }) {
  const t = zonedParts(new Date(requestNow()), timeZone);
  const today = `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
  return (
    <form action={addChartNoteAction} className="flex flex-wrap items-end gap-2 mt-3 pt-3 border-t border-[var(--line)]" id="chart-notes" data-chart-note-form>
      <label className="flex flex-col gap-0.5 text-2xs text-[var(--mute)]">
        Day
        <input type="date" name="day" defaultValue={today} max={today} required className="border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs bg-[var(--bg)] text-[var(--ink)]" />
      </label>
      <label className="flex flex-col gap-0.5 text-2xs text-[var(--mute)] flex-1 min-w-48">
        Note — what happened that day
        <input type="text" name="text" maxLength={NOTE_MAX} required placeholder="Google core update · site redesign · press mention" className="border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs bg-[var(--bg)] text-[var(--ink)]" />
      </label>
      <SubmitButton className="btn text-xs" pendingText="Adding…">Add note</SubmitButton>
    </form>
  );
}

export type { ChartEvent };
