import type { ReactNode } from "react";
import type { HistoryRow } from "@/lib/idea-history";
import { formatZonedMoment } from "@/lib/zoned-dates";

// The read-only half of an idea's page (E-IDE-16): what it is and where it came
// from, why it ranks where it does, and what has happened to it. Server component.

export function IdeaFacts({ facts }: { facts: Array<{ label: string; value: ReactNode }> }) {
  return (
    <div className="card mb-4" data-idea-facts>
      <h2 className="font-mono font-bold text-sm m-0 mb-2">About this idea</h2>
      <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-xs">
        {facts.map((f) => (
          <div key={f.label} className="contents" data-idea-fact={f.label}>
            <dt className="text-[var(--mute)]">{f.label}</dt>
            <dd className="m-0 min-w-0 break-words">{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The priority score and the lines that make it up, as the scoring wrote them. */
export function IdeaPriority({ score, reasons }: { score: number | null; reasons: string | null }) {
  if (score == null) return null;
  const lines = (reasons ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  return (
    <div className="card mb-4" data-idea-priority>
      <h2 className="font-mono font-bold text-sm m-0 mb-1">Priority <span className="font-normal text-[var(--mute)]">{score}</span></h2>
      {lines.length ? (
        <ul className="m-0 pl-4 text-xs flex flex-col gap-0.5">
          {lines.map((l, i) => <li key={i} className="font-mono" data-priority-line>{l}</li>)}
        </ul>
      ) : (
        <p className="m-0 text-xs text-[var(--mute)]">No breakdown was stored with this score.</p>
      )}
    </div>
  );
}

export function IdeaHistory({ rows, createdAt, created, timeZone }: { rows: HistoryRow[]; createdAt: Date; created: string; timeZone: string }) {
  return (
    <div className="card mb-4" data-idea-history>
      <h2 className="font-mono font-bold text-sm m-0 mb-2">History</h2>
      <ol className="m-0 pl-0 list-none flex flex-col gap-1 text-xs">
        <li data-history-row><span className="font-mono text-micro text-[var(--mute)] mr-2">{formatZonedMoment(createdAt, timeZone)}</span>Created — {created}</li>
        {rows.map((r, i) => (
          <li key={i} data-history-row>
            <span className="font-mono text-micro text-[var(--mute)] mr-2">{formatZonedMoment(r.at, timeZone)}</span>
            {r.label} <span className="text-[var(--mute)]">· {r.who}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
