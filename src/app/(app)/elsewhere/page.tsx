import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Repeat } from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { locateRecord } from "@/lib/record-elsewhere";
import { openRecordInWorkspaceAction } from "@/app/actions/workspace-switch";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * "This <record> is in another workspace" (2026-11-19, the owner's 404 on an LSI
 * draft). A record page whose id isn't in the active workspace, but is in another
 * of this person's, sends them here (`elsewhereOr404` in `lib/record-elsewhere`).
 * Nothing is switched until they press the button; the action checks the
 * membership and the record again. `to` must be one of the record routes there —
 * anything else is a 404, and so is a record in no workspace of theirs.
 */
export default async function ElsewherePage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const { to = "" } = await searchParams;
  const { user, workspace } = await requireMembership();
  const hit = await locateRecord(user.memberships, user.id, to);
  if (!hit) notFound();
  // Already switched (in another tab, say) — open it.
  if (hit.workspaceId === workspace.id) redirect(hit.to);

  return (
    <main className="p-6 w-full">
      <div className="card max-w-xl flex flex-col gap-3" data-record-elsewhere={hit.workspaceId}>
        <h1 className="font-mono font-bold text-xl m-0">This {hit.noun} is in another workspace</h1>
        <p className="text-sm m-0">
          <b>“{hit.title}”</b> belongs to <b>{hit.workspaceName}</b>. You are in <b>{workspace.name}</b>{" "}now, so it can&apos;t open here.
        </p>
        <p className="text-xs text-[var(--mute)] m-0">
          This usually happens when the workspace was switched in another tab and the page was reloaded, or when the link came from {hit.workspaceName} (an email, a notification, an old tab).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <form action={openRecordInWorkspaceAction}>
            <input type="hidden" name="workspaceId" value={hit.workspaceId} />
            <input type="hidden" name="to" value={hit.to} />
            <SubmitButton className="btn primary sm inline-flex items-center gap-1.5" pendingText="Switching…">
              <Repeat className="w-3.5 h-3.5" /> Switch to {hit.workspaceName} and open it
            </SubmitButton>
          </form>
          <Link href={hit.home} className="btn sm">Stay in {workspace.name}</Link>
        </div>
      </div>
    </main>
  );
}
