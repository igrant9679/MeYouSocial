import { Link2 } from "lucide-react";
import { db } from "@/lib/db";
import { SubmitButton } from "@/components/SubmitButton";
import { getPublicUrl } from "@/lib/public-url";
import { shareToken, SHARE_DAYS } from "@/lib/share-links";
import { getPostingTimeZone, formatInZone } from "@/lib/social/slots";
import { createReportShareLinkAction, revokeShareLinkAction } from "@/app/actions/share-links";

/**
 * E-MEA-14: the report page's "Share a read-only link" card — admins only,
 * because a link is the report for anyone who holds it. Each link is listed
 * with its address to copy, who it's for, how often it was opened, and when it
 * closes; Turn off closes it at once.
 */
export async function ReportShareLinks({ workspaceId, reportKey }: { workspaceId: string; reportKey: string }) {
  const [links, origin, tz] = await Promise.all([
    db.shareLink.findMany({ where: { workspaceId, kind: "report", targetKey: reportKey }, orderBy: { createdAt: "desc" }, take: 20 }),
    getPublicUrl(),
    getPostingTimeZone(workspaceId),
  ]);
  const now = new Date();
  const open = links.filter((l) => !l.revokedAt && l.expiresAt > now);
  const base = origin.replace(/\/+$/, "");

  return (
    <details className="card mb-4" id="share" data-share-links="" open={open.length > 0}>
      <summary className="cursor-pointer select-none text-sm font-semibold flex items-center gap-2 flex-wrap">
        <Link2 className="w-4 h-4" /> Share a read-only link
        <span className="font-mono text-[10px] font-normal text-[var(--mute)]">{open.length ? `${open.length} open` : "none open"}</span>
      </summary>
      <p className="text-xs text-[var(--mute)] mt-2">
        For a client without an account: this report only, read-only, in your brand colour and logo, with its PDF. It closes on its date or when you turn it off.
      </p>
      {links.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2 m-0 p-0 list-none">
          {links.map((l) => {
            const live = !l.revokedAt && l.expiresAt > now;
            const url = `${base}/r/${shareToken(l.id)}`;
            return (
              <li key={l.id} className="border border-[var(--line)] rounded-lg p-2.5 text-xs" data-share-link={live ? "open" : "closed"} style={live ? undefined : { opacity: 0.6 }}>
                <div className="flex flex-wrap items-center gap-2">
                  <b>{l.label ?? "Unlabelled link"}</b>
                  <span className="text-[var(--mute)]">
                    {live ? `open until ${formatInZone(l.expiresAt, tz)}` : l.revokedAt ? "turned off" : "expired"} · opened {l.views} time{l.views === 1 ? "" : "s"}
                    {l.lastViewedAt ? `, last ${formatInZone(l.lastViewedAt, tz)}` : ""}
                  </span>
                  <span className="flex-1" />
                  {live && (
                    <form action={revokeShareLinkAction}>
                      <input type="hidden" name="id" value={l.id} />
                      <SubmitButton className="btn sm" pendingText="Turning off…">Turn off</SubmitButton>
                    </form>
                  )}
                </div>
                {live && <input readOnly value={url} className="mt-1.5 w-full font-code text-[11px]" aria-label="The link to copy" data-share-url="" />}
              </li>
            );
          })}
        </ul>
      )}
      <form action={createReportShareLinkAction} className="mt-3 flex flex-wrap items-end gap-2 text-xs" data-share-form="">
        <input type="hidden" name="reportKey" value={reportKey} />
        <label className="flex flex-col gap-0.5 flex-1 min-w-40">
          <span className="text-[var(--mute)]">Who it&apos;s for (optional)</span>
          <input name="label" maxLength={80} placeholder="e.g. Acme — monthly review" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[var(--mute)]">Open for</span>
          <select name="days" defaultValue="30">
            {SHARE_DAYS.map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>
        </label>
        <SubmitButton className="btn primary sm" pendingText="Making…">Make a link</SubmitButton>
      </form>
    </details>
  );
}
