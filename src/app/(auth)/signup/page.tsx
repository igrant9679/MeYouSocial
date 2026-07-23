import Link from "next/link";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { signIn } from "@/auth";
import { requestVerificationForUser } from "@/app/actions/auth-flows";
import { SubmitButton } from "@/components/SubmitButton";
import { ValidatedInput } from "@/components/ValidatedInput";

const schema = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email().transform((s) => s.toLowerCase()),
  password: z.string().min(8).max(120),
});

async function signupAction(formData: FormData) {
  "use server";
  const parsed = schema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) redirect("/signup?error=invalid");

  const existing = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) redirect("/signup?error=exists");

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const user = await db.user.create({
    data: { email: parsed.data.email, name: parsed.data.name, passwordHash },
  });

  // Bootstrap: first user whose email matches BOOTSTRAP_ADMIN_EMAIL joins the demo workspace as ADMIN.
  if (env.BOOTSTRAP_ADMIN_EMAIL && env.BOOTSTRAP_ADMIN_EMAIL === parsed.data.email) {
    const demo = await db.workspace.findFirst({ where: { id: "demo-workspace" } });
    if (demo) {
      await db.membership.upsert({
        where: { userId_workspaceId: { userId: user.id, workspaceId: demo.id } },
        update: { role: "ADMIN" },
        create: { userId: user.id, workspaceId: demo.id, role: "ADMIN" },
      });
    }
  }

  // Invited teammate signing up? Join THEIR company's workspace instead of
  // minting a personal one (which used to strand invited users in a stray
  // tenant). The invite must match the signup email — otherwise ignored, and
  // the /invitations/<token> page can still be accepted after sign-in.
  let joinedInvite = false;
  const inviteToken = String(formData.get("invite") ?? "");
  if (inviteToken) {
    const invite = await db.invitation.findUnique({ where: { token: inviteToken } });
    if (invite && !invite.acceptedAt && invite.expiresAt > new Date() && invite.email === parsed.data.email) {
      await db.$transaction([
        db.membership.create({
          data: { userId: user.id, workspaceId: invite.workspaceId, role: invite.role },
        }),
        db.invitation.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } }),
      ]);
      joinedInvite = true;
    }
  }

  // Otherwise every user starts with a workspace of their own (their company's
  // first workspace — rename it under Admin → Workspace).
  if (!joinedInvite) {
    const personal = await db.workspace.create({
      data: { name: `${parsed.data.name}'s workspace` },
    });
    await db.membership.create({
      data: { userId: user.id, workspaceId: personal.id, role: "ADMIN" },
    });
  }

  // send verification email on signup
  await requestVerificationForUser(user.id, user.email);

  await signIn("credentials", { email: parsed.data.email, password: parsed.data.password, redirectTo: "/dashboard" });
}

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ error?: string; invite?: string }> }) {
  const { error, invite } = await searchParams;
  // Valid pending invite → show who they're joining and skip the personal
  // workspace (they get their company's, with the invited role).
  const pendingInvite = invite
    ? await db.invitation.findFirst({
        where: { token: invite, acceptedAt: null, expiresAt: { gt: new Date() } },
        include: { workspace: { select: { name: true } } },
      })
    : null;
  return (
    <div className="flex-1 grid place-items-center p-6">
      <div className="card w-full max-w-md">
        <h1 className="font-mono font-bold text-xl mb-1">Create your account</h1>
        {pendingInvite ? (
          <p className="text-sm mb-5">
            You&apos;re joining <b>{pendingInvite.workspace.name}</b> as {pendingInvite.role.toLowerCase()}.{" "}
            <span className="text-[var(--mute)]">Sign up with <b>{pendingInvite.email}</b> — the address the invite was sent to.</span>
          </p>
        ) : (
          <p className="text-sm text-[var(--mute)] mb-5">Your company&apos;s workspace is created automatically — invite your team from Admin once you&apos;re in.</p>
        )}
        {error === "exists" && <p className="text-sm text-[var(--brand)] mb-3">An account already exists for that email.</p>}
        {error === "invalid" && <p className="text-sm text-[var(--brand)] mb-3">Please check your details and try again.</p>}
        <form action={signupAction} className="flex flex-col gap-3">
          {pendingInvite && <input type="hidden" name="invite" value={invite} />}
          <ValidatedInput label="Your name" name="name" required maxLength={80} autoComplete="name" className="w-full border border-[var(--line-2)] rounded-lg px-3 py-2 text-sm" />
          <ValidatedInput label="Email" name="email" type="email" required autoComplete="email" className="w-full border border-[var(--line-2)] rounded-lg px-3 py-2 text-sm" />
          <ValidatedInput label="Password" name="password" type="password" required minLength={8} autoComplete="new-password" errorMessage="Use at least 8 characters." className="w-full border border-[var(--line-2)] rounded-lg px-3 py-2 text-sm" />
          <SubmitButton className="btn primary mt-2" pendingText="Creating…">Create account</SubmitButton>
        </form>
        <p className="text-xs text-[var(--mute)] mt-4 text-center">
          Already have an account? <Link href="/signin" className="text-[var(--accent)] font-semibold">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
