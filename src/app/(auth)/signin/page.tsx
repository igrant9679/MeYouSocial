import Link from "next/link";
import { signIn } from "@/auth";
import { env } from "@/lib/env";
import { redirect } from "next/navigation";
import { SubmitButton } from "@/components/SubmitButton";
import { ValidatedInput } from "@/components/ValidatedInput";

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
  const next = safeNext(String(formData.get("next") ?? "")) ?? "/dashboard";
  try {
    await signIn("credentials", { email, password, redirectTo: next });
  } catch (e) {
    // NEXT_REDIRECT is thrown on success; rethrow so the redirect happens.
    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
    redirect(`/signin?error=1${next !== "/dashboard" ? `&next=${encodeURIComponent(next)}` : ""}`);
  }
}

async function googleAction(formData: FormData) {
  "use server";
  const next = safeNext(String(formData.get("next") ?? "")) ?? "/dashboard";
  await signIn("google", { redirectTo: next });
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string; reset?: string; next?: string }> }) {
  const { error, reset, next: nextRaw } = await searchParams;
  const next = safeNext(nextRaw);
  return (
    <div className="flex-1 grid place-items-center p-6">
      <div className="card w-full max-w-md">
        <h1 className="font-mono font-bold text-xl mb-1">Sign in</h1>
        <p className="text-sm text-[var(--mute)] mb-5">to your MeYouSocial workspace</p>
        {error && <p className="text-sm text-[var(--brand)] mb-3">Invalid email or password.</p>}
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
          {/* The signup link keeps the return path too — an invitee who lands
              here without an account would otherwise sign up bare and lose the
              invite context (the email-claim in signup is the net under this). */}
          <span>No account? <Link href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"} className="text-[var(--accent)] font-semibold">Create one</Link></span>
        </p>
      </div>
    </div>
  );
}
