import type { TimelineItem } from "@/lib/engine-timeline";
import { formatDay } from "@/lib/zoned-dates";

/**
 * Automation's week of engine cycles (E-ENG-04): what each cycle did, quiet
 * and paused runs folded, and the gaps where it didn't check in at all.
 */

const SHOW = 120;

export function EngineTimeline({ items, cycles, timeZone, intervalMin }: { items: TimelineItem[]; cycles: number; timeZone: string; intervalMin: number }) {
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
  const t = (d: Date) => time.format(d);
  const active = items.filter((i) => i.kind === "cycle" && i.did.length).length;
  const failing = items.filter((i) => i.kind === "cycle" && i.failures.length).length;
  const gaps = items.filter((i) => i.kind === "gap").length;
  // Each item's day, with a header where the day changes (worked out before
  // rendering — render must not reassign anything).
  const shown = items.slice(0, SHOW).map((it, i, all) => {
    const dayOf = (x: TimelineItem) => formatDay(x.kind === "cycle" ? x.at : x.to, timeZone);
    const d = dayOf(it);
    return { it, header: i === 0 || dayOf(all[i - 1]) !== d ? d : null };
  });

  return (
    <details className="card mt-3" data-engine-timeline>
      <summary className="cursor-pointer select-none text-sm font-semibold">
        Engine activity — the last 7 days{" "}
        <span className="font-normal text-xs text-[var(--mute)]" data-timeline-summary>
          {cycles === 0 ? "· nothing recorded yet" : `· ${cycles} cycle${cycles === 1 ? "" : "s"}, ${active} did something${failing ? `, ${failing} with a failed step` : ""}${gaps ? `, ${gaps} gap${gaps === 1 ? "" : "s"} with no check-in` : ""}`}
        </span>
      </summary>
      {cycles === 0 ? (
        <p className="text-xs text-[var(--mute)] mt-2 mb-0">The timeline starts with the next cycle — every run is kept for a week, quiet ones too.</p>
      ) : (
        <ol className="list-none m-0 mt-2 p-0 flex flex-col text-xs" data-timeline>
          {shown.map(({ it, header }, i) => {
            return (
              <li key={i} data-timeline-item={it.kind}>
                {header && <div className="font-mono text-[10px] uppercase text-[var(--mute)] mt-2 mb-0.5">{header}</div>}
                <div className="flex gap-2 py-0.5 border-b border-[var(--line)]">
                  <span className="font-mono text-[var(--mute)] shrink-0 w-24">{it.kind === "cycle" ? t(it.at) : it.kind === "gap" ? `${t(it.from)}–${t(it.to)}` : it.count > 1 ? `${t(it.from)}–${t(it.to)}` : t(it.to)}</span>
                  {it.kind === "cycle" && (
                    <span className="flex-1 min-w-0">
                      {it.did.length > 0 && <span>{it.did.join(" · ")}</span>}
                      {it.budgetReached && <span className="text-[var(--mute)]">{it.did.length ? " · " : ""}today&apos;s AI allowance used up</span>}
                      {it.failures.map((f) => (
                        <span key={f.step} className="block" style={{ color: "var(--rose-on)" }}>{f.step} failed: {f.message}</span>
                      ))}
                    </span>
                  )}
                  {it.kind === "quiet" && <span className="text-[var(--mute)]">{it.count === 1 ? "a quiet run — nothing to do" : `${it.count} quiet runs — nothing to do`}</span>}
                  {it.kind === "paused" && <span className="text-[var(--mute)]">paused — {it.count === 1 ? "a run" : `${it.count} runs`} skipped by the global pause</span>}
                  {it.kind === "budget" && <span className="text-[var(--mute)]">{it.count === 1 ? "a run" : `${it.count} runs`} with today&apos;s AI allowance used up — nothing written</span>}
                  {it.kind === "gap" && <span style={{ color: "var(--amber-on)" }}>no check-in for {span(it.from, it.to)} — the sweep didn&apos;t run (it should every {intervalMin} min)</span>}
                </div>
              </li>
            );
          })}
          {items.length > SHOW && <li className="text-[var(--mute)] pt-1">{items.length - SHOW} older item{items.length - SHOW === 1 ? "" : "s"} not shown.</li>}
        </ol>
      )}
    </details>
  );
}

function span(from: Date, to: Date): string {
  const min = Math.round((to.getTime() - from.getTime()) / 60_000);
  if (min < 120) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
}
