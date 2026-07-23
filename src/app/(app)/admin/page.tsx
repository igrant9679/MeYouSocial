import { requireRole } from "@/lib/acl";
import { SubmitButton } from "@/components/SubmitButton";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { email as emailProvider } from "@/lib/email";
import { nanoid } from "nanoid";
import { getPublicUrl } from "@/lib/public-url";

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
  await emailProvider.send({
    to: parsed.data.email,
    subject: `You've been invited to ${workspace.name} on MeYouSocial`,
    html: `<p>You've been invited to join <b>${workspace.name}</b> as a <b>${parsed.data.role}</b>.</p>
           <p><a href="${origin}/invitations/${token}">Accept the invitation</a></p>`,
  });
  revalidatePath("/admin");
}

async function changeRoleAction(formData: FormData) {
  "use server";
  const { workspace, membership: me } = await requireRole("ADMIN");
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!["ADMIN", "EDITOR", "VIEWER"].includes(role)) return;
  if (userId === me.userId) return; // can't change own role here
  await db.membership.updateMany({
    where: { workspaceId: workspace.id, userId },
    data: { role: role as "ADMIN" | "EDITOR" | "VIEWER" },
  });
  revalidatePath("/admin");
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

  const [members, invitations] = await Promise.all([
    db.membership.findMany({
      where: { workspaceId: workspace.id },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }),
    db.invitation.findMany({
      where: { workspaceId: workspace.id, acceptedAt: null },
      orderBy: { createdAt: "desc" },
    }),
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
        <p className="text-xs text-[var(--mute)] mt-2">Emails are mocked in dev — check your console. Set <code>USE_MOCK_EMAIL=false</code> + supply a provider key to send for real.</p>
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
                    <select name="role" defaultValue={m.role} className="border border-[var(--line-2)] rounded-md px-2 py-1 text-xs font-mono">
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
                  {m.status === "active" && (
                    <form action={revokeAction}>
                      <input type="hidden" name="userId" value={m.userId} />
                      <button type="submit" className="btn sm">Revoke</button>
                    </form>
                  )}
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
              <li key={inv.id} className="border-t border-[var(--line)] first:border-t-0 py-2 text-sm flex items-center gap-3">
                <span className="font-mono text-xs text-[var(--mute)]">{inv.role}</span>
                <span className="flex-1">{inv.email}</span>
                <span className="text-xs text-[var(--mute)]">expires {new Date(inv.expiresAt).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
