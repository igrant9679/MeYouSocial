"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { requireUser, isPlatformOperator, ACTIVE_WS_COOKIE } from "@/lib/acl";
import { writeAudit } from "@/lib/governance";
import { DELETABLE } from "@/lib/deletable";
import { emailFor } from "@/lib/email";
import { getPublicUrl } from "@/lib/public-url";

/**
 * Platform workspace management — the operator's cross-tenant surface
 * (/admin/workspaces). Every action here authorizes by OPERATOR IDENTITY
 * (isPlatformOperator), not by membership: the whole point is managing
 * workspaces the operator is not a member of. That's why these don't run
 * through requireRole or the registry delete action, which both resolve the
 * caller's own membership — the one deliberate exception to "one delete
 * action", documented on platformDeleteWorkspaceAction.
 *
 * Tenant-admin surfaces (/admin) are untouched; this is a superset for one
 * identity, not a new role tier.
 */

const PAGE = "/admin/workspaces";

async function requireOperator() {
  const user = await requireUser();
  if (!isPlatformOperator(user.email)) redirect("/forbidden");
  return user;
}

const back = (msg: string, ok = true): never =>
  redirect(`${PAGE}?${ok ? "flash" : "flashErr"}=${encodeURIComponent(msg)}`);

// ── Workspaces ───────────────────────────────────────────────────────────────

export async function platformCreateWorkspaceAction(formData: FormData) {
  const user = await requireOperator();
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2) back("Give the workspace a name of at least 2 characters.", false);
  if (name.length > 60) back("That name is too long — 60 characters maximum.", false);
  const clash = await db.workspace.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (clash) back(`A workspace called “${clash.name}” already exists.`, false);

  const workspace = await db.workspace.create({ data: { name } });
  await writeAudit({
    workspaceId: workspace.id, actorId: user.id,
    action: "workspace.created", entityType: "workspace", entityId: workspace.id,
    meta: { name, via: "platform" },
  });
  revalidatePath(PAGE);
  back(`Created workspace “${name}”. Add members below, or enter it to configure.`);
}

/**
 * ⚠ Deviation from the "one delete action" rule, on purpose: deleteEntityAction
 * authorizes via requireRole against the workspace being deleted, which the
 * operator may not be a member of. Same shape though — type-to-confirm against
 * the exact name, audit before the row disappears.
 */
export async function platformDeleteWorkspaceAction(formData: FormData) {
  const user = await requireOperator();
  const id = String(formData.get("id") ?? "").trim();
  const confirm = String(formData.get("confirm") ?? "").trim();

  const workspace = await db.workspace.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!workspace) back("That workspace no longer exists.", false);
  if (confirm.toLowerCase() !== workspace!.name.trim().toLowerCase()) {
    back("Type the workspace's name exactly to confirm deletion.", false);
  }

  // Audit FIRST — an audit row naming an id nobody can look up answers nothing.
  await writeAudit({
    workspaceId: id, actorId: user.id,
    action: "entity.deleted", entityType: "workspace", entityId: id,
    meta: { name: workspace!.name, via: "platform" },
  });
  await db.workspace.delete({ where: { id } });

  // If the operator was looking at the deleted workspace, clear the cookie so
  // requireMembership falls back to their first membership instead of a ghost.
  const jar = await cookies();
  if (jar.get(ACTIVE_WS_COOKIE)?.value === id) jar.delete(ACTIVE_WS_COOKIE);

  revalidatePath(PAGE);
  back(`Deleted workspace “${workspace!.name}”.`);
}

/**
 * Enter a workspace: ensure the operator has an active ADMIN membership there,
 * then switch into it. This is what makes "completely manage" real — every
 * existing per-workspace admin surface (settings, keys, connections) works
 * once the operator is inside.
 */
export async function platformEnterWorkspaceAction(formData: FormData) {
  const user = await requireOperator();
  const workspaceId = String(formData.get("id") ?? "").trim();
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true, name: true } });
  if (!workspace) back("That workspace no longer exists.", false);

  await db.membership.upsert({
    where: { userId_workspaceId: { userId: user.id, workspaceId } },
    update: { role: "ADMIN", status: "active" },
    create: { userId: user.id, workspaceId, role: "ADMIN" },
  });
  await writeAudit({
    workspaceId, actorId: user.id,
    action: "membership.entered", entityType: "membership",
    meta: { email: user.email, via: "platform" },
  });
  (await cookies()).set(ACTIVE_WS_COOKIE, workspaceId, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/dashboard");
}

// ── Members ──────────────────────────────────────────────────────────────────

const addSchema = z.object({
  email: z.string().email().transform((s) => s.toLowerCase()),
  role: z.enum(["ADMIN", "EDITOR", "VIEWER"]),
});

/**
 * Add a member to ANY workspace. An existing user is attached directly
 * (reactivating a revoked membership); an unknown email gets an invitation,
 * sent through the TARGET workspace's mailbox — same delivery rules as the
 * tenant-side invite.
 */
export async function platformAddMemberAction(formData: FormData) {
  const user = await requireOperator();
  const workspaceId = String(formData.get("workspaceId") ?? "").trim();
  const parsed = addSchema.safeParse({ email: formData.get("email"), role: formData.get("role") });
  if (!parsed.success) back("Enter a valid email and role.", false);
  const { email, role } = parsed.data!;

  const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true, name: true } });
  if (!workspace) back("That workspace no longer exists.", false);

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    await db.membership.upsert({
      where: { userId_workspaceId: { userId: existing.id, workspaceId } },
      update: { role, status: "active" },
      create: { userId: existing.id, workspaceId, role },
    });
    await writeAudit({
      workspaceId, actorId: user.id,
      action: "membership.added", entityType: "membership",
      meta: { email, role, via: "platform" },
    });
    // An existing account has nothing to "accept", but silent access is how
    // "she never got an email" tickets happen — tell them, when a mailbox can.
    // Best-effort: a failed notification must not roll back the membership.
    let notified = false;
    try {
      const { resolveEmailSender } = await import("@/lib/unipile/accounts");
      if (await resolveEmailSender(workspaceId)) {
        const origin = await getPublicUrl();
        await emailFor(workspaceId).send({
          to: email,
          subject: `You now have access to ${workspace!.name} on MeYouSocial`,
          html: `<p>You've been added to <b>${workspace!.name}</b> as a <b>${role}</b>.</p>
                 <p>Sign in with your existing account: <a href="${origin}/signin">${origin}/signin</a></p>`,
        });
        notified = true;
      }
    } catch {
      // fall through to the honest flash below
    }
    revalidatePath(PAGE);
    back(
      notified
        ? `Added ${email} to “${workspace!.name}” as ${role} and emailed them — they sign in with their existing account.`
        : `Added ${email} to “${workspace!.name}” as ${role}. They already have an account, so there is nothing to accept — but no notification could be emailed (${workspace!.name} has no connected mailbox), so let them know yourself.`,
    );
  }

  const token = nanoid(40);
  await db.invitation.create({
    data: { workspaceId, email, role, token, expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7) },
  });
  const origin = await getPublicUrl();
  const inviteUrl = `${origin}/invitations/${token}`;
  const { resolveEmailSender } = await import("@/lib/unipile/accounts");
  const sender = await resolveEmailSender(workspaceId);
  if (sender) {
    await emailFor(workspaceId).send({
      to: email,
      subject: `You've been invited to ${workspace!.name} on MeYouSocial`,
      html: `<p>You've been invited to join <b>${workspace!.name}</b> as a <b>${role}</b>.</p>
             <p><a href="${inviteUrl}">Accept the invitation</a></p>`,
    });
  }
  revalidatePath(PAGE);
  back(
    sender
      ? `No account for ${email} yet — sent an invitation to join “${workspace!.name}” as ${role}.`
      : `No account for ${email} yet — created an invitation, but ${workspace!.name} has no connected mailbox to send it from. Share the link yourself: ${inviteUrl}`,
  );
}

/** Refuse any change that would leave a workspace with no active admin. */
async function guardLastAdmin(workspaceId: string, membershipId: string) {
  const row = await db.membership.findFirst({
    where: { id: membershipId, workspaceId },
    select: { role: true, status: true },
  });
  if (row?.role === "ADMIN" && row.status === "active") {
    const admins = await db.membership.count({ where: { workspaceId, role: "ADMIN", status: "active" } });
    if (admins <= 1) {
      back("That is the workspace's only active admin — promote someone else first, or the workspace would be left with nobody who can administer it.", false);
    }
  }
}

export async function platformChangeRoleAction(formData: FormData) {
  const user = await requireOperator();
  const workspaceId = String(formData.get("workspaceId") ?? "").trim();
  const membershipId = String(formData.get("membershipId") ?? "").trim();
  const role = String(formData.get("role") ?? "");
  if (!["ADMIN", "EDITOR", "VIEWER"].includes(role)) back("Unknown role.", false);

  if (role !== "ADMIN") await guardLastAdmin(workspaceId, membershipId);
  const updated = await db.membership.updateMany({
    where: { id: membershipId, workspaceId },
    data: { role: role as "ADMIN" | "EDITOR" | "VIEWER" },
  });
  if (!updated.count) back("That membership no longer exists.", false);
  await writeAudit({
    workspaceId, actorId: user.id,
    action: "membership.role_changed", entityType: "membership", entityId: membershipId,
    meta: { role, via: "platform" },
  });
  revalidatePath(PAGE);
  back(`Role updated to ${role}.`);
}

export async function platformToggleMembershipAction(formData: FormData) {
  const user = await requireOperator();
  const workspaceId = String(formData.get("workspaceId") ?? "").trim();
  const membershipId = String(formData.get("membershipId") ?? "").trim();
  const to = String(formData.get("to") ?? "") === "active" ? "active" : "revoked";

  if (to === "revoked") await guardLastAdmin(workspaceId, membershipId);
  const updated = await db.membership.updateMany({
    where: { id: membershipId, workspaceId },
    data: { status: to },
  });
  if (!updated.count) back("That membership no longer exists.", false);
  await writeAudit({
    workspaceId, actorId: user.id,
    action: to === "revoked" ? "membership.revoked" : "membership.reactivated",
    entityType: "membership", entityId: membershipId, meta: { via: "platform" },
  });
  revalidatePath(PAGE);
  back(to === "revoked" ? "Membership revoked — access ends immediately." : "Membership reactivated.");
}

export async function platformRemoveMembershipAction(formData: FormData) {
  const user = await requireOperator();
  const workspaceId = String(formData.get("workspaceId") ?? "").trim();
  const membershipId = String(formData.get("membershipId") ?? "").trim();

  const target = await DELETABLE.membership.find(membershipId, workspaceId);
  if (!target) back("That membership no longer exists.", false);
  try {
    // The registry's remove takes an explicit workspaceId and carries the
    // last-admin guard — reuse it rather than reimplementing the rule.
    await DELETABLE.membership.remove(membershipId, workspaceId);
  } catch (e) {
    back(e instanceof Error ? e.message : "Could not remove that member.", false);
  }
  await writeAudit({
    workspaceId, actorId: user.id,
    action: "entity.deleted", entityType: "membership", entityId: membershipId,
    meta: { name: target!.name, via: "platform" },
  });
  revalidatePath(PAGE);
  back(`Removed ${target!.name}.`);
}
