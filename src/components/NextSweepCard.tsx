import Link from "next/link";
import type { SweepPreview } from "@/lib/sweep-plan";
import { formatInZone } from "@/lib/social/slots";

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const unattended = (mode: string) => mode === "assisted" || mode === "auto";
const s = (n: number) => (n === 1 ? "" : "s");

/**
 * "Next sweep will…" (E-ENG-05) — the drafting, publishing and queueing the
 * next autopilot cycle does, from the selectors the cycle itself uses
 * (lib/sweep-plan.ts). A server component; nothing here acts.
 */
export function NextSweepCard({ preview, timeZone, nextAt, autopilotOff }: {
  preview: SweepPreview;
  timeZone: string;
  /** When the next sweep is due, from the last check-in plus the interval; null when unknown. */
  nextAt: { at: Date; due: boolean } | null;
  autopilotOff: boolean;
}) {
  const { drafting, publishing: pub, queue } = preview;
  const stopped = autopilotOff ? "the autopilot is off on this server (AUTOPILOT=off)" : preview.paused ? "the global pause is on" : null;
  return (
    <details className="card mt-3" data-next-sweep open>
      <summary className="text-sm font-semibold cursor-pointer">
        Next sweep will…
        {!stopped && nextAt && (
          <span className="font-normal text-xs text-[var(--mute)]"> {nextAt.due ? "(due now)" : `(around ${formatInZone(nextAt.at, timeZone)})`}</span>
        )}
      </summary>
      {stopped ? (
        <p className="text-xs text-[var(--mute)] mt-2 mb-0" data-sweep-stopped>Do nothing — {stopped}.</p>
      ) : (
        <div className="flex flex-col gap-3 mt-2 text-xs">
          <section data-sweep-draft>
            <div className="font-semibold mb-0.5">Draft</div>
            {!unattended(preview.modes.drafting) ? (
              <p className="m-0 text-[var(--mute)]">Nothing — drafting is {preview.modes.drafting}, so no idea drafts by itself.</p>
            ) : preview.overBudget || !drafting ? (
              <p className="m-0" style={{ color: "var(--amber-on)" }}>Nothing — today&apos;s AI allowance is used up.</p>
            ) : drafting.allowance === 0 ? (
              <p className="m-0 text-[var(--mute)]">Nothing — {drafting.draftedThisWeek} of {drafting.weekly} article{s(drafting.weekly ?? 0)} this week are drafted already.</p>
            ) : drafting.ideas.length === 0 ? (
              <p className="m-0 text-[var(--mute)]">Nothing — no approved idea is waiting.</p>
            ) : (
              <ul className="m-0 pl-4">
                {drafting.ideas.map((i) => <li key={i.id} data-sweep-idea={i.id}>{i.title}</li>)}
              </ul>
            )}
            {drafting && drafting.waitingForPerson > 0 && (
              <p className="m-0 mt-0.5 text-[var(--mute)]">
                {drafting.waitingForPerson} approved idea{s(drafting.waitingForPerson)} change{drafting.waitingForPerson === 1 ? "s" : ""} the live site (retire, merge, or a refresh with nothing here to revise) and wait{drafting.waitingForPerson === 1 ? "s" : ""} for a person.
              </p>
            )}
          </section>

          <section data-sweep-publish>
            <div className="font-semibold mb-0.5">Publish</div>
            {!unattended(preview.modes.publishing) ? (
              <p className="m-0 text-[var(--mute)]">Nothing — publishing is {preview.modes.publishing}, so nothing publishes by itself.</p>
            ) : !pub.hasSite ? (
              <p className="m-0 text-[var(--mute)]">Nothing — no site is connected, so articles at final approval go out by hand.</p>
            ) : (
              <>
                {pub.ready.length > 0 && (
                  <ul className="m-0 pl-4">
                    {pub.ready.map((p) => (
                      <li key={p.id} data-sweep-publish-ready={p.id}>
                        <Link href={`/blog/${p.id}`} className="underline">{p.title}</Link>
                        <span className="text-[var(--mute)]">{p.scheduledAt ? ` — its time (${formatInZone(p.scheduledAt, timeZone)}) has come` : " — unscheduled, and today it may go"}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {pub.held.length > 0 && (
                  <ul className="m-0 pl-4" style={{ color: "var(--rose-on)" }}>
                    {pub.held.map((p) => (
                      <li key={p.id} data-sweep-publish-held={p.id}>
                        Held: <Link href={`/blog/${p.id}?tab=review`} className="underline">{p.title}</Link> — {p.failing.join("; ")}
                      </li>
                    ))}
                  </ul>
                )}
                {pub.ready.length === 0 && pub.held.length === 0 && (
                  <p className="m-0 text-[var(--mute)]">Nothing — {pub.autoToday ? "no article at final approval is waiting." : "no article at final approval has a time that has come."}</p>
                )}
                {preview.modes.publishing === "auto" && pub.publishDay != null && !pub.autoToday && (
                  <p className="m-0 mt-0.5 text-[var(--mute)]">{DAY[pub.publishDay]} is the publish day; today only an article with a time a person set goes out.</p>
                )}
              </>
            )}
          </section>

          <section data-sweep-queue>
            <div className="font-semibold mb-0.5">Queue social drafts</div>
            {!preview.autonomous ? (
              <p className="m-0 text-[var(--mute)]">Nothing — drafts get a slot by themselves only under full autonomy.</p>
            ) : (
              <>
                {queue.picks.length > 0 ? (
                  <ul className="m-0 pl-4">
                    {queue.picks.map((q) => (
                      <li key={q.id} data-sweep-queue-pick={q.id}>
                        <span className="font-mono">{formatInZone(q.at, timeZone)}</span> — {q.text.length > 70 ? `${q.text.slice(0, 70)}…` : q.text}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="m-0 text-[var(--mute)]">Nothing — {queue.considered === 0 ? "no unscheduled draft is waiting." : queue.full ? "the calendar has no free slot." : "every waiting draft would be rejected by a network."}</p>
                )}
                {queue.refused > 0 && (
                  <p className="m-0 mt-0.5 text-[var(--mute)]" data-sweep-queue-refused>{queue.refused} draft{s(queue.refused)} wait{queue.refused === 1 ? "s" : ""} — a network would reject {queue.refused === 1 ? "it" : "them"} as written.</p>
                )}
                {queue.full && queue.picks.length > 0 && (
                  <p className="m-0 mt-0.5 text-[var(--mute)]">Then the calendar is full; the rest wait for a slot.</p>
                )}
              </>
            )}
          </section>
          <p className="m-0 text-[var(--mute)]">Slots shown aren&apos;t held — queueing something yourself first can take one.</p>
        </div>
      )}
    </details>
  );
}
