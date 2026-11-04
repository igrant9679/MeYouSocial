import { UserCheck } from "lucide-react";
import { db } from "@/lib/db";
import { SubmitButton } from "@/components/SubmitButton";
import { getPublicUrl } from "@/lib/public-url";
import { shareToken, APPROVAL_DAYS } from "@/lib/share-links";
import { getPostingTimeZone, formatInZone } from "@/lib/social/slots";
import { createPostApprovalLinkAction, revokeShareLinkAction } from "@/app/actions/share-links";

/**
 * E-SOC-03: the Approvals tab's "Ask a client" card (admins): send one held
 * post to someone without an account. They see it in your colours and logo and
 * answer Approve or Ask for changes; the answer lands here like a reviewer's.
 */
export async function ApprovalLinks({ workspaceId }: { workspaceId: string }) {
  const [pending, links, origin, tz] = await Promise.all([
    db.socialPost.findMany({ where: { workspaceId, approval: "pending" }, select: { id: true, text: true }, orderBy: { createdAt: "asc" }, take: 50 }),
    db.shareLink.findMany({ where: { workspaceId, kind: "post-approval" }, orderBy: { createdAt: "desc" }, take: 20 }),
    getPublicUrl(),
    getPostingTimeZone(workspaceId),
  ]);
  const now = new Date();
  const base = origin.replace(/\/+$/, "");
  const textOf = new Map(pending.map((p) => [p.id, p.text]));
  const open = links.filter((l) => !l.revokedAt && l.expiresAt > now);
  if (!pending.length && !links.length) return null;

  return (
    <details className="card mb-4" id="client-approval" data-approval-links="" open={open.length > 0}>
      <summary className="cursor-pointer select-none text-sm font-semibold flex items-center gap-2 flex-wrap">
        <UserCheck className="w-4 h-4" /> Ask a client to approve
        <span className="font-mono text-[10px] font-normal text-[var(--mute)]">{open.length ? `${open.length} waiting on a client` : "none out"}</span>
      </summary>
      <p className="text-xs text-[var(--mute)] mt-2">
        A link for someone without an account: one post, in your colours and logo, with Approve and Ask for changes. Their answer is
        recorded as theirs and acts like yours; the link closes once they answer, on its date, or when you turn it off.
      </p>
      {links.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2 m-0 p-0 list-none">
          {links.map((l) => {
            const live = !l.revokedAt && l.expiresAt > now;
            return (
              <li key={l.id} className="border border-[var(--line)] rounded-lg p-2.5 text-xs" data-approval-link={live ? "open" : "closed"} style={live ? undefined : { opacity: 0.6 }}>
                <div className="flex flex-wrap items-center gap-2">
                  <b>{l.label ?? "A client"}</b>
                  <span className="text-[var(--mute)] truncate max-w-[22rem]">“{(textOf.get(l.targetKey) ?? "a post no longer waiting").slice(0, 70)}”</span>
                  <span className="text-[var(--mute)]">· {live ? `open until ${formatInZone(l.expiresAt, tz)}` : l.revokedAt ? "answered or turned off" : "expired"} · opened {l.views}×</span>
                  <span className="flex-1" />
                  {live && (
                    <form action={revokeShareLinkAction}>
                      <input type="hidden" name="id" value={l.id} />
                      <SubmitButton className="btn sm" pendingText="Turning off…">Turn off</SubmitButton>
                    </form>
                  )}
                </div>
                {live && <input readOnly value={`${base}/a/${shareToken(l.id)}`} className="mt-1.5 w-full font-code text-[11px]" aria-label="The link to send" data-approval-url="" />}
              </li>
            );
          })}
        </ul>
      )}
      {pending.length > 0 && (
        <form action={createPostApprovalLinkAction} className="mt-3 flex flex-wrap items-end gap-2 text-xs" data-approval-form="">
          <label className="flex flex-col gap-0.5 flex-1 min-w-48">
            <span className="text-[var(--mute)]">Post</span>
            <select name="postId">
              {pending.map((p) => <option key={p.id} value={p.id}>{p.text.slice(0, 70)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[var(--mute)]">Who</span>
            <input name="label" maxLength={80} placeholder="e.g. Sam at Acme" />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[var(--mute)]">Open for</span>
            <select name="days" defaultValue="7">
              {APPROVAL_DAYS.map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
          </label>
          <SubmitButton className="btn primary sm" pendingText="Making…">Make a link</SubmitButton>
        </form>
      )}
    </details>
  );
}
