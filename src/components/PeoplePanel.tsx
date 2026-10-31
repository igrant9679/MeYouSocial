import { formatDay } from "@/lib/zoned-dates";
import Link from "next/link";
import { db } from "@/lib/db";
import { SubmitButton } from "@/components/SubmitButton";
import { DeleteButton } from "@/components/DeleteButton";
import { getPublicUrl } from "@/lib/public-url";
import { resolveEmailSender } from "@/lib/unipile/accounts";
import { changeRoleAction, inviteAction, revokeAction } from "@/app/actions/people";
import { ResetLinkButton } from "@/components/ResetLinkButton";
import { requestNow } from "@/lib/request-time";
import { getCurrentUser, isPlatformOperator } from "@/lib/acl";
import { getSetting } from "@/lib/settings";
import { REQUIRE_SETTING } from "@/lib/two-factor";
import { requireTwoFactorAction, resetTwoFactorAction } from "@/app/actions/two-factor";

/** Members not seen for this many days are flagged for review (E-SEC-18). */
const IDLE_DAYS = 60;

/**
 * Members, roles and invitations — ONE panel rendered by Settings → People and
 * by Settings → People (the old location keeps working for a release). Server
 * component: every verb is a server-action form. `returnTo` tells the actions
 * where to flash back to.
 */
export async function PeoplePanel({ workspaceId, workspaceName, returnTo }: { workspaceId: string; workspaceName: string; returnTo: string }) {
  const [members, invitations, mailSender, origin] = await Promise.all([
    db.membership.findMany({ where: { workspaceId }, include: { user: true }, orderBy: { createdAt: "asc" } }),
    db.invitation.findMany({ where: { workspaceId, acceptedAt: null }, orderBy: { createdAt: "desc" } }),
    // Name the mailbox this invite will actually leave from, rather than
    // describing a hypothetical.
    resolveEmailSender(workspaceId).catch(() => null),
    // For the pending-invitation join links — on a workspace with no connected
    // mailbox the invitation email is only LOGGED, so the link is the hand-over.
    getPublicUrl(),
  ]);
  // Access review (E-SEC-18): days since an active member was last here — from
  // their last activity, or from joining if they never signed in. null = fine.
  const now = requestNow();
  const idleDays = (m: (typeof members)[number]): number | null => {
    if (m.status !== "active") return null;
    const since = m.user.lastActivityAt ?? m.createdAt;
    const days = Math.floor((now - new Date(since).getTime()) / 86_400_000);
    return days >= IDLE_DAYS ? days : null;
  };
  const idle = members.filter((m) => idleDays(m) !== null);
  // Two-factor (E-SEC-07, E-SEC-18): which admins sign in with a password alone,
  // whether this workspace requires it of them, and the operator's reset.
  const [me, required] = await Promise.all([getCurrentUser(), getSetting(REQUIRE_SETTING, workspaceId).then((v) => v === "true")]);
  const operator = isPlatformOperator(me?.email);
  const adminsWithout = members.filter((m) => m.status === "active" && m.role === "ADMIN" && !m.user.totpEnabledAt).length;

  return (
    <>
      <section className="card mb-5">
        <h2 className="font-mono text-[15px] mb-3">Invite a member</h2>
        <form action={inviteAction} className="flex flex-wrap gap-2 items-end">
          <input type="hidden" name="returnTo" value={returnTo} />
          <label className="flex flex-col text-xs font-mono uppercase text-[var(--mute)]">Email
            <input name="email" type="email" required className="mt-1 border border-[var(--line-2)] rounded-lg px-3 py-2 text-sm min-w-[260px]" />
          </label>
          <label className="flex flex-col text-xs font-mono uppercase text-[var(--mute)]">Role
            <select name="role" defaultValue="EDITOR" className="mt-1 border border-[var(--line-2)] rounded-lg px-3 py-2 text-sm">
              <option value="ADMIN">Admin</option>
              <option value="EDITOR">Editor</option>
              <option value="VIEWER">Viewer</option>
            </select>
          </label>
          <SubmitButton className="btn primary">Send invitation</SubmitButton>
        </form>
        {mailSender ? (
          <p className="text-xs text-[var(--mute)] mt-2">
            Sends for real from <b>{mailSender.name ?? "the connected mailbox"}</b> over HTTPS.
          </p>
        ) : (
          <p className="text-xs mt-2" style={{ color: "var(--amber-on)" }}>
            <b>No mailbox is connected for {workspaceName}</b>, so this invitation will be logged rather than
            delivered — outbound SMTP is blocked on this host, so a connected mailbox is the only route out.{" "}
            <Link href="/admin/connections" className="underline">Connect one →</Link>
          </p>
        )}
      </section>

      <section className="card mb-5">
        <h2 className="font-mono text-[15px] mb-3">Members</h2>
        {/* Two-factor for admins (E-SEC-07). */}
        <div className="text-xs mb-3 flex items-center gap-2 flex-wrap">
          <span><b>Two-factor for admins:</b> {required ? "required" : "optional"}{adminsWithout ? ` — ${adminsWithout} admin${adminsWithout === 1 ? " signs" : "s sign"} in with a password alone` : " — every admin has it on"}.</span>
          <form action={requireTwoFactorAction}>
            <input type="hidden" name="intent" value={required ? "off" : "on"} />
            <SubmitButton className="btn sm" pendingText="…">{required ? "Stop requiring it" : "Require it"}</SubmitButton>
          </form>
        </div>
        {/* Access review (E-SEC-18): who hasn't been here in two months. */}
        {idle.length > 0 && (
          <p className="text-xs mb-3 px-2.5 py-1.5 rounded-lg" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
            {idle.length === 1 ? "One member hasn't" : `${idle.length} members haven't`} been active in {IDLE_DAYS}+ days — check they still need access. Revoke keeps their history.
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="font-mono text-[11px] text-[var(--mute)] uppercase">
              <tr><th className="text-left py-2">Email</th><th className="text-left">Role</th><th className="text-left">Status</th><th className="text-left">Last activity</th><th></th></tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-t border-[var(--line)]">
                  <td className="py-2">
                    <div className="font-semibold">{m.user.name ?? "—"}</div>
                    <div className="text-xs text-[var(--mute)]">{m.user.email}</div>
                  </td>
                  <td>
                    <form action={changeRoleAction} className="inline-flex items-center gap-1">
                      <input type="hidden" name="userId" value={m.userId} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      {/* key={m.role} is LOAD-BEARING: React 19 auto-resets a form
                          after its action, restoring the select to the LAST-RENDERED
                          default — keying by role remounts it on a saved change. */}
                      <select key={m.role} name="role" defaultValue={m.role} className="border border-[var(--line-2)] rounded-md px-2 py-1 text-xs font-mono">
                        <option value="ADMIN">Admin</option>
                        <option value="EDITOR">Editor</option>
                        <option value="VIEWER">Viewer</option>
                      </select>
                      <button type="submit" className="btn sm">Save</button>
                    </form>
                  </td>
                  <td><span className="pill" style={{ background: m.status === "active" ? "var(--green-soft)" : "var(--rose-soft)", color: m.status === "active" ? "var(--green)" : "var(--rose)" }}>{m.status}</span></td>
                  <td className="text-xs text-[var(--mute)]">
                    {m.user.lastActivityAt ? formatDay(new Date(m.user.lastActivityAt)) : "—"}
                    {m.user.totpEnabledAt
                      ? <span className="block text-[10px]" style={{ color: "var(--green-on)" }}>two-factor on</span>
                      : m.role === "ADMIN" && m.status === "active" && <span className="block text-[10px]" style={{ color: "var(--amber-on)" }}>no two-factor</span>}
                    {idleDays(m) !== null && <span className="block text-[10px]" style={{ color: "var(--amber-on)" }}>{m.user.lastActivityAt ? `inactive ${idleDays(m)} days` : "never signed in"}</span>}
                  </td>
                  <td className="text-right">
                    {/* Revoke suspends the membership (row and history kept); Remove
                        deletes it. Removing the last active ADMIN is refused by the action. */}
                    <div className="flex items-center gap-1 justify-end flex-wrap">
                      {m.status === "active" && <ResetLinkButton userId={m.userId} />}
                      {operator && m.user.totpEnabledAt && (
                        <form action={resetTwoFactorAction}>
                          <input type="hidden" name="userId" value={m.userId} />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <button type="submit" className="btn sm" title="For someone who lost their phone and recovery codes">Turn off two-factor</button>
                        </form>
                      )}
                      {m.status === "active" && (
                        <form action={revokeAction}>
                          <input type="hidden" name="userId" value={m.userId} />
                          <button type="submit" className="btn sm">Revoke</button>
                        </form>
                      )}
                      <DeleteButton kind="membership" id={m.id} name={m.user.email} returnTo={returnTo} label="Remove" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {invitations.length > 0 && (
        <section className="card mb-5">
          <h2 className="font-mono text-[15px] mb-3">Pending invitations</h2>
          <ul className="m-0 p-0">
            {invitations.map((inv) => (
              <li key={inv.id} className="border-t border-[var(--line)] first:border-t-0 py-2 text-sm flex items-center gap-3 flex-wrap">
                <span className="font-mono text-xs text-[var(--mute)]">{inv.role}</span>
                <span className="flex-1">{inv.email}</span>
                <span className="text-xs text-[var(--mute)]">expires {formatDay(new Date(inv.expiresAt))}</span>
                <DeleteButton kind="invitation" id={inv.id} name={inv.email} returnTo={returnTo} label="Revoke invite" />
                {/* The join link, selectable so it can be passed along by hand when
                    the email can't deliver. Deliberately NOT an <a>: clicking one
                    would walk the ADMIN into the accept flow as the wrong user. */}
                <code className="basis-full text-[11px] text-[var(--mute)] select-all break-all">
                  {origin}/invitations/{inv.token}
                </code>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
