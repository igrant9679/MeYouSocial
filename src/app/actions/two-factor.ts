"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser, requireRole, isPlatformOperator } from "@/lib/acl";
import { writeAudit } from "@/lib/governance";
import { getSetting, setWorkspaceSetting } from "@/lib/settings";
import { newTotpSecret, matchStep, newRecoveryCodes, hashRecoveryCode } from "@/lib/totp";
import { storeSecret, readSecret, checkSecondFactor, REQUIRE_SETTING, CODES_COOKIE } from "@/lib/two-factor";

// Two-factor sign-in (E-SEC-07): each person's own, from /account/two-factor.
// Every change is recorded in each workspace they belong to; turning it off
// tells those workspaces' admins (security notices).

const PAGE = "/account/two-factor";

/**
 * New recovery codes are shown on the page through a two-minute, encrypted,
 * httpOnly cookie scoped to it — not client state, which the page's own
 * re-render (now "on") threw away before anyone saw them.
 */
async function showCodes(codes: string[]): Promise<never> {
  (await cookies()).set(CODES_COOKIE, storeSecret(codes.join(",")), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: PAGE, maxAge: 120 });
  redirect(`${PAGE}?codes=1`);
}

/** "I've saved them": the codes leave the cookie and the page. */
export async function savedRecoveryCodesAction() {
  (await cookies()).delete({ name: CODES_COOKIE, path: PAGE });
  redirect("/inbox");
}

async function auditEverywhere(userId: string, action: string, meta: Record<string, unknown>, actorId: string = userId) {
  const memberships = await db.membership.findMany({ where: { userId, status: "active" }, select: { workspaceId: true } });
  for (const m of memberships) await writeAudit({ workspaceId: m.workspaceId, actorId, action, entityType: "user", entityId: userId, meta });
}

async function fresh(userId: string) {
  return db.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, totpSecret: true, totpEnabledAt: true, totpLastStep: true, totpRecovery: true } });
}

async function slowed(userId: string): Promise<boolean> {
  const { hit } = await import("@/lib/rate-limit");
  return !(await hit("totpPerUser", userId)).ok;
}

/** Step one of setting up: a new secret, kept until a code proves the app has it. */
export async function startTwoFactorAction() {
  const user = await requireUser();
  const me = await fresh(user.id);
  if (me.totpEnabledAt) redirect(PAGE);
  await db.user.update({ where: { id: user.id }, data: { totpSecret: storeSecret(newTotpSecret()), totpLastStep: null } });
  redirect(`${PAGE}?setup=1`);
}

/** Step two: the app's current code turns it on; the recovery codes are shown once. */
export async function confirmTwoFactorAction(formData: FormData) {
  const user = await requireUser();
  const fail = (m: string) => redirect(`${PAGE}?setup=1&err=${encodeURIComponent(m)}`);
  if (await slowed(user.id)) fail("Too many tries — wait a few minutes.");
  const me = await fresh(user.id);
  if (me.totpEnabledAt) redirect(PAGE);
  const secret = readSecret(me.totpSecret);
  if (!secret) redirect(`${PAGE}?err=${encodeURIComponent("The setup expired — start again.")}`);
  const step = matchStep(secret!, String(formData.get("code") ?? ""), null);
  if (step === null) fail("That code didn't match. Check your phone's clock is set automatically, and type the code showing now.");
  const codes = newRecoveryCodes();
  const { count } = await db.user.updateMany({ where: { id: user.id, totpEnabledAt: null }, data: { totpEnabledAt: new Date(), totpLastStep: step, totpRecovery: JSON.stringify(codes.map(hashRecoveryCode)) } });
  if (!count) redirect(PAGE);
  await auditEverywhere(user.id, "security.2fa_enabled", { email: me.email });
  await showCodes(codes);
}

/** New recovery codes (the old ones stop working) — needs a current code. */
export async function renewRecoveryCodesAction(formData: FormData) {
  const user = await requireUser();
  const fail = (m: string) => redirect(`${PAGE}?err=${encodeURIComponent(m)}`);
  if (await slowed(user.id)) fail("Too many tries — wait a few minutes.");
  const me = await fresh(user.id);
  if (!me.totpEnabledAt) fail("Two-factor isn't on.");
  if (!(await checkSecondFactor(me, String(formData.get("code") ?? "")))) fail("That code didn't work.");
  const codes = newRecoveryCodes();
  await db.user.update({ where: { id: user.id }, data: { totpRecovery: JSON.stringify(codes.map(hashRecoveryCode)) } });
  await auditEverywhere(user.id, "security.2fa_recovery_renewed", { email: me.email });
  await showCodes(codes);
}

/** Workspaces where this person is an admin and two-factor is required of admins. */
async function requiringWorkspaces(userId: string): Promise<string[]> {
  const admin = await db.membership.findMany({ where: { userId, status: "active", role: "ADMIN" }, select: { workspaceId: true, workspace: { select: { name: true } } } });
  const out: string[] = [];
  for (const m of admin) if ((await getSetting(REQUIRE_SETTING, m.workspaceId)) === "true") out.push(m.workspace.name);
  return out;
}

/** Turn it off — needs a code (or a recovery code); refused where a workspace requires it. */
export async function disableTwoFactorAction(formData: FormData) {
  const user = await requireUser();
  const back = (q: string) => redirect(`${PAGE}?${q}`);
  if (await slowed(user.id)) back("err=" + encodeURIComponent("Too many tries — wait a few minutes."));
  const me = await fresh(user.id);
  if (!me.totpEnabledAt) back("err=" + encodeURIComponent("Two-factor isn't on."));
  const requiring = await requiringWorkspaces(user.id);
  if (requiring.length) back("err=" + encodeURIComponent(`${requiring.join(", ")} require${requiring.length === 1 ? "s" : ""} two-factor for admins, so it stays on.`));
  if (!(await checkSecondFactor(me, String(formData.get("code") ?? "")))) back("err=" + encodeURIComponent("That code didn't work."));
  await db.user.update({ where: { id: user.id }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, totpRecovery: null } });
  await auditEverywhere(user.id, "security.2fa_disabled", { email: me.email });
  back("ok=" + encodeURIComponent("Two-factor sign-in is off."));
}

/**
 * The platform operator turns it off for someone who lost their device and
 * their recovery codes. Audited in each of their workspaces, whose admins are told.
 */
export async function resetTwoFactorAction(formData: FormData) {
  const { user } = await requireRole("ADMIN");
  if (!isPlatformOperator(user.email)) redirect("/forbidden?why=operator");
  const userId = String(formData.get("userId") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "/setup/people");
  const safe = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/setup/people";
  const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, totpEnabledAt: true } });
  if (!target?.totpEnabledAt) redirect(`${safe}?flashErr=${encodeURIComponent("That person doesn't have two-factor on.")}`);
  await db.user.update({ where: { id: userId }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, totpRecovery: null } });
  await auditEverywhere(userId, "security.2fa_reset", { email: target.email }, user.id);
  revalidatePath(safe);
  redirect(`${safe}?flash=${encodeURIComponent(`Two-factor is off for ${target.email} — they can set it up again from their settings.`)}`);
}

/** Require two-factor of this workspace's admins (or stop requiring it). */
export async function requireTwoFactorAction(formData: FormData) {
  const { workspace, user } = await requireRole("ADMIN");
  const on = formData.get("intent") === "on";
  const back = (q: string) => redirect(`/setup/people?${q}`);
  if (on && !user.totpEnabledAt) back("flashErr=" + encodeURIComponent("Turn on two-factor for yourself first (Settings → Two-factor sign-in)."));
  await setWorkspaceSetting(workspace.id, REQUIRE_SETTING, on ? "true" : "");
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "security.2fa_requirement_changed", entityType: "workspace", entityId: workspace.id, meta: { required: on } });
  revalidatePath("/setup/people");
  back("flash=" + encodeURIComponent(on ? "Two-factor is now required for this workspace's admins — those without it are asked to set it up." : "Two-factor is no longer required for admins."));
}
