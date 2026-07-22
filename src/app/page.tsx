import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <div className="flex-1 grid place-items-center p-6">
      <div className="card max-w-lg w-full text-center">
        <div className="font-mono text-2xl font-bold tracking-tight mb-2 flex items-center justify-center gap-3">
          <span className="inline-block w-9 h-9 rounded-[10px] text-white grid place-items-center" style={{ background: "linear-gradient(150deg,#F0623F,#C53A22)" }}>▲</span>
          MeYouSocial
        </div>
        <p className="text-sm text-[var(--mute)] mb-6">AI-powered blog &amp; video content — mostly on autopilot.</p>
        <div className="flex gap-3 justify-center">
          <Link href="/signin" className="btn primary">Sign in</Link>
          <Link href="/signup" className="btn">Create account</Link>
        </div>
        <p className="text-xs text-[var(--mute)] mt-6 font-mono">All AI providers are in <b>mock mode</b>. Edit <code>.env</code> and flip <code>USE_MOCK_*=false</code> to go real.</p>
      </div>
    </div>
  );
}
