"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { nanoid } from "nanoid";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { emailFor } from "@/lib/email";
import { getPublicUrl } from "@/lib/public-url";
import { PRODUCT } from "@/lib/product";

// Members, roles and invitations — moved out of the Admin users page (One-Loop
// step 5) so the same panel renders under Settings → People and Publish Admin → Users.
// Every form carries `returnTo` (a same-site path) so the flash lands on the
// page the person was on.

const inviteSchema = z.object({
  email: z.string().email().transform((s) => s.toLowerCase()),
  role: z.enum(["ADMIN", "EDITOR", "VIEWER"]),
});

function back(formData: FormData): string {
  const raw = String(formData.get("returnTo") ?? "");
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/setup/people";
}

function revalidateBoth() {
  revalidatePath("/admin");
  revalidatePath("/setup/people");
  revalidatePath("/setup");
  revalidatePath("/inbox");
}

export async function inviteAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const parsed = inviteSchema.safeParse({ email: formData.get("email"), role: formData.get("role") });
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
    subject: `You've been invited to ${workspace.name} on ${PRODUCT}`,
    html: `<p>You've been invited to join <b>${workspace.name}</b> as a <b>${parsed.data.role}</b>.</p>
           <p><a href="${origin}/invitations/${token}">Accept the invitation</a></p>`,
  });
  revalidateBoth();
}

export async function changeRoleAction(formData: FormData) {
  const { workspace, membership: me, user: actor } = await requireRole("ADMIN");
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");
  const returnTo = back(formData);
  if (!["ADMIN", "EDITOR", "VIEWER"].includes(role)) return;
  // Refusals must SAY so — this returned silently and read as "won't save".
  if (userId === me.userId) {
    redirect(`${returnTo}?flashErr=${encodeURIComponent("You can't change your own role — another admin has to.")}`);
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
  revalidateBoth();
  redirect(`${returnTo}?flash=${encodeURIComponent(`${target?.email ?? "Member"} is now ${role}.`)}`);
}

export async function revokeAction(formData: FormData) {
  const { workspace, membership: me } = await requireRole("ADMIN");
  const userId = String(formData.get("userId") ?? "");
  if (userId === me.userId) return;
  await db.membership.updateMany({
    where: { workspaceId: workspace.id, userId },
    data: { status: "revoked" },
  });
  revalidateBoth();
}
