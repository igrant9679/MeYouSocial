import { requireRole } from "@/lib/acl";
import { SubmitButton } from "@/components/SubmitButton";
import { db } from "@/lib/db";
import { DeleteButton } from "@/components/DeleteButton";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { writeAudit } from "@/lib/governance";
import { z } from "zod";
import { emailFor } from "@/lib/email";
import { nanoid } from "nanoid";
import { getPublicUrl } from "@/lib/public-url";
import { resolveEmailSender } from "@/lib/unipile/accounts";
import Link from "next/link";

// MU-14 — Users & Roles (Admin). Implements:
//   (Users page: list + add/edit role/deactivate/remove)
//   (invite by email, choose role)
//   (change role + revoke; revoked members lose access immediately)
//   (workspace scoping of all data)

const inviteSchema = z.object({
  email: z.string().email().transform((s) => s.toLowerCase()),
  role: z.enum(["ADMIN", "EDITOR", "VIEWER"]),
});

async function inviteAction(formData: FormData) {
  "use server";
  const { workspace } = await requireRole("ADMIN");
  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) return;

  const token = nanoid(40);
  await db.invitation.create({
    data: {
      workspaceId: workspace.id,
      email: parsed.data.email,
      role: parsed.data.role,
      token,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
    },
  });
  const origin = await getPublicUrl();
  await emailFor(workspace.id).send({
    to: parsed.data.email,
    subject: `You've been invited to ${workspace.name} on MeYouSocial`,
    html: `<p>You've been invited to join <b>${workspace.name}</b> as a <b>${parsed.data.role}</b>.</p>
           <p><a href="${origin}/invitations/${token}">Accept the invitation</a></p>`,
  });
  revalidatePath("/admin");
}

async function changeRoleAction(formData: FormData) {
  "use server";
  const { workspace, membership: me, user: actor } = await requireRole("ADMIN");
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!["ADMIN", "EDITOR", "VIEWER"].includes(role)) return;
  // Refusals must SAY so — this returned silently and read as "won't save".
  if (userId === me.userId) {
    redirect(`/admin?flashErr=${encodeURIComponent("You can't change your own role — another admin has to.")}`);
  }
  await db.membership.updateMany({
    where: { workspaceId: workspace.id, userId },
    data: { role: role as "ADMIN" | "EDITOR" | "VIEWER" },
  });
  const target = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  // A role change is governance — it gets an audit row like every other one.
  await writeAudit({
    workspaceId: workspace.id,
    actorId: actor.id,
    action: "membership.role_changed",
    entityType: "membership",
    entityId: userId,
    meta: { email: target?.email, role },
  });
  revalidatePath("/admin");
  redirect(`/admin?flash=${encodeURIComponent(`${target?.email ?? "Member"} is now ${role}.`)}`);
}

async function revokeAction(formData: FormData) {
  "use server";
  const { workspace, membership: me } = await requireRole("ADMIN");
  const userId = String(formData.get("userId") ?? "");
  if (userId === me.userId) return;
  await db.membership.updateMany({
    where: { workspaceId: workspace.id, userId },
    data: { status: "revoked" },
  });
  revalidatePath("/admin");
}

export default async function AdminUsersPage() {
  const { workspace } = await requireRole("ADMIN");

  const [members, invitations, mailSender] = await Promise.all([
    db.membership.findMany({
      where: { workspaceId: workspace.id },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }),
    db.invitation.findMany({
      where: { workspaceId: workspace.id, acceptedAt: null },
      orderBy: { createdAt: "desc" },
    }),
    // Name the mailbox this invite will actually leave from, rather than
    // describing a hypothetical. Same principle as the image provider card:
    // if the UI can resolve what will happen, it should say so.
    resolveEmailSender(workspace.id).catch(() => null),
  ]);

  return (
    <div className="w-full">
      <h1 className="font-mono font-bold text-xl mb-1">Users & Roles</h1>
      <p className="text-sm text-[var(--mute)] mb-5">Workspace: <b>{workspace.name}</b></p>


      <section className="card mb-5">
        <h2 className="font-mono text-[15px] mb-3">Invite a member</h2>
        <form action={inviteAction} className="flex flex-wrap gap-2 items-end">
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
        {/* Was: "Emails are mocked in dev — check your console. Set
            USE_MOCK_EMAIL=false + supply a provider key to send for real."
            Wrong twice over: invitations DO send for real through a connected
            mailbox, and USE_MOCK_EMAIL was read by nothing at all, so the
            instruction had no effect. Say what will actually happen instead. */}
        {mailSender ? (
          <p className="text-xs text-[var(--mute)] mt-2">
            Sends for real from <b>{mailSender.name ?? "the connected mailbox"}</b> over HTTPS.
          </p>
        ) : (
          <p className="text-xs mt-2" style={{ color: "var(--amber-on)" }}>
            <b>No mailbox is connected for {workspace.name}</b>, so this invitation will be logged rather than
            delivered — outbound SMTP is blocked on this host, so a connected mailbox is the only route out.{" "}
            <Link href="/admin/connections" className="underline">Connect one →</Link>
          </p>
        )}
      </section>

      <section className="card mb-5">
        <h2 className="font-mono text-[15px] mb-3">Members</h2>
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
                    {/* key={m.role} is LOAD-BEARING: React 19 auto-resets a
                        form after its action, restoring the select to the
                        LAST-RENDERED default — so a successful save visibly
                        snapped back to the old role and read as "won't save"
                        (user report 2026-08-13). Keying by role remounts the
                        select when the saved value changes. */}
                    <select key={m.role} name="role" defaultValue={m.role} className="border border-[var(--line-2)] rounded-md px-2 py-1 text-xs font-mono">
                      <option value="ADMIN">Admin</option>
                      <option value="EDITOR">Editor</option>
                      <option value="VIEWER">Viewer</option>
                    </select>
                    <button type="submit" className="btn sm">Save</button>
                  </form>
                </td>
                <td><span className="pill" style={{ background: m.status === "active" ? "var(--green-soft)" : "var(--rose-soft)", color: m.status === "active" ? "var(--green)" : "var(--rose)" }}>{m.status}</span></td>
                <td className="text-xs text-[var(--mute)]">{m.user.lastActivityAt ? new Date(m.user.lastActivityAt).toLocaleString() : "—"}</td>
                <td className="text-right">
                  {/* Revoke suspends the membership; Remove deletes it. Both
                      are offered because they are genuinely different: a
                      revoked member keeps their row and history, a removed one
                      does not. Removing the last active ADMIN is refused by
                      the action — it would leave the workspace unadministrable. */}
                  <div className="flex items-center gap-1 justify-end flex-wrap">
                    {m.status === "active" && (
                      <form action={revokeAction}>
                        <input type="hidden" name="userId" value={m.userId} />
                        <button type="submit" className="btn sm">Revoke</button>
                      </form>
                    )}
                    <DeleteButton kind="membership" id={m.id} name={m.user.email} returnTo="/admin" label="Remove" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {invitations.length > 0 && (
        <section className="card">
          <h2 className="font-mono text-[15px] mb-3">Pending invitations</h2>
          <ul className="m-0 p-0">
            {invitations.map((inv) => (
              <li key={inv.id} className="border-t border-[var(--line)] first:border-t-0 py-2 text-sm flex items-center gap-3 flex-wrap">
                <span className="font-mono text-xs text-[var(--mute)]">{inv.role}</span>
                <span className="flex-1">{inv.email}</span>
                <span className="text-xs text-[var(--mute)]">expires {new Date(inv.expiresAt).toLocaleDateString()}</span>
                <DeleteButton kind="invitation" id={inv.id} name={inv.email} returnTo="/admin" label="Revoke invite" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
