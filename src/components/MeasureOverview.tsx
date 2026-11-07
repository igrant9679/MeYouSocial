import Link from "next/link";
import { change, type ChannelCard } from "@/lib/channel-overview";
import { GOAL_LABEL, GOAL_METRICS, PACE_LABEL, goalAmount, type GoalProgress, type PaceStatus } from "@/lib/goals";
import { saveGoalsAction } from "@/app/actions/goals";
import { SubmitButton } from "@/components/SubmitButton";
import { formatDay } from "@/lib/zoned-dates";

const fmt = (n: number | null, unit?: "count" | "percent") => (n === null ? "—" : unit === "percent" ? `${n}%` : n.toLocaleString("en-GB"));

const PACE_COLOR: Record<PaceStatus, { bg: string; fg: string }> = {
  met: { bg: "var(--green-soft)", fg: "var(--green-on)" },
  on_pace: { bg: "var(--green-soft)", fg: "var(--green-on)" },
  slightly_behind: { bg: "var(--amber-soft)", fg: "var(--amber-on)" },
  behind: { bg: "var(--rose-soft)", fg: "var(--rose-on)" },
  not_measured: { bg: "var(--panel)", fg: "var(--mute)" },
};

function PaceChip({ status }: { status: PaceStatus }) {
  const c = PACE_COLOR[status];
  return <span className="font-mono text-micro px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ background: c.bg, color: c.fg }} data-pace={status}>{PACE_LABEL[status]}</span>;
}

/** Measure's first screen (E-MEA-18): one card per channel over the range, each with its goal's pace. */
export function ChannelCards({ cards, goals, rangeLabel }: { cards: ChannelCard[]; goals: GoalProgress[]; rangeLabel: string }) {
  return (
    <section className="mb-4" data-channel-overview>
      <h2 className="text-sm font-semibold mb-2">Across channels <span className="font-normal text-xs text-[var(--mute)]">· {rangeLabel}, against the period before</span></h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {cards.map((c) => {
          const ch = change(c.headline.value, c.headline.previous);
          const own = goals.filter((g) => GOAL_LABEL[g.metric].channel === c.key);
          return (
            <div key={c.key} className="card !mb-0 flex flex-col gap-1.5 min-w-0" data-channel={c.key}>
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold flex-1 m-0">{c.title}</h3>
                <Link href={c.href} className="text-2xs text-[var(--mute)] hover:underline">Open →</Link>
              </div>
              <p className="m-0 flex items-baseline gap-2 flex-wrap">
                <span className="font-mono text-2xl font-bold tabular-nums" data-headline>{fmt(c.headline.value)}</span>
                <span className="text-xs text-[var(--mute)]">{c.headline.label}</span>
                {ch && <span className="font-mono text-2xs font-bold" style={{ color: ch.up ? "var(--green-on)" : "var(--rose-on)" }} data-change>{ch.text}</span>}
              </p>
              {c.more.length > 0 && (
                <ul className="m-0 p-0 list-none text-2xs text-[var(--mute)] flex flex-col gap-0.5">
                  {c.more.map((m) => {
                    const mc = change(m.value, m.previous, m.unit);
                    return (
                      <li key={m.label} className="flex gap-1.5">
                        <span className="font-mono tabular-nums text-[var(--ink)]">{fmt(m.value, m.unit)}</span> {m.label}
                        {mc && <span className="font-mono" style={{ color: mc.up ? "var(--green-on)" : "var(--rose-on)" }}>{mc.text}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
              {own.map((g) => (
                <p key={g.metric} className="m-0 text-2xs flex items-center gap-1.5 flex-wrap" data-card-goal={g.metric}>
                  <span className="text-[var(--mute)]">Goal: {goalAmount(g.metric, g.target)} a {g.period}</span>
                  <PaceChip status={g.status} />
                </p>
              ))}
              {c.note && <p className="m-0 mt-auto text-micro text-[var(--mute)]">{c.note}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Goals and pacing (E-MEA-05): this week's or month's progress against each target; admins set them. */
export function GoalsCard({ goals, admin, timeZone, names }: { goals: GoalProgress[]; admin: boolean; timeZone: string; names: Map<string, string> }) {
  const byMetric = new Map(goals.map((g) => [g.metric, g]));
  if (!goals.length && !admin) return null;
  return (
    <section className="card mb-4" id="goals" data-goals>
      <h2 className="text-sm font-semibold mb-0.5">Goals</h2>
      <p className="text-xs text-[var(--mute)] mt-0 mb-3">
        Progress this week or month in the posting timezone, against a straight line to the target. Search clicks are paced to
        the last day Search Console has reported (it runs about two days behind), so a lag isn&apos;t counted as falling behind.
      </p>
      {goals.length === 0 ? (
        <p className="text-xs text-[var(--mute)] mb-2">No goals yet. Set a target below and this shows whether the period is on pace.</p>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col gap-3 mb-3">
          {goals.map((g) => {
            const share = g.actual === null ? 0 : Math.min(1, g.actual / g.target);
            const mark = Math.min(1, g.expected / g.target);
            return (
              <li key={g.metric} data-goal={g.metric}>
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="font-semibold">{GOAL_LABEL[g.metric].name}</span>
                  <span className="font-mono tabular-nums">
                    {g.actual === null ? "—" : g.actual.toLocaleString("en-GB")} of {g.target.toLocaleString("en-GB")} this {g.period}
                  </span>
                  <PaceChip status={g.status} />
                </div>
                <div className="relative h-2 rounded-full mt-1.5 overflow-hidden" style={{ background: "var(--line)" }} aria-hidden>
                  <div className="h-full rounded-full" style={{ width: `${Math.round(share * 100)}%`, background: PACE_COLOR[g.status].fg }} />
                  <div className="absolute top-0 h-full w-0.5" style={{ left: `${Math.round(mark * 100)}%`, background: "var(--ink)" }} title="Where a straight line to the target is now" />
                </div>
                <p className="text-micro text-[var(--mute)] mt-1 mb-0">
                  {g.status === "not_measured"
                    ? `Nothing measured since ${formatDay(g.start, timeZone)} yet.`
                    : <>
                        Expected {g.expected.toLocaleString("en-GB")} by {formatDay(g.metric === "search_clicks" ? new Date(g.measuredTo.getTime() - 1) : g.measuredTo, timeZone)}
                        {g.projected !== null && g.status !== "met" ? ` · on this line, about ${g.projected.toLocaleString("en-GB")} by ${formatDay(new Date(g.end.getTime() - 1), timeZone)}` : ""}
                      </>}
                  {g.updatedById && names.get(g.updatedById) ? ` · set by ${names.get(g.updatedById)}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {admin && (
        <details open={goals.length === 0} data-goal-form>
          <summary className="cursor-pointer select-none text-xs font-semibold">Set goals</summary>
          <form action={saveGoalsAction} className="mt-2 flex flex-col gap-2">
            {GOAL_METRICS.map((m) => {
              const g = byMetric.get(m);
              return (
                <label key={m} className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="w-36 shrink-0">{GOAL_LABEL[m].name}</span>
                  <input
                    name={`target_${m}`}
                    inputMode="numeric"
                    defaultValue={g?.target ?? ""}
                    placeholder="no goal"
                    className="w-28 border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs font-mono"
                    aria-label={`${GOAL_LABEL[m].name} target`}
                  />
                  <select name={`period_${m}`} defaultValue={g?.period ?? "month"} className="border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs" aria-label={`${GOAL_LABEL[m].name} period`}>
                    <option value="week">a week</option>
                    <option value="month">a month</option>
                  </select>
                </label>
              );
            })}
            <p className="text-micro text-[var(--mute)] m-0">Leave a field blank to remove that goal.</p>
            <div><SubmitButton className="btn" pendingText="Saving…">Save goals</SubmitButton></div>
          </form>
        </details>
      )}
    </section>
  );
}
