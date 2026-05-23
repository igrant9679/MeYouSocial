import Link from "next/link";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { signIn } from "@/auth";
import { requestVerificationForUser } from "@/app/actions/auth-flows";

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

  // FR-AUTH-02: every user belongs to at least one workspace (a personal one on signup).
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

  // Always also create a personal workspace where this user is ADMIN.
  const personal = await db.workspace.create({
    data: { name: `${parsed.data.name}'s workspace` },
  });
  await db.membership.create({
    data: { userId: user.id, workspaceId: personal.id, role: "ADMIN" },
  });

  // FR-AUTH-09 — send verification email on signup
  await requestVerificationForUser(user.id, user.email);

  await signIn("credentials", { email: parsed.data.email, password: parsed.data.password, redirectTo: "/dashboard" });
}

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="flex-1 grid place-items-center p-6">
      <div className="card w-full max-w-md">
        <h1 className="font-mono font-bold text-xl mb-1">Create your account</h1>
        <p className="text-sm text-[var(--mute)] mb-5">A personal workspace is created automatically.</p>
        {error === "exists" && <p className="text-sm text-[var(--brand)] mb-3">An account already exists for that email.</p>}
        {error === "invalid" && <p className="text-sm text-[var(--brand)] mb-3">Please check your details and try again.</p>}
        <form action={signupAction} className="flex flex-col gap-3">
          <label className="text-xs font-mono uppercase text-[var(--mute)]">Your name
            <input name="name" required maxLength={80} className="mt-1 w-full border border-[var(--line-2)] rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-mono uppercase text-[var(--mute)]">Email
            <input name="email" type="email" required className="mt-1 w-full border border-[var(--line-2)] rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-mono uppercase text-[var(--mute)]">Password
            <input name="password" type="password" required minLength={8} className="mt-1 w-full border border-[var(--line-2)] rounded-lg px-3 py-2 text-sm" />
          </label>
          <button className="btn primary mt-2" type="submit">Create account</button>
        </form>
        <p className="text-xs text-[var(--mute)] mt-4 text-center">
          Already have an account? <Link href="/signin" className="text-[var(--accent)] font-semibold">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
