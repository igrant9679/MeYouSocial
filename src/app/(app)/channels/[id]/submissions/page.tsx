import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { Inbox, Sparkles, X, CheckCircle2, Copy } from "lucide-react";
import { requireChannel } from "@/lib/channel";
import { db } from "@/lib/db";
import { reviewSubmissionAction, promoteSubmissionAction } from "@/app/actions/growth";
import { getPublicUrl } from "@/lib/public-url";
import { CopyButton } from "@/components/CopyButton";
import { DeleteButton } from "@/components/DeleteButton";

// Reviewable queue for incoming audience submissions; promote to Ideas.

export default async function SubmissionsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string }> }) {
  const { id } = await params;
  const { status = "new" } = await searchParams;
  await requireChannel(id);

  const submissions = await db.audienceSubmission.findMany({
    where: { channelId: id, status },
    orderBy: { createdAt: "desc" },
  });

  const counts = await db.audienceSubmission.groupBy({
    by: ["status"],
    where: { channelId: id },
    _count: { _all: true },
  });
  const count = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;

  const publicUrl = `${await getPublicUrl()}/submit/${id}`;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: "#FBE2EF", color: "#DB2777" }}>
          <Inbox className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div>
          <h2 className="font-mono font-bold text-lg leading-tight">Audience submissions</h2>
          <p className="text-xs text-[var(--mute)]">Public form anyone can use to suggest topics.</p>
        </div>
      </div>

      {/* Share link */}
      <div className="card mb-4 flex items-center gap-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Public link</span>
        <code className="bg-[var(--zebra)] rounded px-2 py-1 text-xs font-mono flex-1 truncate">{publicUrl}</code>
        <CopyButton text={publicUrl} label="Copy URL" />
      </div>

      {/* Status tabs */}
      <div className="flex flex-wrap gap-1 mb-4">
        {(["new", "reviewed", "promoted", "rejected"] as const).map((s) => (
          <Link key={s} href={`/channels/${id}/submissions?status=${s}`}
            className={"text-xs font-mono uppercase tracking-wider px-2.5 py-1 rounded-md border " + (status === s ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--line-2)] text-[var(--mute)]")}>
            {s} ({count(s)})
          </Link>
        ))}
      </div>

      {submissions.length === 0 ? (
        <div className="card text-center py-10 text-sm text-[var(--mute)]">No submissions in this bucket.</div>
      ) : (
        <ul className="m-0 p-0 grid grid-cols-1 md:grid-cols-2 gap-3">
          {submissions.map((s) => (
            <li key={s.id} className="card">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{s.status}</span>
                <span className="text-[11px] text-[var(--mute)]">{new Date(s.createdAt).toLocaleString()}</span>
                {s.submitter && <span className="text-[11px] font-mono text-[var(--mute)]">· {s.submitter}</span>}
              </div>
              <h3 className="font-semibold text-sm mb-1">{s.topic}</h3>
              {s.notes && <p className="text-xs text-[var(--mute)] mb-3">{s.notes}</p>}
              <div className="flex items-center gap-2">
                <form action={promoteSubmissionAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <SubmitButton className="btn primary sm flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> Promote to Idea</SubmitButton>
                </form>
                <form action={reviewSubmissionAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="status" value="reviewed" />
                  <button type="submit" className="btn sm flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Reviewed</button>
                </form>
                <form action={reviewSubmissionAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="status" value="rejected" />
                  <button type="submit" className="btn sm flex items-center gap-1.5"><X className="w-3.5 h-3.5" /> Reject</button>
                </form>
                {/* Reject keeps the submission in the queue under a status;
                    this removes it outright. */}
                <DeleteButton kind="audienceSubmission" id={s.id} name={s.topic} returnTo={`/channels/${id}/submissions`} iconOnly />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
