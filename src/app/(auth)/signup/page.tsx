import Link from "next/link";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { signIn } from "@/auth";
import { requestVerificationForUser } from "@/app/actions/auth-flows";
import { claimInvitation, pendingInvitationsFor, sameEmail } from "@/lib/invitations";
import { SubmitButton } from "@/components/SubmitButton";
import { ValidatedInput } from "@/components/ValidatedInput";

const schema = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email().transform((s) => s.toLowerCase()),
  password: z.string().min(8).max(120),
});

// ── Who may create an account ───────────────────────────────────────────────
// Sign-up is by INVITATION unless ALLOW_OPEN_SIGNUP is set. An open form used
// to mint a workspace for anyone on the internet, and a workspace with no keys
// of its own runs on the platform's keys — so a stranger could spend the
// operator's AI budget. The exceptions: a valid invitation link (for exactly
// the address it was sent to), and BOOTSTRAP_ADMIN_EMAIL on a fresh install.
//
// ⚠ Invitations are never claimed by typed email any more. That was how
// "whoever registers an invited address first joins with its role" worked —
// the token is the proof, or (open mode) a verified address, which
// verifyEmailAction claims for. See lib/invitations.ts.

function errorUrl(code: string, invite: string) {
  return `/signup?error=${code}${invite ? `&invite=${encodeURIComponent(invite)}` : ""}`;
}

async function signupAction(formData: FormData) {
  "use server";
  const inviteToken = String(formData.get("invite") ?? "");
  const parsed = schema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) redirect(errorUrl("invalid", inviteToken));
  const data = parsed.data!;
  // E-SEC-10: account creation is slowed per address.
  const { hit, requestIp } = await import("@/lib/rate-limit");
  if (!(await hit("signupPerIp", await requestIp())).ok) redirect(errorUrl("slow-down", inviteToken));

  const invite = inviteToken ? await db.invitation.findUnique({ where: { token: inviteToken } }) : null;
  const inviteLive = Boolean(invite && !invite.acceptedAt && invite.expiresAt > new Date());
  const isBootstrap = Boolean(env.BOOTSTRAP_ADMIN_EMAIL) && env.BOOTSTRAP_ADMIN_EMAIL === data.email;

  if (inviteLive && !sameEmail(invite!.email, data.email)) redirect(errorUrl("wrong-email", inviteToken));
  if (!inviteLive && !isBootstrap && !env.ALLOW_OPEN_SIGNUP) {
    redirect(errorUrl(inviteToken ? "invite-gone" : "invite-only", inviteToken));
  }

  const existing = await db.user.findUnique({ where: { email: data.email } });
  if (existing) redirect(errorUrl("exists", inviteToken));

  const passwordHash = await bcrypt.hash(data.password, 10);
  const user = await db.user.create({
    data: { email: data.email, name: data.name, passwordHash },
  });

  // Bootstrap: first user whose email matches BOOTSTRAP_ADMIN_EMAIL joins the demo workspace as ADMIN.
  if (isBootstrap) {
    const demo = await db.workspace.findFirst({ where: { id: "demo-workspace" } });
    if (demo) {
      await db.membership.upsert({
        where: { userId_workspaceId: { userId: user.id, workspaceId: demo.id } },
        update: { role: "ADMIN" },
        create: { userId: user.id, workspaceId: demo.id, role: "ADMIN" },
      });
    }
  }

  // The invitation they signed up through — their company's workspace, with
  // the invited role (never a stray personal one).
  let joined = false;
  if (inviteLive) joined = await claimInvitation(user.id, invite!);

  // Open sign-up only: a personal workspace, UNLESS invitations are waiting
  // for this address. Those wait for the address to be verified (the
  // onboarding page says so) rather than handing the person a stray tenant.
  if (!joined && !isBootstrap && env.ALLOW_OPEN_SIGNUP) {
    const waiting = await pendingInvitationsFor(data.email);
    if (waiting.length === 0) {
      const personal = await db.workspace.create({ data: { name: `${data.name}'s workspace` } });
      await db.membership.create({ data: { userId: user.id, workspaceId: personal.id, role: "ADMIN" } });
    }
  }

  // send verification email on signup
  await requestVerificationForUser(user.id, user.email);

  await signIn("credentials", { email: data.email, password: data.password, redirectTo: "/inbox" });
}

const ERRORS: Record<string, string> = {
  exists: "An account already exists for that email — sign in instead.",
  invalid: "Please check your details and try again.",
  "wrong-email": "Use the address this invitation was sent to.",
  "invite-gone": "That invitation has already been used or has expired. Ask whoever invited you for a new one.",
  "invite-only": "Accounts are created from an invitation link. Open the link your administrator sent you.",
  "slow-down": "Too many attempts from here — wait a minute and try again.",
};

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
  // A fresh install has nobody to send an invitation, so the form stays open
  // for the bootstrap admin until the first account exists.
  const firstRun = !pendingInvite && !env.ALLOW_OPEN_SIGNUP ? (await db.user.count()) === 0 : false;
  const showForm = Boolean(pendingInvite) || env.ALLOW_OPEN_SIGNUP || firstRun;
  const message = error ? ERRORS[error] : null;

  return (
    <div className="flex-1 grid place-items-center p-6">
      <div className="card w-full max-w-md">
        <h1 className="font-mono font-bold text-xl mb-1">{showForm ? "Create your account" : "Sign-up is by invitation"}</h1>
        {pendingInvite ? (
          <p className="text-sm mb-5">
            You&apos;re joining <b>{pendingInvite.workspace.name}</b> as {pendingInvite.role.toLowerCase()}.{" "}
            <span className="text-[var(--mute)]">Sign up with <b>{pendingInvite.email}</b> — the address the invite was sent to.</span>
          </p>
        ) : showForm ? (
          <p className="text-sm text-[var(--mute)] mb-5">
            {firstRun ? "Set up the first account on this install." : "Your company's workspace is created automatically — invite your team from Settings → People once you're in."}
          </p>
        ) : (
          <p className="text-sm text-[var(--mute)] mb-5">
            Accounts on this install are created from an invitation. Open the link in your invitation email — if you
            can&apos;t find it, an admin of your workspace can copy it for you from Settings → People.
          </p>
        )}
        {message && <p className="text-sm text-[var(--brand)] mb-3" role="alert">{message}</p>}
        {showForm ? (
          <form action={signupAction} className="flex flex-col gap-3">
            {pendingInvite && <input type="hidden" name="invite" value={invite} />}
            <ValidatedInput label="Your name" name="name" required maxLength={80} autoComplete="name" className="w-full border border-[var(--line-2)] rounded-lg px-3 py-2 text-sm" />
            <ValidatedInput label="Email" name="email" type="email" required autoComplete="email" defaultValue={pendingInvite?.email} className="w-full border border-[var(--line-2)] rounded-lg px-3 py-2 text-sm" />
            <ValidatedInput label="Password" name="password" type="password" required minLength={8} autoComplete="new-password" errorMessage="Use at least 8 characters." className="w-full border border-[var(--line-2)] rounded-lg px-3 py-2 text-sm" />
            <SubmitButton className="btn primary mt-2" pendingText="Creating…">Create account</SubmitButton>
          </form>
        ) : (
          <Link href="/signin" className="btn primary">Sign in</Link>
        )}
        <p className="text-xs text-[var(--mute)] mt-4 text-center">
          Already have an account? <Link href={invite ? `/signin?next=${encodeURIComponent(`/invitations/${invite}`)}` : "/signin"} className="text-[var(--accent)] font-semibold">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
