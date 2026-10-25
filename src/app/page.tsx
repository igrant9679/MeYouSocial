import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import { BRAND, PRODUCT_SHORT, PRODUCT_TAGLINE } from "@/lib/product";
import { env } from "@/lib/env";

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/inbox");

  return (
    <div className="flex-1 grid place-items-center p-6">
      <div className="card max-w-lg w-full text-center">
        <div className="font-mono text-2xl font-bold tracking-tight mb-2 flex items-center justify-center gap-3">
          <BrandLogo size={36} />
          <span>{BRAND} <span className="font-normal text-[var(--mute)]">{PRODUCT_SHORT}</span></span>
        </div>
        <p className="text-sm text-[var(--mute)] mb-6">{PRODUCT_TAGLINE}</p>
        <div className="flex gap-3 justify-center">
          <Link href="/signin" className="btn primary">Sign in</Link>
          {env.ALLOW_OPEN_SIGNUP && <Link href="/signup" className="btn">Create account</Link>}
        </div>
        {!env.ALLOW_OPEN_SIGNUP && (
          <p className="text-xs text-[var(--mute)] mt-6">New here? Open the invitation link your administrator sent you.</p>
        )}
      </div>
    </div>
  );
}
