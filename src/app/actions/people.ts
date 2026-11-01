"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { nanoid } from "nanoid";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { withdrawInvitationsFor } from "@/lib/invitations";
import { joinRefusal } from "@/lib/access-policy";
import { emailFor } from "@/lib/email";
import { getPublicUrl } from "@/lib/public-url";
import { PRODUCT } from "@/lib/product";

// Members, roles and invitations — moved out of the Admin users page (One-Loop
// step 5) so the same panel renders under Settings → People and Settings → People.
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

/**
 * Invite one person, or several at once (E-SET-02): the field takes addresses
 * separated by commas, spaces or new lines (up to 20). Each is checked against
 * the workspace's domains, gets its own invitation and email, and is audited;
 * the flash says who was invited and who wasn't.
 */
export async function inviteAction(formData: FormData) {
  const { workspace, user: actor } = await requireRole("ADMIN");
  const role = String(formData.get("role") ?? "");
  const raw = String(formData.get("email") ?? "");
  const emails = [...new Set(raw.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const to = back(formData);
  if (!emails.length) redirect(`${to}?flashErr=${encodeURIComponent("Enter an email address.")}`);
  if (emails.length > 20) redirect(`${to}?flashErr=${encodeURIComponent("Up to 20 at a time.")}`);
  const invited: string[] = [];
  const refused: string[] = [];
  const origin = await getPublicUrl();
  for (const email of emails) {
    const parsed = inviteSchema.safeParse({ email, role });
    if (!parsed.success) { refused.push(`${email} (not an email address)`); continue; }
    // Only the workspace's own domains, when it set some (E-SEC-08).
    const refusal = await joinRefusal(workspace.id, parsed.data.email);
    if (refusal) { refused.push(`${email} (outside this workspace's domains)`); continue; }
    const token = nanoid(40);
    const invite = await db.invitation.create({
      data: { workspaceId: workspace.id, email: parsed.data.email, role: parsed.data.role, token, expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7) },
    });
    // Recorded like the assistant's invitations always were — an admin invitation
    // also tells every other admin (E-SEC-12).
    await writeAudit({
      workspaceId: workspace.id,
      actorId: actor.id,
      action: "membership.invited",
      entityType: "invitation",
      entityId: invite.id,
      meta: { email: parsed.data.email, role: parsed.data.role },
    });
    await emailFor(workspace.id).send({
      to: parsed.data.email,
      subject: `You've been invited to ${workspace.name} on ${PRODUCT}`,
      html: `<p>You've been invited to join <b>${workspace.name}</b> as a <b>${parsed.data.role}</b>.</p>
           <p><a href="${origin}/invitations/${token}">Accept the invitation</a></p>`,
    }).catch(() => null);
    invited.push(parsed.data.email);
  }
  revalidateBoth();
  const msg = [
    invited.length ? `Invited ${invited.length === 1 ? invited[0] : `${invited.length} people`}.` : "",
    refused.length ? `Not invited: ${refused.join(", ")}.` : "",
  ].filter(Boolean).join(" ");
  redirect(`${to}?${invited.length ? "flash" : "flashErr"}=${encodeURIComponent(msg)}`);
}

/** Send an invitation again with seven more days on it (E-SET-02) — the same link. */
export async function resendInviteAction(formData: FormData) {
  const { workspace, user: actor } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const to = back(formData);
  const invite = await db.invitation.findFirst({ where: { id, workspaceId: workspace.id, acceptedAt: null } });
  if (!invite) redirect(`${to}?flashErr=${encodeURIComponent("That invitation was accepted or withdrawn.")}`);
  const refusal = await joinRefusal(workspace.id, invite!.email);
  if (refusal) redirect(`${to}?flashErr=${encodeURIComponent(refusal)}`);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
  await db.invitation.update({ where: { id: invite!.id }, data: { expiresAt } });
  const origin = await getPublicUrl();
  const sent = await emailFor(workspace.id).send({
    to: invite!.email,
    subject: `Reminder: you've been invited to ${workspace.name} on ${PRODUCT}`,
    html: `<p>You've been invited to join <b>${workspace.name}</b> as a <b>${invite!.role}</b>.</p>
           <p><a href="${origin}/invitations/${invite!.token}">Accept the invitation</a></p>`,
  }).catch(() => null);
  await writeAudit({ workspaceId: workspace.id, actorId: actor.id, action: "membership.invite_resent", entityType: "invitation", entityId: invite!.id, meta: { email: invite!.email } });
  revalidateBoth();
  redirect(`${to}?flash=${encodeURIComponent(`Sent ${invite!.email} the invitation again${sent?.mocked ? " (logged, not delivered — no mailbox is connected; copy the link instead)" : ""} — it now expires in 7 days.`)}`);
}

/** Bring a revoked member back with the role they had (E-SET-02). */
export async function reinstateAction(formData: FormData) {
  const { workspace, user: actor } = await requireRole("ADMIN");
  const userId = String(formData.get("userId") ?? "");
  const to = back(formData);
  const m = await db.membership.findFirst({ where: { workspaceId: workspace.id, userId, status: "revoked" }, include: { user: { select: { email: true } } } });
  if (!m) redirect(`${to}?flashErr=${encodeURIComponent("That member isn't revoked.")}`);
  const refusal = await joinRefusal(workspace.id, m!.user.email);
  if (refusal) redirect(`${to}?flashErr=${encodeURIComponent(refusal)}`);
  await db.membership.update({ where: { id: m!.id }, data: { status: "active" } });
  // An admin coming back is an admin being added — every other admin hears (E-SEC-12).
  await writeAudit({ workspaceId: workspace.id, actorId: actor.id, action: "membership.added", entityType: "membership", entityId: m!.id, meta: { email: m!.user.email, role: m!.role, via: "reinstated" } });
  revalidateBoth();
  redirect(`${to}?flash=${encodeURIComponent(`${m!.user.email} is back as ${m!.role.toLowerCase()}.`)}`);
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
  // An invitation still waiting for this person would let them straight back
  // in — accepting reactivates a membership. Revoking withdraws it too.
  const target = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  await withdrawInvitationsFor(workspace.id, target?.email);
  revalidateBoth();
}

export type ResetLinkState = { link?: string; error?: string } | null;

/**
 * An admin hands a member a password-reset link — the way back in when the
 * reset email can't arrive (no mailbox connected) or never did (SHL-01). The
 * link is returned to the admin's screen, never put in a URL, and is the same
 * one-hour, single-use token the email carries.
 */
export async function issueResetLinkAction(_prev: ResetLinkState, formData: FormData): Promise<ResetLinkState> {
  const { workspace, user: actor } = await requireRole("ADMIN");
  const userId = String(formData.get("userId") ?? "");
  const { canIssueResetLink, createResetToken } = await import("@/lib/password-reset");
  const allowed = await canIssueResetLink(actor.id, workspace.id, userId);
  if (!allowed.ok) return { error: allowed.reason };
  const token = await createResetToken(allowed.email);
  await writeAudit({
    workspaceId: workspace.id,
    actorId: actor.id,
    action: "membership.reset_link_issued",
    entityType: "membership",
    entityId: userId,
    meta: { email: allowed.email },
  });
  return { link: `${(await getPublicUrl()).replace(/\/+$/, "")}/reset/${token}` };
}
