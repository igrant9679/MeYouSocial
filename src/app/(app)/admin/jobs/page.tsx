import Link from "next/link";
import { Cog } from "lucide-react";
import { requireRole } from "@/lib/acl";
import { SubmitButton } from "@/components/SubmitButton";
import { retryJobAction, cancelJobAction } from "@/app/actions/jobs-admin";
import { asJobFilter, jobsOverview, JOB_FILTERS } from "@/lib/jobs/admin";
import { displayTimeZone } from "@/lib/display-zone";
import { formatZonedMoment } from "@/lib/zoned-dates";

// Settings → Jobs (E-ENG-17): this workspace's background queue. Admins only
// (admin/layout.tsx). Retry a job that gave up; cancel one still waiting.

const FILTER_LABEL: Record<(typeof JOB_FILTERS)[number], string> = {
  attention: "Needs a look", queued: "Waiting", running: "Running", failed: "Failed (7 days)", done: "Done (24 h)",
};
const STATE_STYLE: Record<string, { bg: string; fg: string }> = {
  queued: { bg: "var(--blue-soft)", fg: "var(--blue-on)" },
  running: { bg: "var(--violet-soft)", fg: "var(--violet-on)" },
  failed: { bg: "var(--rose-soft)", fg: "var(--rose-on)" },
  done: { bg: "var(--green-soft)", fg: "var(--green-on)" },
};

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { workspace } = await requireRole("ADMIN");
  const filter = asJobFilter((await searchParams).state);
  const [{ counts, rows }, tz] = await Promise.all([
    jobsOverview(workspace.id, filter),
    displayTimeZone(workspace.id), // E-SHL-09: the reader's zone — times shown only
  ]);
  const count = (f: (typeof JOB_FILTERS)[number]) => (f === "attention" ? null : counts[f]);

  return (
    <div className="w-full">
      <div className="flex items-center gap-3 mb-4">
        <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: "var(--slate-soft, var(--zebra))", color: "var(--slate)" }}>
          <Cog className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-lg leading-tight">Background jobs</h1>
          <p className="text-xs text-[var(--mute)]">Work {workspace.name} handed to the queue — drafts finishing, images, channel training. A failed job retries on its own, waiting longer each time; after its last try it stops here and admins are told.</p>
        </div>
      </div>

      <nav className="flex flex-wrap gap-1 mb-4" data-job-filters>
        {JOB_FILTERS.map((f) => (
          <Link key={f} href={`/admin/jobs?state=${f}`}
            className={"text-xs font-mono px-2.5 py-1 rounded-md border " + (filter === f ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--line-2)] text-[var(--mute)]")}>
            {FILTER_LABEL[f]}{count(f) != null ? ` (${count(f)})` : ""}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="card text-center py-10 text-sm text-[var(--mute)]" data-jobs-empty>{filter === "attention" ? "Nothing needs a look — no job is running, retrying or failed this week." : "No jobs here."}</div>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col gap-2">
          {rows.map((j) => (
            <li key={j.id} className="card !py-2.5" data-job={j.id} data-job-state={j.state}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-micro uppercase px-1.5 py-0.5 rounded-full" style={{ background: STATE_STYLE[j.state]?.bg, color: STATE_STYLE[j.state]?.fg }}>{j.state === "queued" && j.attempts > 0 ? "retrying" : j.state}</span>
                <span className="font-semibold text-sm">{j.label}</span>
                <span className="font-mono text-micro text-[var(--mute)]" title="Attempts so far, of the most it gets">try {j.attempts}/{j.maxAttempts}</span>
                <span className="flex-1" />
                <span className="text-2xs text-[var(--mute)]">
                  {j.finishedAt ? `ended ${formatZonedMoment(j.finishedAt, tz)}` : j.waiting && j.runAfter ? `next try ${formatZonedMoment(j.runAfter, tz)}` : `queued ${formatZonedMoment(j.createdAt, tz)}`}
                </span>
                {j.state === "failed" && (
                  <form action={retryJobAction}>
                    <input type="hidden" name="id" value={j.id} />
                    <SubmitButton className="btn sm" pendingText="Queuing…">Retry</SubmitButton>
                  </form>
                )}
                {j.state === "queued" && (
                  <form action={cancelJobAction}>
                    <input type="hidden" name="id" value={j.id} />
                    <SubmitButton className="btn sm" pendingText="Cancelling…">Cancel</SubmitButton>
                  </form>
                )}
              </div>
              {j.error && <p className="text-2xs m-0 mt-1 break-words" style={{ color: j.state === "failed" ? "var(--rose-on)" : "var(--mute)" }}>{j.state === "queued" ? "Last try: " : ""}{j.error}</p>}
              {j.state === "running" && <p className="text-2xs m-0 mt-1 text-[var(--mute)]">{Math.round(j.progress * 100)}%{j.lastLog ? ` — ${j.lastLog}` : ""}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
