"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { appEmailFor } from "@/lib/email";
import { getPublicUrl } from "@/lib/public-url";
import { createResetToken, PURPOSE_RESET } from "@/lib/password-reset";
import { hit, requestIp } from "@/lib/rate-limit";

// Password reset, email verification, secure session management,
// per-user activity attribution.
//
// We piggyback on the VerificationToken table that Auth.js already provisions.
// Tokens carry a prefixed identifier so we can distinguish purpose:
//   "reset:<email>"   — password-reset link
//   "verify:<userId>" — first-time email verification

const PURPOSE_VERIFY = "verify:";
const TOKEN_TTL_MS = 1000 * 60 * 60; // 1 hour

// ── Request a password-reset link ────────────────────────────────────────

const resetReqSchema = z.object({ email: z.string().email().transform((s) => s.toLowerCase()) });

export async function requestPasswordResetAction(formData: FormData) {
  const parsed = resetReqSchema.safeParse({ email: formData.get("email") });
  // Always redirect to the same success screen so we don't leak which emails exist.
  if (!parsed.success) redirect("/forgot?ok=1");
  // E-SEC-10: no mail bombing an inbox, no sweeping addresses — and the same screen either way.
  if (!(await hit("resetPerIp", await requestIp())).ok || !(await hit("resetPerEmail", parsed.data.email)).ok) redirect("/forgot?ok=1");

  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (user) {
    const token = await createResetToken(parsed.data.email);
    const origin = await getPublicUrl();
    // From a mailbox of the person's own workspace — the workspace-less sender
    // fell to blocked SMTP and the mock (SHL-01).
    await (await appEmailFor(parsed.data.email)).send({
      to: parsed.data.email,
      subject: "Reset your MeYouSocial password",
      html: `<p>Click below to reset your password (the link expires in 1 hour):</p>
             <p><a href="${origin}/reset/${token}">${origin}/reset/${token}</a></p>
             <p>If you didn't request this, you can ignore the message.</p>`,
    });
  }
  redirect("/forgot?ok=1");
}

// ── Complete the password reset ──────────────────────────────────────────

const resetSchema = z.object({
  token: z.string().min(8).max(120),
  password: z.string().min(8).max(120),
});

export async function completePasswordResetAction(formData: FormData) {
  const parsed = resetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });
  if (!parsed.success) redirect(`/reset/${formData.get("token")}?error=invalid`);
  // E-SEC-10: no guessing tokens.
  if (!(await hit("tokenPerIp", await requestIp())).ok) redirect("/forgot?error=slow-down");

  const record = await db.verificationToken.findUnique({ where: { token: parsed.data.token } });
  if (!record || !record.identifier.startsWith(PURPOSE_RESET) || record.expires < new Date()) {
    redirect("/forgot?error=expired");
  }
  const userEmail = record!.identifier.slice(PURPOSE_RESET.length);
  const user = await db.user.findUnique({ where: { email: userEmail } });
  if (!user) redirect("/forgot?error=expired");

  const hash = await bcrypt.hash(parsed.data.password, 10);
  await db.$transaction([
    db.user.update({ where: { id: user!.id }, data: { passwordHash: hash } }),
    // Burn the token so it can't be reused
    db.verificationToken.delete({ where: { token: parsed.data.token } }),
    // Belt-and-braces: also wipe any other pending reset tokens for this email
    db.verificationToken.deleteMany({ where: { identifier: PURPOSE_RESET + userEmail } }),
  ]);

  redirect("/signin?reset=1");
}

// ── Email verification ───────────────────────────────────────────────────

export async function requestVerificationForUser(userId: string, userEmail: string) {
  // Called server-side from signup. Not a Server Action — invoked from the signup flow.
  const token = nanoid(40);
  await db.verificationToken.create({
    data: {
      identifier: PURPOSE_VERIFY + userId,
      token,
      expires: new Date(Date.now() + TOKEN_TTL_MS * 24), // 1 day for verification
    },
  });
  const origin = await getPublicUrl();
  await (await appEmailFor(userEmail)).send({
    to: userEmail,
    subject: "Verify your MeYouSocial email",
    html: `<p>Welcome! Confirm this is your email address (it also accepts any invitation sent to it):</p>
           <p><a href="${origin}/verify/${token}">${origin}/verify/${token}</a></p>`,
  });
}

export async function verifyEmailAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (!(await hit("tokenPerIp", await requestIp())).ok) redirect("/verify/expired");
  const record = await db.verificationToken.findUnique({ where: { token } });
  if (!record || !record.identifier.startsWith(PURPOSE_VERIFY) || record.expires < new Date()) {
    redirect("/verify/expired");
  }
  const userId = record!.identifier.slice(PURPOSE_VERIFY.length);
  const [user] = await db.$transaction([
    db.user.update({ where: { id: userId }, data: { emailVerified: new Date() } }),
    db.verificationToken.delete({ where: { token } }),
  ]);
  // The address is proven now, so invitations sent to it can be claimed —
  // the safe replacement for sign-up's old claim-by-typed-email.
  const { claimInvitationsForVerifiedEmail } = await import("@/lib/invitations");
  const joined = await claimInvitationsForVerifiedEmail(user.id, user.email);
  if (joined.length > 0) {
    const { cookies } = await import("next/headers");
    const { ACTIVE_WS_COOKIE } = await import("@/lib/acl");
    (await cookies()).set(ACTIVE_WS_COOKIE, joined[0], { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  }
  redirect("/inbox");
}

/** Re-send the verification mail. Called from a signed-in /verify page. */
export async function resendVerificationAction() {
  const { auth } = await import("@/auth");
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const user = await db.user.findUnique({ where: { id: session!.user!.id } });
  if (!user || user.emailVerified) redirect("/inbox");
  if (!(await hit("resendPerUser", user.id)).ok) redirect("/verify/sent");
  await db.verificationToken.deleteMany({ where: { identifier: PURPOSE_VERIFY + user.id } });
  await requestVerificationForUser(user.id, user.email);
  redirect("/verify/sent");
}
