import Link from "next/link";
import { cookies } from "next/headers";
import { ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/acl";
import { db } from "@/lib/db";
import { formatDay } from "@/lib/zoned-dates";
import { PRODUCT } from "@/lib/product";
import { otpauthUri } from "@/lib/totp";
import { readSecret, recoveryLeft, CODES_COOKIE } from "@/lib/two-factor";
import { startTwoFactorAction, confirmTwoFactorAction, renewRecoveryCodesAction, disableTwoFactorAction, savedRecoveryCodesAction } from "@/app/actions/two-factor";
import { SubmitButton } from "@/components/SubmitButton";
import { CopyButton } from "@/components/CopyButton";

const inputCls = "border border-[var(--line-2)] rounded-lg px-2 py-1.5 text-sm font-mono tracking-widest w-44";

/** A code box posting to `action`. */
function CodeForm({ action, label, button }: { action: (fd: FormData) => Promise<void>; label: string; button: string }) {
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 text-xs">
      <label className="flex flex-col gap-1">
        <span className="text-[var(--mute)]">{label}</span>
        <input name="code" required autoComplete="one-time-code" className={inputCls} />
      </label>
      <SubmitButton className="btn sm primary" pendingText="Checking…">{button}</SubmitButton>
    </form>
  );
}

// Two-factor sign-in (E-SEC-07) — each person's own. Outside the app shell on
// purpose: a workspace that requires it of admins sends them here from every
// app page until it's on, and this page must not be one of those.

export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ required?: string; ok?: string; err?: string; codes?: string }> }) {
  const { required, ok, err, codes: showCodes } = await searchParams;
  const user = await requireUser();
  const me = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { email: true, totpSecret: true, totpEnabledAt: true, totpRecovery: true } });
  const pendingSecret = me.totpEnabledAt ? null : readSecret(me.totpSecret);
  // Codes just made (confirm or renew) — read from their two-minute cookie.
  const fresh = showCodes ? readSecret((await cookies()).get(CODES_COOKIE)?.value ?? null)?.split(",") ?? null : null;

  return (
    <div className="flex-1 grid place-items-center p-6">
      <div className="card w-full max-w-lg flex flex-col gap-3 text-sm">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-2xl grid place-items-center" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}><ShieldCheck className="w-5 h-5" /></span>
          <div>
            <h1 className="font-mono font-bold text-xl leading-tight">Two-factor sign-in</h1>
            <p className="text-xs text-[var(--mute)] m-0">{me.email} · {PRODUCT}</p>
          </div>
        </div>
        {required && !me.totpEnabledAt && <p className="m-0 text-xs px-2.5 py-1.5 rounded-lg" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>A workspace you&apos;re an admin of requires two-factor sign-in. Set it up to carry on.</p>}
        {ok && <p className="m-0 text-xs px-2.5 py-1.5 rounded-lg" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}>{ok}</p>}
        {err && <p className="m-0 text-xs px-2.5 py-1.5 rounded-lg" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>{err}</p>}

        {fresh && me.totpEnabledAt ? (
          <div className="rounded-lg p-3 flex flex-col gap-2 text-xs" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}>
            <b>Two-factor is on. Your recovery codes — save them now; they won&apos;t be shown again.</b>
            <span>Each one signs you in once if you lose your phone.</span>
            <ul className="m-0 p-0 grid grid-cols-2 gap-1 font-mono text-[13px]" data-recovery-codes>
              {fresh.map((c) => <li key={c} className="list-none">{c}</li>)}
            </ul>
            <div className="flex items-center gap-2">
              <CopyButton text={fresh.join("\n")} />
              <form action={savedRecoveryCodesAction}><SubmitButton className="btn sm" pendingText="…">I&apos;ve saved them — continue</SubmitButton></form>
            </div>
          </div>
        ) : me.totpEnabledAt ? (
          <>
            <p className="m-0"><b>On</b> since {formatDay(me.totpEnabledAt)} · {recoveryLeft(me)} recovery code{recoveryLeft(me) === 1 ? "" : "s"} left.</p>
            <section className="flex flex-col gap-1.5">
              <b className="text-xs">New recovery codes</b>
              <CodeForm action={renewRecoveryCodesAction} label="A code from your app" button="Make new codes" />
            </section>
            <form action={disableTwoFactorAction} className="flex flex-wrap items-end gap-2 text-xs">
              <label className="flex flex-col gap-1">
                <span className="text-[var(--mute)]">Turn it off — a code from your app, or a recovery code</span>
                <input name="code" required autoComplete="one-time-code" className="border border-[var(--line-2)] rounded-lg px-2 py-1.5 text-sm font-mono w-44" />
              </label>
              <SubmitButton className="btn sm" pendingText="…">Turn off</SubmitButton>
            </form>
          </>
        ) : pendingSecret ? (
          <>
            <ol className="m-0 pl-5 flex flex-col gap-2 text-xs">
              <li>In an authenticator app (Google Authenticator, 1Password, Authy…), add an account with this key:
                <code className="block mt-1 font-mono text-[14px] select-all tracking-wider" data-totp-secret={pendingSecret}>{pendingSecret.match(/.{1,4}/g)?.join(" ")}</code>
                <span className="text-[var(--mute)]">On a phone, <a href={otpauthUri(pendingSecret, me.email, PRODUCT)} className="underline">open it in your app</a> instead.</span>
              </li>
              <li>Type the six-digit code it shows:</li>
            </ol>
            <CodeForm action={confirmTwoFactorAction} label="Code" button="Turn on" />
          </>
        ) : (
          <>
            <p className="m-0 text-xs">With two-factor on, signing in takes your password and a code from an app on your phone, so a leaked password alone can&apos;t get in.</p>
            <form action={startTwoFactorAction}><SubmitButton className="btn sm primary" pendingText="…">Set it up</SubmitButton></form>
          </>
        )}
        <p className="m-0 text-xs text-[var(--mute)]"><Link href="/settings" className="underline">Back to your settings</Link></p>
      </div>
    </div>
  );
}
