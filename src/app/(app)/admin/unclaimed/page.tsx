import Link from "next/link";
import { redirect } from "next/navigation";
import { Inbox } from "lucide-react";
import { requireRole, isPlatformOperator } from "@/lib/acl";
import { db } from "@/lib/db";
import { readUnclaimed } from "@/lib/unclaimed-accounts";
import { assignMailboxAction, assignProfileAction } from "@/app/actions/unclaimed-accounts";
import { SubmitButton } from "@/components/SubmitButton";
import { EmptyState } from "@/components/EmptyState";

// Settings → Workspaces → Unclaimed accounts (E-SEC-15): shared mailboxes and
// platform Zernio profiles no workspace owns. Nothing adopts them by itself any
// more; the operator gives each to one workspace, whose admins are told.

const selectCls = "border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs";

export default async function UnclaimedAccountsPage() {
  const { user } = await requireRole("ADMIN");
  if (!isPlatformOperator(user.email)) redirect("/forbidden?why=operator");
  const [view, workspaces, ownKeys] = await Promise.all([
    readUnclaimed(),
    db.workspace.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, zernioProfileId: true } }),
    db.workspaceSetting.findMany({ where: { key: "zernio:api_key", NOT: { value: "" } }, select: { workspaceId: true } }),
  ]);
  const nameOf = new Map(workspaces.map((w) => [w.id, w.name]));
  const withOwnKey = new Set(ownKeys.map((k) => k.workspaceId));
  // A platform profile can only go to a workspace with no profile and no key of its own.
  const profileTargets = workspaces.filter((w) => !w.zernioProfileId && !withOwnKey.has(w.id));
  const open = view.profiles.filter((p) => !p.claimedBy);
  const claimed = view.profiles.filter((p) => p.claimedBy);

  return (
    <main className="w-full max-w-4xl">
      <div className="flex items-center gap-3 mb-3">
        <span className="w-11 h-11 rounded-2xl grid place-items-center" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
          <Inbox className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-xl leading-tight">Unclaimed accounts</h1>
          <p className="text-xs text-[var(--mute)] m-0">Shared accounts no workspace owns. Give each to the company it belongs to — its admins are told. <Link href="/admin/workspaces" className="underline">Back to Workspaces</Link></p>
        </div>
      </div>

      <section className="card mb-4 text-xs">
        <h2 className="font-mono text-[15px] mb-2">Mailboxes (Unipile)</h2>
        {view.mailNote && <p className="m-0 mb-2 text-[var(--mute)]">{view.mailNote}</p>}
        {view.mailboxes.length === 0 ? (
          !view.mailNote && <EmptyState line="Every shared mailbox belongs to a workspace." action={null} />
        ) : (
          <ul className="m-0 p-0 flex flex-col">
            {view.mailboxes.map((m) => (
              <li key={m.accountId} className="list-none border-t border-[var(--line)] first:border-t-0 py-2 flex items-center gap-2 flex-wrap" data-mailbox={m.accountId}>
                <span className="font-semibold flex-1 min-w-48">{m.address ?? "(no address)"} <span className="font-mono text-[10px] text-[var(--mute)]">{m.provider} · {m.accountId}</span></span>
                <form action={assignMailboxAction} className="flex items-center gap-1">
                  <input type="hidden" name="accountId" value={m.accountId} />
                  <select name="workspaceId" required defaultValue="" className={selectCls}>
                    <option value="" disabled>Give it to…</option>
                    {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                  <SubmitButton className="btn sm" pendingText="…">Assign</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card mb-4 text-xs">
        <h2 className="font-mono text-[15px] mb-2">Zernio profiles on the platform key</h2>
        {view.zernioNote && <p className="m-0 mb-2 text-[var(--mute)]">{view.zernioNote}</p>}
        {!view.zernioNote && open.length === 0 && <EmptyState line="Every profile on the platform key belongs to a workspace." action={null} />}
        {open.length > 0 && (
          <ul className="m-0 p-0 flex flex-col">
            {open.map((p) => {
              const targets = p.madeFor ? profileTargets.filter((w) => w.id === p.madeFor) : profileTargets;
              return (
                <li key={p.id} className="list-none border-t border-[var(--line)] first:border-t-0 py-2 flex items-center gap-2 flex-wrap" data-profile={p.id}>
                  <span className="flex-1 min-w-48">
                    <b>{p.name || "(unnamed)"}</b> <span className="font-mono text-[10px] text-[var(--mute)]">{p.id}</span>
                    {p.deletedWorkspace && <span className="block" style={{ color: "var(--rose-on)" }}>Made for a workspace that&apos;s been deleted — its pages may still be connected. Remove it in Zernio; it can&apos;t be assigned.</span>}
                    {p.madeFor && !p.deletedWorkspace && <span className="block text-[var(--mute)]">Made for {nameOf.get(p.madeFor)} — it can only go back there.</span>}
                  </span>
                  {!p.deletedWorkspace && (targets.length ? (
                    <form action={assignProfileAction} className="flex items-center gap-1">
                      <input type="hidden" name="profileId" value={p.id} />
                      <select name="workspaceId" required defaultValue="" className={selectCls}>
                        <option value="" disabled>Give it to…</option>
                        {targets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                      <SubmitButton className="btn sm" pendingText="…">Assign</SubmitButton>
                    </form>
                  ) : (
                    <span className="text-[var(--mute)]">No workspace can take it: each has a profile or its own Zernio key.</span>
                  ))}
                </li>
              );
            })}
          </ul>
        )}
        {claimed.length > 0 && (
          <p className="m-0 mt-2 text-[var(--mute)]">Owned: {claimed.map((p) => `${p.name || p.id} → ${nameOf.get(p.claimedBy!) ?? "?"}`).join(" · ")}</p>
        )}
      </section>
    </main>
  );
}
