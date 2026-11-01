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
import { DOMAINS_SETTING, GOOGLE_ONLY_SETTING, EXPIRE_SETTING, parseDomains, domainOf, googleSsoAvailable } from "@/lib/access-policy";
import { saveAccessPolicyAction } from "@/app/actions/access-policy";

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
  // Access rules (E-SEC-08, E-SEC-18).
  const [domainsRaw, googleRaw, expireRaw] = await Promise.all([DOMAINS_SETTING, GOOGLE_ONLY_SETTING, EXPIRE_SETTING].map((k) => getSetting(k, workspaceId)));
  const domains = parseDomains(domainsRaw);
  const sso = googleSsoAvailable();
  const googleOnly = googleRaw === "true";
  const expireDays = Number(expireRaw) || 0;
  const outside = domains.length ? members.filter((m) => m.status === "active" && !domains.includes(domainOf(m.user.email))) : [];

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

      {/* Access (E-SEC-08, E-SEC-18): who may join, how they sign in, when idle access ends. */}
      <section id="access" className="card mb-5 scroll-mt-20" data-access-policy>
        <h2 className="font-mono text-[15px] mb-1">Access</h2>
        <p className="text-xs text-[var(--mute)] mb-3">Who may join this workspace, how they sign in, and when access ends for someone who stopped coming.</p>
        <form action={saveAccessPolicyAction} className="flex flex-col gap-3 text-xs">
          <input type="hidden" name="returnTo" value={returnTo} />
          <label className="flex flex-col gap-1">
            <span><b>Only these email domains</b> <span className="text-[var(--mute)]">— invitations and new members must be at one of them; leave empty for anyone</span></span>
            <input name="domains" defaultValue={domains.join(", ")} placeholder="acme.com, acme.co.uk" className="border border-[var(--line-2)] rounded-lg px-3 py-2 text-sm max-w-md" />
          </label>
          {outside.length > 0 && (
            <p className="m-0" style={{ color: "var(--amber-on)" }}>
              {outside.length === 1 ? "One member is" : `${outside.length} members are`} outside these domains ({outside.map((m) => m.user.email).join(", ")}) — they keep access; revoke them below if they shouldn&apos;t.
            </p>
          )}
          <label className="flex items-start gap-2">
            <input type="checkbox" name="google" defaultChecked={googleOnly} disabled={!sso} className="mt-0.5" />
            <span>
              <b>Sign in with Google only</b>{" "}
              <span className="text-[var(--mute)]">
                {sso
                  ? "— members can't use a password here; Google's own two-factor applies. The platform operator is exempt, as the way back in."
                  : "— not available: Google sign-in isn't switched on for this install (the platform operator enables it)."}
              </span>
            </span>
          </label>
          <label className="flex items-center gap-2 flex-wrap">
            <span><b>End access after</b></span>
            <select name="expire" defaultValue={String(expireDays)} className="border border-[var(--line-2)] rounded-lg px-2 py-1.5 text-sm">
              <option value="0">never</option>
              <option value="60">60 days idle</option>
              <option value="90">90 days idle</option>
              <option value="180">180 days idle</option>
            </select>
            <span className="text-[var(--mute)]">— editors and viewers only, never admins; revoked, history kept; the admins are told.</span>
          </label>
          <div><SubmitButton className="btn sm" pendingText="Saving…">Save access rules</SubmitButton></div>
        </form>
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
