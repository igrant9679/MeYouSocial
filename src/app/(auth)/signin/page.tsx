import Link from "next/link";
import { cookies } from "next/headers";
import { CredentialsSignin } from "next-auth";
import { signIn } from "@/auth";
import { env } from "@/lib/env";
import { redirect } from "next/navigation";
import { SubmitButton } from "@/components/SubmitButton";
import { ValidatedInput } from "@/components/ValidatedInput";
import { PRODUCT } from "@/lib/product";

/**
 * Only ever bounce to a path INSIDE this app. `next` is attacker-writable (it
 * arrives in the URL), so an absolute URL or protocol-relative `//host` would
 * be an open redirect off the back of a successful sign-in.
 */
function safeNext(raw: string | undefined): string | null {
  if (!raw) return null;
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : null;
}

async function signinAction(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  // Carried through the form so the invitation flow survives the sign-in
  // detour: accepting while signed out sends people here with
  // ?next=/invitations/<token>, and dropping it stranded invitees on the
  // dashboard with the invite still pending (field case 2026-08-07).
  const next = safeNext(String(formData.get("next") ?? "")) ?? "/inbox";
  const nextQ = next !== "/inbox" ? `&next=${encodeURIComponent(next)}` : "";
  try {
    await signIn("credentials", { email, password, redirectTo: next });
  } catch (e) {
    // NEXT_REDIRECT is thrown on success; rethrow so the redirect happens.
    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
    // Right password, two-factor on (E-SEC-07): leave a five-minute signed token
    // and ask for the code — the password is never asked for or carried again.
    if (e instanceof CredentialsSignin && e.code === "second_factor") {
      const { pendingToken, PENDING_COOKIE, PENDING_MS } = await import("@/lib/two-factor");
      const { db } = await import("@/lib/db");
      const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true } });
      if (user) {
        (await cookies()).set(PENDING_COOKIE, pendingToken(user.id), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/signin", maxAge: PENDING_MS / 1000 });
        redirect(`/signin?step=code${nextQ}`);
      }
    }
    redirect(`/signin?error=1${nextQ}`);
  }
}

/** Step two: the code from the authenticator app, or a recovery code. */
async function codeAction(formData: FormData) {
  "use server";
  const next = safeNext(String(formData.get("next") ?? "")) ?? "/inbox";
  const nextQ = next !== "/inbox" ? `&next=${encodeURIComponent(next)}` : "";
  const { PENDING_COOKIE } = await import("@/lib/two-factor");
  const jar = await cookies();
  const pending = jar.get(PENDING_COOKIE)?.value ?? "";
  if (!pending) redirect(`/signin?error=expired${nextQ}`);
  try {
    await signIn("credentials", { pending, code: String(formData.get("code") ?? ""), redirectTo: next });
  } catch (e) {
    if (e instanceof Error && e.message === "NEXT_REDIRECT") {
      jar.delete({ name: PENDING_COOKIE, path: "/signin" });
      throw e;
    }
    redirect(`/signin?step=code&error=code${nextQ}`);
  }
}

async function googleAction(formData: FormData) {
  "use server";
  const next = safeNext(String(formData.get("next") ?? "")) ?? "/inbox";
  await signIn("google", { redirectTo: next });
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string; reset?: string; next?: string; step?: string }> }) {
  const { error, reset, next: nextRaw, step } = await searchParams;
  const next = safeNext(nextRaw);
  if (step === "code") {
    const { PENDING_COOKIE } = await import("@/lib/two-factor");
    // No pending step (expired, or opened directly): back to the password.
    if (!(await cookies()).get(PENDING_COOKIE)?.value) redirect(`/signin?error=expired${next ? `&next=${encodeURIComponent(next)}` : ""}`);
    return (
      <div className="flex-1 grid place-items-center p-6">
        <div className="card w-full max-w-md">
          <h1 className="font-mono font-bold text-xl mb-1">Two-factor sign-in</h1>
          <p className="text-sm text-[var(--mute)] mb-5">Enter the six-digit code from your authenticator app, or one of your recovery codes.</p>
          {error === "code" && <p className="text-sm text-[var(--brand)] mb-3">That code didn&apos;t work. Codes change every 30 seconds; each works once.</p>}
          <form action={codeAction} className="flex flex-col gap-3">
            {next && <input type="hidden" name="next" value={next} />}
            <ValidatedInput label="Code" name="code" required autoComplete="one-time-code" inputMode="text" className="w-full border border-[var(--line-2)] rounded-lg px-3 py-2 text-sm font-mono tracking-widest" />
            <SubmitButton className="btn primary mt-2" pendingText="Checking…">Sign in</SubmitButton>
          </form>
          <p className="text-xs text-[var(--mute)] mt-4"><Link href="/signin" className="text-[var(--mute)] hover:text-[var(--accent)]">Start again</Link> · Lost your device and your recovery codes? Ask the platform administrator to turn two-factor off for you.</p>
        </div>
      </div>
    );
  }
  const inviteToken = next?.match(/^\/invitations\/([A-Za-z0-9_-]{10,80})$/)?.[1] ?? null;
  return (
    <div className="flex-1 grid place-items-center p-6">
      <div className="card w-full max-w-md">
        <h1 className="font-mono font-bold text-xl mb-1">Sign in</h1>
        <p className="text-sm text-[var(--mute)] mb-5">to {PRODUCT}</p>
        {error === "expired" ? <p className="text-sm text-[var(--brand)] mb-3">That sign-in took more than five minutes — enter your password again.</p>
          : error && <p className="text-sm text-[var(--brand)] mb-3">Invalid email or password.</p>}
        {reset === "1" && <p className="text-sm bg-[var(--green-soft)] text-[var(--green)] rounded-md px-3 py-2 mb-3">Password updated. Sign in with your new password.</p>}
        <form action={signinAction} className="flex flex-col gap-3">
          {next && <input type="hidden" name="next" value={next} />}
          <ValidatedInput label="Email" name="email" type="email" required autoComplete="email" className="w-full border border-[var(--line-2)] rounded-lg px-3 py-2 text-sm" />
          <ValidatedInput label="Password" name="password" type="password" required minLength={8} autoComplete="current-password" className="w-full border border-[var(--line-2)] rounded-lg px-3 py-2 text-sm" />
          <SubmitButton className="btn primary mt-2" pendingText="Signing in…">Sign in</SubmitButton>
        </form>
        {env.ENABLE_GOOGLE_SSO && (
          <form action={googleAction} className="mt-3">
            {next && <input type="hidden" name="next" value={next} />}
            <SubmitButton className="btn w-full" pendingText="Redirecting…">Continue with Google</SubmitButton>
          </form>
        )}
        <p className="text-xs text-[var(--mute)] mt-4 text-center flex items-center justify-between">
          <Link href="/forgot" className="text-[var(--mute)] hover:text-[var(--accent)]">Forgot password?</Link>
          {/* An invitee bounced here from /invitations/<token> keeps the token:
              sign-up is invitation-only unless ALLOW_OPEN_SIGNUP, and the token
              is what lets them in. Nobody else is offered a sign-up link. */}
          {inviteToken ? (
            <span>No account? <Link href={`/signup?invite=${encodeURIComponent(inviteToken)}`} className="text-[var(--accent)] font-semibold">Create one</Link></span>
          ) : env.ALLOW_OPEN_SIGNUP ? (
            <span>No account? <Link href="/signup" className="text-[var(--accent)] font-semibold">Create one</Link></span>
          ) : null}
        </p>
      </div>
    </div>
  );
}
