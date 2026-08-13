import { redirect } from "next/navigation";
import { Building2, LogIn, UserPlus, Trash2 } from "lucide-react";
import { requireRole, isPlatformOperator } from "@/lib/acl";
import { db } from "@/lib/db";
import { deletionImpact } from "@/lib/deletable";
import { SubmitButton } from "@/components/SubmitButton";
import {
  platformCreateWorkspaceAction,
  platformDeleteWorkspaceAction,
  platformEnterWorkspaceAction,
  platformAddMemberAction,
  platformChangeRoleAction,
  platformToggleMembershipAction,
  platformRemoveMembershipAction,
} from "@/app/actions/platform-workspaces";

// Admin → Workspaces: the PLATFORM operator's cross-tenant surface. Everything
// here works on any workspace regardless of the operator's own memberships —
// the per-workspace /admin pages stay the tenant admins' home. Flash messages
// ride the layout's FlashBanner (flash / flashErr params).

const ROLES = ["ADMIN", "EDITOR", "VIEWER"] as const;

export default async function PlatformWorkspacesPage() {
  const { user } = await requireRole("ADMIN");
  if (!isPlatformOperator(user.email)) redirect("/forbidden");

  const workspaces = await db.workspace.findMany({
    orderBy: { name: "asc" },
    include: {
      memberships: { include: { user: { select: { email: true, name: true } } }, orderBy: { createdAt: "asc" } },
      _count: { select: { channels: true, memberships: true } },
    },
  });
  const invitations = await db.invitation.findMany({
    where: { acceptedAt: null, workspaceId: { in: workspaces.map((w) => w.id) } },
    orderBy: { createdAt: "desc" },
  });
  const impacts = new Map(
    await Promise.all(
      workspaces.map(async (w) => [w.id, await deletionImpact("workspace", w.id, w.id)] as const),
    ),
  );

  return (
    <main className="w-full">
      <div className="flex items-center gap-3 mb-1.5">
        <span className="w-11 h-11 rounded-2xl grid place-items-center" style={{ background: "var(--violet-soft)", color: "var(--violet-on)" }}>
          <Building2 className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div className="flex-1 min-w-0">
          <h1 className="font-mono font-bold text-xl leading-tight">Workspaces</h1>
          <p className="text-xs text-[var(--mute)]">
            Platform-operator view of every tenant: create and delete workspaces, manage members and roles anywhere —
            no membership needed. &ldquo;Enter&rdquo; joins you as admin and switches in, so every per-workspace admin
            page works there too.
          </p>
        </div>
      </div>

      {/* Create */}
      <form action={platformCreateWorkspaceAction} className="card mb-4 flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-52 text-[11px] text-[var(--mute)]">
          New workspace name
          <input name="name" required minLength={2} maxLength={60} placeholder="Acme Inc." className="w-full text-sm mt-0.5" />
        </label>
        <SubmitButton className="btn primary" pendingText="Creating…">Create workspace</SubmitButton>
      </form>

      {workspaces.map((ws) => {
        const pending = invitations.filter((i) => i.workspaceId === ws.id);
        const impact = impacts.get(ws.id) ?? [];
        return (
          <section key={ws.id} className="card mb-4">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <h2 className="font-mono font-bold text-[15px] flex-1 min-w-40">
                {ws.name}
                <span className="font-normal text-[10px] text-[var(--mute)] ml-2">{ws.id}</span>
              </h2>
              <span className="font-mono text-[10px] text-[var(--mute)]">
                {ws._count.memberships} member{ws._count.memberships === 1 ? "" : "s"} · {ws._count.channels} channel{ws._count.channels === 1 ? "" : "s"} · created {ws.createdAt.toLocaleDateString("en-GB")}
              </span>
              <form action={platformEnterWorkspaceAction}>
                <input type="hidden" name="id" value={ws.id} />
                <SubmitButton className="btn sm" pendingText="Entering…" title="Join as admin and switch into this workspace">
                  <LogIn className="w-3.5 h-3.5" /> Enter
                </SubmitButton>
              </form>
            </div>

            {/* Members */}
            {ws.memberships.length > 0 ? (
              <table className="w-full text-sm mb-2">
                <thead className="font-mono text-[11px] text-[var(--mute)] uppercase">
                  <tr><th className="text-left py-1.5">Member</th><th className="text-left">Role</th><th className="text-left">Status</th><th></th></tr>
                </thead>
                <tbody>
                  {ws.memberships.map((m) => (
                    <tr key={m.id} className="border-t border-[var(--line)]">
                      <td className="py-1.5">
                        <div className="font-semibold">{m.user.name ?? "—"}</div>
                        <div className="text-xs text-[var(--mute)]">{m.user.email}</div>
                      </td>
                      <td>
                        <form action={platformChangeRoleAction} className="inline-flex items-center gap-1">
                          <input type="hidden" name="workspaceId" value={ws.id} />
                          <input type="hidden" name="membershipId" value={m.id} />
                          {/* key={m.role}: React 19 resets the form to its
                              last-rendered default after the action — without
                              the remount a successful save snaps back visually
                              and reads as "won't save" (same fix as /admin). */}
                          <select key={m.role} name="role" defaultValue={m.role} className="border border-[var(--line-2)] rounded-md px-2 py-1 text-xs font-mono">
                            {ROLES.map((r) => <option key={r} value={r}>{r[0] + r.slice(1).toLowerCase()}</option>)}
                          </select>
                          <button type="submit" className="btn sm">Save</button>
                        </form>
                      </td>
                      <td>
                        <span className="pill" style={{ background: m.status === "active" ? "var(--green-soft)" : "var(--rose-soft)", color: m.status === "active" ? "var(--green)" : "var(--rose)" }}>{m.status}</span>
                      </td>
                      <td className="text-right">
                        <div className="inline-flex items-center gap-1 flex-wrap justify-end">
                          <form action={platformToggleMembershipAction}>
                            <input type="hidden" name="workspaceId" value={ws.id} />
                            <input type="hidden" name="membershipId" value={m.id} />
                            <input type="hidden" name="to" value={m.status === "active" ? "revoked" : "active"} />
                            <button type="submit" className="btn sm">{m.status === "active" ? "Revoke" : "Reactivate"}</button>
                          </form>
                          <form action={platformRemoveMembershipAction}>
                            <input type="hidden" name="workspaceId" value={ws.id} />
                            <input type="hidden" name="membershipId" value={m.id} />
                            <button type="submit" className="btn sm" title="Delete the membership row entirely (history included)">Remove</button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-xs text-[var(--mute)] mb-2">No members yet — this workspace is unreachable until someone is added.</p>
            )}

            {/* Add member */}
            <form action={platformAddMemberAction} className="flex flex-wrap items-end gap-2 mb-2">
              <input type="hidden" name="workspaceId" value={ws.id} />
              <label className="flex-1 min-w-48 text-[11px] text-[var(--mute)]">
                Add member by email
                <input name="email" type="email" required placeholder="person@company.com" className="w-full text-sm mt-0.5" />
              </label>
              <label className="text-[11px] text-[var(--mute)]">
                Role
                <select name="role" defaultValue="EDITOR" className="block border border-[var(--line-2)] rounded-md px-2 py-2 text-xs font-mono mt-0.5">
                  {ROLES.map((r) => <option key={r} value={r}>{r[0] + r.slice(1).toLowerCase()}</option>)}
                </select>
              </label>
              <SubmitButton className="btn sm" pendingText="Adding…">
                <UserPlus className="w-3.5 h-3.5" /> Add
              </SubmitButton>
              <span className="text-[10px] text-[var(--mute)] basis-full">
                An existing account is attached immediately; an unknown email gets an invitation via this workspace&apos;s mailbox.
              </span>
            </form>

            {pending.length > 0 && (
              <p className="text-[11px] text-[var(--mute)] mb-2">
                Pending invitations: {pending.map((i) => `${i.email} (${i.role})`).join(", ")}
              </p>
            )}

            {/* Delete — type-to-confirm, with the registry's impact preview. */}
            <details>
              <summary className="cursor-pointer text-[11px] font-mono select-none" style={{ color: "var(--rose-on)" }}>
                <Trash2 className="w-3 h-3 inline mr-1" /> Delete this workspace…
              </summary>
              <form action={platformDeleteWorkspaceAction} className="mt-2 flex flex-wrap items-end gap-2 rounded-lg p-2" style={{ background: "var(--rose-soft)" }}>
                <input type="hidden" name="id" value={ws.id} />
                <div className="basis-full text-[11px]" style={{ color: "var(--rose-on)" }}>
                  Deletes everything in it{impact.length ? `: ${impact.map(([label, n]) => `${n} ${label}`).join(", ")}` : ""}. This cannot be undone.
                </div>
                <label className="flex-1 min-w-52 text-[11px]" style={{ color: "var(--rose-on)" }}>
                  Type <b>{ws.name}</b> to confirm
                  <input name="confirm" required placeholder={ws.name} className="w-full text-sm mt-0.5" autoComplete="off" />
                </label>
                <SubmitButton className="btn sm" pendingText="Deleting…">
                  <Trash2 className="w-3.5 h-3.5" /> Delete workspace
                </SubmitButton>
              </form>
            </details>
          </section>
        );
      })}
    </main>
  );
}
