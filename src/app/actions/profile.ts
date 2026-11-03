"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { z } from "zod";
import { isPlatformOperator, requireUser } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { hit } from "@/lib/rate-limit";
import { isTimeZone } from "@/lib/display-zone";
import { EMAIL_CHANGE_PREFIX, soleAdminOf } from "@/lib/account";

/**
 * Personal settings (E-SHL-09): name, password, the zone times are read in, the
 * sign-in email, and deleting the account. Every form says what happened —
 * these used to save silently, or not at all, without a word.
 */

const back = (q: string): never => redirect(`/settings?${q}`);

const profileSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export async function updateProfileAction(formData: FormData) {
  const user = await requireUser();
  const parsed = profileSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) back("error=name#profile");
  await db.user.update({ where: { id: user.id }, data: { name: parsed.data!.name } });
  revalidatePath("/settings");
  back("ok=profile#profile");
}

const passwordSchema = z.object({
  current: z.string().min(1),
  next: z.string().min(8).max(120),
  confirm: z.string(),
});

export async function changePasswordAction(formData: FormData) {
  const user = await requireUser();
  const parsed = passwordSchema.safeParse({
    current: formData.get("current"),
    next: formData.get("next"),
    confirm: formData.get("confirm") ?? "",
  });
  if (!parsed.success) back("error=invalid#password");
  if (parsed.data!.next !== parsed.data!.confirm) back("error=mismatch#password");
  // No password set (e.g. SSO-only): the forgot-password flow sets one.
  if (!user.passwordHash) back("error=nopass#password");
  if (!(await bcrypt.compare(parsed.data!.current, user.passwordHash!))) back("error=wrongpass#password");
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(parsed.data!.next, 10) } });
  back("ok=password#password");
}

/** The zone this person reads times in; blank goes back to each workspace's posting zone. */
export async function setTimeZoneAction(formData: FormData) {
  const user = await requireUser();
  const raw = String(formData.get("timeZone") ?? "").trim();
  if (raw && !isTimeZone(raw)) back("error=zone#zone");
  await db.user.update({ where: { id: user.id }, data: { timeZone: raw || null } });
  revalidatePath("/", "layout");
  back("ok=zone#zone");
}

// ── Changing the sign-in email ──────────────────────────────────────────────
// The new address must prove itself: a link goes there, and nothing changes
// until it's opened and confirmed. The old address is told, so a change made
// from a stolen session doesn't go unnoticed. One pending change at a time.

const EMAIL_CHANGE_TTL_MS = 24 * 3600_000;

export async function requestEmailChangeAction(formData: FormData) {
  const user = await requireUser();
  const next = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!z.string().email().max(200).safeParse(next).success) back("error=email-invalid#email");
  if (next === user.email.toLowerCase()) back("error=email-same#email");
  if (isPlatformOperator(user.email)) back("error=email-operator#email");
  if (user.passwordHash && !(await bcrypt.compare(password, user.passwordHash))) back("error=email-password#email");
  if (!(await hit("resendPerUser", user.id)).ok) back("error=email-slow#email");
  // A workspace that takes only some domains holds every member to them (E-SEC-08).
  const { joinRefusal } = await import("@/lib/access-policy");
  for (const m of user.memberships.filter((x) => x.status === "active")) {
    if (await joinRefusal(m.workspaceId, next)) back(`error=email-domain&ws=${encodeURIComponent(m.workspace.name)}#email`);
  }
  // Said the same way whether or not the address has an account here.
  if (await db.user.findUnique({ where: { email: next }, select: { id: true } })) back("error=email-taken#email");

  await db.verificationToken.deleteMany({ where: { identifier: { startsWith: `${EMAIL_CHANGE_PREFIX}${user.id}:` } } });
  const token = nanoid(40);
  await db.verificationToken.create({ data: { identifier: `${EMAIL_CHANGE_PREFIX}${user.id}:${next}`, token, expires: new Date(Date.now() + EMAIL_CHANGE_TTL_MS) } });
  const [{ appEmailFor }, { getPublicUrl }] = await Promise.all([import("@/lib/email"), import("@/lib/public-url")]);
  const origin = await getPublicUrl();
  await (await appEmailFor(next)).send({
    to: next,
    subject: "Confirm your new MeYouSocial sign-in email",
    html: `<p>${user.name ?? user.email} asked to sign in to MeYouSocial with this address from now on.</p>
           <p>Confirm it here (the link works for a day): <a href="${origin}/verify/email/${token}">${origin}/verify/email/${token}</a></p>
           <p>If that wasn't you, ignore this — nothing changes.</p>`,
  }).catch(() => {});
  await (await appEmailFor(user.email)).send({
    to: user.email,
    subject: "Your MeYouSocial sign-in email is being changed",
    html: `<p>Someone signed in as you asked to change your sign-in email to ${next}. It changes only when that address confirms.</p>
           <p>If this wasn't you, change your password now and cancel it under Settings → Profile.</p>`,
  }).catch(() => {});
  back("ok=email-sent#email");
}

export async function cancelEmailChangeAction() {
  const user = await requireUser();
  await db.verificationToken.deleteMany({ where: { identifier: { startsWith: `${EMAIL_CHANGE_PREFIX}${user.id}:` } } });
  back("ok=email-cancelled#email");
}

/** From the link in the new address's mailbox: the token alone proves it, so no sign-in is needed. */
export async function confirmEmailChangeAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const { requestIp } = await import("@/lib/rate-limit");
  if (!(await hit("tokenPerIp", await requestIp())).ok) redirect("/verify/expired");
  const row = await db.verificationToken.findUnique({ where: { token } });
  if (!row || !row.identifier.startsWith(EMAIL_CHANGE_PREFIX) || row.expires < new Date()) redirect("/verify/expired");
  const rest = row!.identifier.slice(EMAIL_CHANGE_PREFIX.length);
  const userId = rest.slice(0, rest.indexOf(":"));
  const next = rest.slice(rest.indexOf(":") + 1);
  const user = await db.user.findUnique({ where: { id: userId }, include: { memberships: { where: { status: "active" } } } });
  if (!user || user.deletedAt) redirect("/verify/expired");
  // Taken meanwhile: refuse rather than collide on the unique address.
  if (await db.user.findUnique({ where: { email: next }, select: { id: true } })) {
    await db.verificationToken.delete({ where: { token } }).catch(() => {});
    redirect("/verify/email/taken");
  }
  const was = user!.email;
  await db.$transaction([
    db.user.update({ where: { id: user!.id }, data: { email: next, emailVerified: new Date() } }),
    db.verificationToken.deleteMany({ where: { identifier: { startsWith: `${EMAIL_CHANGE_PREFIX}${user!.id}:` } } }),
  ]);
  for (const m of user!.memberships) {
    await writeAudit({ workspaceId: m.workspaceId, actorId: user!.id, action: "account.email_changed", entityType: "user", entityId: user!.id, meta: { email: was, to: next } });
  }
  redirect("/settings?ok=email-changed#email");
}

// ── Deleting the account ────────────────────────────────────────────────────
// Not a row delete: articles, scripts, comments and the audit log point at
// people, and a script chat REQUIRES its author. The account's personal data
// goes — name, address, password, two-factor, sign-ins, memberships,
// notifications, preferences, its API tokens — and the row stays as "Deleted
// user" with `deletedAt`, which getCurrentUser treats as signed out.

export async function deleteMyAccountAction(formData: FormData) {
  const user = await requireUser();
  const typed = String(formData.get("confirmEmail") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (isPlatformOperator(user.email)) back("error=delete-operator#delete");
  if (typed !== user.email.toLowerCase()) back("error=delete-confirm#delete");
  if (user.passwordHash && !(await bcrypt.compare(password, user.passwordHash))) back("error=delete-password#delete");
  const sole = await soleAdminOf(user.id);
  if (sole.length) back(`error=delete-sole&ws=${encodeURIComponent(sole.join(", "))}#delete`);

  const workspaces = user.memberships.filter((m) => m.status === "active").map((m) => m.workspaceId);
  for (const ws of workspaces) {
    await writeAudit({ workspaceId: ws, actorId: user.id, action: "account.deleted", entityType: "user", entityId: user.id, meta: { email: user.email } });
  }
  await db.$transaction([
    db.membership.deleteMany({ where: { userId: user.id } }),
    db.account.deleteMany({ where: { userId: user.id } }),
    db.session.deleteMany({ where: { userId: user.id } }),
    db.notification.deleteMany({ where: { userId: user.id } }),
    db.notificationPreference.deleteMany({ where: { userId: user.id } }),
    db.apiToken.updateMany({ where: { createdById: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    db.verificationToken.deleteMany({ where: { identifier: { contains: user.id } } }),
    db.user.update({
      where: { id: user.id },
      data: {
        name: "Deleted user", email: `deleted-${user.id}@deleted.invalid`, emailVerified: null, image: null,
        passwordHash: null, totpSecret: null, totpEnabledAt: null, totpLastStep: null, totpRecovery: null,
        timeZone: null, deletedAt: new Date(),
      },
    }),
  ]);
  const { signOut } = await import("@/auth");
  await signOut({ redirectTo: "/signin?deleted=1" });
}
