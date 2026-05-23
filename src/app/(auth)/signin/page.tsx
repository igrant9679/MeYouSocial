import Link from "next/link";
import { signIn } from "@/auth";
import { env } from "@/lib/env";
import { redirect } from "next/navigation";

async function signinAction(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  try {
    await signIn("credentials", { email, password, redirectTo: "/dashboard" });
  } catch (e) {
    // NEXT_REDIRECT is thrown on success; rethrow so the redirect happens.
    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
    redirect("/signin?error=1");
  }
}

async function googleAction() {
  "use server";
  await signIn("google", { redirectTo: "/dashboard" });
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string; reset?: string }> }) {
  const { error, reset } = await searchParams;
  return (
    <div className="flex-1 grid place-items-center p-6">
      <div className="card w-full max-w-md">
        <h1 className="font-mono font-bold text-xl mb-1">Sign in</h1>
        <p className="text-sm text-[var(--mute)] mb-5">to your CreateUp workspace</p>
        {error && <p className="text-sm text-[var(--brand)] mb-3">Invalid email or password.</p>}
        {reset === "1" && <p className="text-sm bg-[var(--green-soft)] text-[var(--green)] rounded-md px-3 py-2 mb-3">Password updated. Sign in with your new password.</p>}
        <form action={signinAction} className="flex flex-col gap-3">
          <label className="text-xs font-mono uppercase text-[var(--mute)]">Email
            <input name="email" type="email" required className="mt-1 w-full border border-[var(--line-2)] rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-mono uppercase text-[var(--mute)]">Password
            <input name="password" type="password" required minLength={8} className="mt-1 w-full border border-[var(--line-2)] rounded-lg px-3 py-2 text-sm" />
          </label>
          <button className="btn primary mt-2" type="submit">Sign in</button>
        </form>
        {env.ENABLE_GOOGLE_SSO && (
          <form action={googleAction} className="mt-3">
            <button className="btn w-full" type="submit">Continue with Google</button>
          </form>
        )}
        <p className="text-xs text-[var(--mute)] mt-4 text-center flex items-center justify-between">
          <Link href="/forgot" className="text-[var(--mute)] hover:text-[var(--accent)]">Forgot password?</Link>
          <span>No account? <Link href="/signup" className="text-[var(--accent)] font-semibold">Create one</Link></span>
        </p>
      </div>
    </div>
  );
}
