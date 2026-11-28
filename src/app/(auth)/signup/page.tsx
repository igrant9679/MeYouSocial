import Link from "next/link";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { signIn } from "@/auth";
import { requestVerificationForUser } from "@/app/actions/auth-flows";
import { claimInvitation, pendingInvitationsFor, sameEmail } from "@/lib/invitations";
import { trialPolicy } from "@/lib/trial-policy";
import { startTrialWorkspace, trialRefusal, TRIAL_REFUSAL_COPY } from "@/lib/workspace-signup";
import { SubmitButton } from "@/components/SubmitButton";
import { ValidatedInput } from "@/components/ValidatedInput";

const schema = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email().transform((s) => s.toLowerCase()),
  password: z.string().min(8).max(120),
  workspace: z.string().max(80).optional(),
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
//
// ── The free trial (2026-11-26, the owner's "14-day trial") ─────────────────
// With trials on (Settings → Sign-ups; OFF by default, 14 days suggested), the form is open
// to anyone and makes a TRIAL workspace (lib/workspace-signup.ts): the platform's
// keys, an AI allowance, an end date, one per person, a few per address a day,
// a cap on trials running at once. When the trial ends or runs out the workspace
// is held, never deleted (lib/workspace-hold.ts); a meyousocial.com membership
// for the same address keeps it going (lib/membership/process.ts). Trials off →
// back to invitations (or ALLOW_OPEN_SIGNUP's untimed workspace, as before), and
// the page sends everyone else to the membership page (signup:membership_url) —
// the owner's "Send them to meyousocial.com", 2026-11-28.

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
    workspace: formData.get("workspace") ?? undefined,
  });
  if (!parsed.success) redirect(errorUrl("invalid", inviteToken));
  const data = parsed.data!;
  // E-SEC-10: account creation is slowed per address.
  const { hit, requestIp } = await import("@/lib/rate-limit");
  if (!(await hit("signupPerIp", await requestIp())).ok) redirect(errorUrl("slow-down", inviteToken));

  const invite = inviteToken ? await db.invitation.findUnique({ where: { token: inviteToken }, include: { workspace: { select: { deletedAt: true } } } }) : null;
  const inviteLive = Boolean(invite && !invite.acceptedAt && invite.expiresAt > new Date() && !invite.workspace.deletedAt);
  const isBootstrap = Boolean(env.BOOTSTRAP_ADMIN_EMAIL) && env.BOOTSTRAP_ADMIN_EMAIL === data.email;

  if (inviteLive && !sameEmail(invite!.email, data.email)) redirect(errorUrl("wrong-email", inviteToken));
  // A trial is the door for everyone else, while trials are on.
  const trialMode = !inviteLive && !isBootstrap && (await trialPolicy()).days > 0;
  if (!inviteLive && !isBootstrap && !trialMode && !env.ALLOW_OPEN_SIGNUP) {
    redirect(errorUrl(inviteToken ? "invite-gone" : "invite-only", inviteToken));
  }
  if (trialMode) {
    if (!(await hit("trialSignupPerIp", await requestIp())).ok) redirect(errorUrl("trial-slow", ""));
    const refused = await trialRefusal({});
    if (refused) redirect(errorUrl(`trial-${refused}`, ""));
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

  // A trial workspace, UNLESS invitations are waiting for this address (a
  // meyousocial.com member who came here instead of through their link, a
  // colleague's invitation): those wait for the link or a verified address, and
  // the onboarding page says so. A refusal that raced in lands there too.
  if (!joined && trialMode) {
    const waiting = await pendingInvitationsFor(data.email);
    if (waiting.length === 0) await startTrialWorkspace(user, data.workspace ?? "");
  }

  // Open sign-up only: a personal workspace, UNLESS invitations are waiting
  // for this address. Those wait for the address to be verified (the
  // onboarding page says so) rather than handing the person a stray tenant.
  if (!joined && !isBootstrap && !trialMode && env.ALLOW_OPEN_SIGNUP) {
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
  "invite-only": "New accounts start with a membership at meyousocial.com. If your company invited you, open the link in your invitation email.",
  "slow-down": "Too many attempts from here — wait a minute and try again.",
  "trial-slow": "Several free trials have already started from here today — try again tomorrow, or become a member at meyousocial.com.",
  "trial-off": TRIAL_REFUSAL_COPY.off,
  "trial-full": TRIAL_REFUSAL_COPY.full,
  "trial-used": TRIAL_REFUSAL_COPY.used,
};

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ error?: string; invite?: string }> }) {
  const { error, invite } = await searchParams;
  // Valid pending invite → show who they're joining and skip the personal
  // workspace (they get their company's, with the invited role).
  const pendingInvite = invite
    ? await db.invitation.findFirst({
        where: { token: invite, acceptedAt: null, expiresAt: { gt: new Date() }, workspace: { deletedAt: null } },
        include: { workspace: { select: { name: true } } },
      })
    : null;
  // A fresh install has nobody to send an invitation, so the form stays open
  // for the bootstrap admin until the first account exists.
  const firstRun = !pendingInvite && !env.ALLOW_OPEN_SIGNUP ? (await db.user.count()) === 0 : false;
  // The free trial (lib/trial-policy.ts): open to anyone while trials are on and not full.
  const policy = await trialPolicy();
  const trialOpen = !pendingInvite && !firstRun && policy.days > 0;
  const trialRefused = trialOpen ? await trialRefusal({}, policy) : null;
  const trial = trialOpen && !trialRefused;
  const showForm = Boolean(pendingInvite) || trial || (!trialOpen && env.ALLOW_OPEN_SIGNUP) || firstRun;
  const message = error ? ERRORS[error] : null;
  const allowance = [
    policy.tokenCap > 0 ? `${policy.tokenCap.toLocaleString("en-GB")} tokens of AI writing` : null,
    policy.imageCap > 0 ? `${policy.imageCap} generated pictures` : null,
  ].filter(Boolean).join(" and ");

  return (
    <div className="flex-1 grid place-items-center p-6">
      <div className="card w-full max-w-md">
        <h1 className="font-mono font-bold text-xl mb-1">
          {trial ? "Start your free trial" : showForm ? "Create your account" : trialRefused ? "Free trials are paused" : "Sign up at meyousocial.com"}
        </h1>
        {pendingInvite ? (
          <p className="text-sm mb-5">
            You&apos;re joining <b>{pendingInvite.workspace.name}</b> as {pendingInvite.role.toLowerCase()}.{" "}
            <span className="text-[var(--mute)]">Sign up with <b>{pendingInvite.email}</b> — the address the invite was sent to.</span>
          </p>
        ) : trial ? (
          <div className="text-sm text-[var(--mute)] mb-5 space-y-2" data-trial-terms>
            <p className="m-0">
              A workspace of your own for <b className="text-[var(--ink)]">{policy.days} days</b>, running on MeYouSocial&apos;s AI
              {allowance ? <> with an allowance of {allowance}</> : null}. No card needed. Video rendering starts with a membership.
            </p>
            <p className="m-0">
              Keep it going with a membership at <a href={policy.membershipUrl} className="text-[var(--accent-on)] font-semibold">meyousocial.com</a> using
              the same email. When a trial ends, the workspace is paused, never deleted.
            </p>
          </div>
        ) : trialRefused ? (
          <p className="text-sm text-[var(--mute)] mb-5">
            {TRIAL_REFUSAL_COPY[trialRefused]} Already invited by your company? Open the link in your invitation email.
          </p>
        ) : showForm ? (
          <p className="text-sm text-[var(--mute)] mb-5">
            {firstRun ? "Set up the first account on this install." : "Your company's workspace is created automatically — invite your team from Settings → People once you're in."}
          </p>
        ) : (
          // Everyone signs up through meyousocial.com for now (2026-11-28, the owner's "Send them to
          // meyousocial.com"): a membership there makes the Publisher workspace and sends the set-up link.
          <div className="text-sm text-[var(--mute)] mb-5 space-y-2" data-membership-door>
            <p className="m-0">
              A Publisher account comes with a MeYouSocial membership. Choose one at meyousocial.com; once it starts,
              you get a link to set up your Publisher workspace.
            </p>
            <p className="m-0">
              Invited to your company&apos;s workspace? Open the link in your invitation email. An admin of that workspace can
              copy it for you from Settings → People.
            </p>
          </div>
        )}
        {message && <p className="text-sm text-[var(--brand-on)] mb-3" role="alert">{message}</p>}
        {showForm ? (
          <form action={signupAction} className="flex flex-col gap-3">
            {pendingInvite && <input type="hidden" name="invite" value={invite} />}
            <ValidatedInput label="Your name" name="name" required maxLength={80} autoComplete="name" className="w-full border border-[var(--line-2)] rounded-lg px-3 py-2 text-sm" />
            <ValidatedInput label="Email" name="email" type="email" required autoComplete="email" defaultValue={pendingInvite?.email} className="w-full border border-[var(--line-2)] rounded-lg px-3 py-2 text-sm" />
            <ValidatedInput label="Password" name="password" type="password" required minLength={8} autoComplete="new-password" errorMessage="Use at least 8 characters." className="w-full border border-[var(--line-2)] rounded-lg px-3 py-2 text-sm" />
            {trial && (
              <ValidatedInput label="Company or workspace name" name="workspace" required minLength={2} maxLength={60} autoComplete="organization" placeholder="Acme Ltd" className="w-full border border-[var(--line-2)] rounded-lg px-3 py-2 text-sm" />
            )}
            <SubmitButton className="btn primary mt-2" pendingText="Creating…">{trial ? `Start my ${policy.days}-day trial` : "Create account"}</SubmitButton>
          </form>
        ) : trialRefused ? (
          <Link href="/signin" className="btn primary">Sign in</Link>
        ) : (
          <a href={policy.membershipUrl} className="btn primary" data-membership-link>See the memberships</a>
        )}
        <p className="text-xs text-[var(--mute)] mt-4 text-center">
          Already have an account? <Link href={invite ? `/signin?next=${encodeURIComponent(`/invitations/${invite}`)}` : "/signin"} className="text-[var(--accent-on)] font-semibold">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
