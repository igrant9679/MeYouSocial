import Link from "next/link";
import { User, Mail, Lock, Palette, ShieldCheck, Building2, Plus, Clock, Trash2 } from "lucide-react";
import { requireUser, isPlatformOperator } from "@/lib/acl";
import { db } from "@/lib/db";
import { setThemeAction, getTheme, setContentSizeAction, getContentSize } from "@/app/actions/theme";
import { CONTENT_SIZES, SIZE_LABELS } from "@/lib/ui-size";
import { updateProfileAction, changePasswordAction, setTimeZoneAction, requestEmailChangeAction, cancelEmailChangeAction, deleteMyAccountAction } from "@/app/actions/profile";
import { pendingEmailChange, soleAdminOf } from "@/lib/account";
import { timeZoneChoices } from "@/lib/display-zone";
import { PasswordInput } from "@/components/PasswordInput";
import { formatZonedMoment } from "@/lib/zoned-dates";
import { resendVerificationAction } from "@/app/actions/auth-flows";
import { SubmitButton } from "@/components/SubmitButton";
import { ValidatedInput } from "@/components/ValidatedInput";
import { DeleteButton } from "@/components/DeleteButton";
import { RESTORE_DAYS } from "@/lib/workspace-lifecycle";
import { deletionImpact } from "@/lib/deletable";
import { formatDay } from "@/lib/zoned-dates";

// User-level settings (distinct from /admin/settings which is workspace-level).
// Linked from the avatar button in the left rail.

// What each ?error= / ?ok= from the profile actions means (E-SHL-09: every form says what happened).
const ERRORS: Record<string, string> = {
  name: "A display name needs at least one character (120 at most).",
  wrongpass: "Current password doesn't match.",
  invalid: "New password must be 8+ characters.",
  mismatch: "The new password and its confirmation don't match.",
  zone: "That isn't a time zone this server knows.",
  "email-invalid": "That doesn't look like an email address.",
  "email-same": "That's already your sign-in email.",
  "email-operator": "The platform operator's address is set by the deployment, not here.",
  "email-password": "Your password didn't match, so nothing was sent.",
  "email-slow": "Too many requests — wait a few minutes and try again.",
  "email-taken": "That address can't be used for this account.",
  "delete-operator": "The platform operator's account can't be deleted from here.",
  "delete-confirm": "Type your sign-in email exactly to confirm.",
  "delete-password": "Your password didn't match, so nothing was deleted.",
};
const OKS: Record<string, string> = {
  profile: "Saved.",
  password: "Password updated.",
  zone: "Time zone saved.",
  "email-sent": "Check the new address's inbox — the change happens when you open the link there. Your current address was told too.",
  "email-cancelled": "The email change was cancelled.",
  "email-changed": "Your sign-in email is changed. Use the new address next time you sign in.",
};

export default async function UserSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; ws?: string }> }) {
  const user = await requireUser();
  const { error, ok, ws } = await searchParams;
  const flash = (keys: string[]) => (
    <>
      {error && keys.includes(error) && <p className="text-sm mb-2 rounded-md px-3 py-2" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }} data-settings-error={error}>{ERRORS[error]}</p>}
      {ok && keys.includes(ok) && <p className="text-sm mb-2 rounded-md px-3 py-2" style={{ background: "var(--green-soft)", color: "var(--green-on)" }} data-settings-ok={ok}>{OKS[ok]}</p>}
    </>
  );
  const [pending, sole] = await Promise.all([pendingEmailChange(user.id), soleAdminOf(user.id)]);
  const operator = isPlatformOperator(user.email);
  const zones = timeZoneChoices();
  const [theme, size] = await Promise.all([getTheme(), getContentSize()]);
  const memberships = await db.membership.findMany({
    where: { userId: user.id, status: "active", workspace: { deletedAt: null } },
    include: { workspace: { select: { name: true } } },
  });
  // Standing up a whole tenant is the platform operator's job, not a workspace
  // admin's. Display only — createWorkspaceAction enforces the same check.
  const canCreateWorkspace = isPlatformOperator(user.email);
  // Counted only for workspaces this user actually administers, so the
  // confirmation can say what a delete would cost.
  const workspaceImpacts = Object.fromEntries(
    await Promise.all(
      memberships
        .filter((m) => m.role === "ADMIN")
        .map(async (m) => [m.workspaceId, await deletionImpact("workspace", m.workspaceId, m.workspaceId)] as const),
    ),
  );

  return (
    <div className="w-full">
      <div className="flex items-center gap-3 mb-5">
        <span className="w-12 h-12 rounded-2xl text-white grid place-items-center font-mono font-bold text-lg" style={{ background: "linear-gradient(135deg,var(--brand),var(--violet))" }}>
          {(user.name ?? user.email).slice(0, 2).toUpperCase()}
        </span>
        <div>
          <h1 className="font-mono font-bold text-2xl leading-tight">{user.name ?? user.email}</h1>
          <p className="text-xs text-[var(--mute)]">{user.email}</p>
        </div>
      </div>

      {/* Profile */}
      <section className="card mb-4" id="profile">
        <h2 className="font-mono font-bold text-sm mb-3 flex items-center gap-2"><User className="w-4 h-4" style={{ color: "var(--accent-on)" }} /> Profile</h2>
        {flash(["name", "profile"])}
        <form action={updateProfileAction} className="flex flex-col gap-3">
          <ValidatedInput
            label="Display name"
            labelClassName="text-micro font-mono uppercase tracking-wider text-[var(--mute)]"
            name="name" defaultValue={user.name ?? ""} required autoComplete="name"
            className="border border-[var(--line-2)] rounded-lg p-2 text-sm"
          />
          <div className="flex justify-end"><SubmitButton className="btn primary sm" pendingText="Saving…">Save profile</SubmitButton></div>
        </form>
      </section>

      {/* Sign-in email (E-SHL-09): verification, and a change the new address has to confirm. */}
      <section className="card mb-4" id="email">
        <h2 className="font-mono font-bold text-sm mb-3 flex items-center gap-2"><Mail className="w-4 h-4" style={{ color: "var(--blue-on)" }} /> Sign-in email</h2>
        {flash(["email-invalid", "email-same", "email-operator", "email-password", "email-slow", "email-taken", "email-sent", "email-cancelled", "email-changed"])}
        {error === "email-domain" && <p className="text-sm mb-2 rounded-md px-3 py-2" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }} data-settings-error="email-domain">{ws ?? "A workspace you're in"} only takes some email domains, so that address can&apos;t be used there.</p>}
        <p className="text-sm mb-2"><span className="font-mono">{user.email}</span>{" "}
          {user.emailVerified
            ? <span className="text-[var(--green-on)] inline-flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> verified {formatDay(new Date(user.emailVerified))}</span>
            : <span className="text-[var(--mute)]">— not verified yet</span>}
        </p>
        {!user.emailVerified && (
          <form action={resendVerificationAction} className="mb-3"><SubmitButton className="btn primary sm" pendingText="Sending…">Resend verification</SubmitButton></form>
        )}
        {pending ? (
          <div className="flex items-center gap-2 flex-wrap text-xs rounded-lg px-3 py-2" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }} data-email-pending>
            <span className="flex-1 min-w-0">Waiting for <b className="font-mono">{pending.email}</b> to confirm — the link works until {formatZonedMoment(pending.expires, user.timeZone ?? "UTC")}.</span>
            <form action={cancelEmailChangeAction}><SubmitButton className="btn sm" pendingText="Cancelling…">Cancel the change</SubmitButton></form>
          </div>
        ) : operator ? (
          <p className="text-xs text-[var(--mute)] m-0">The platform operator&apos;s address is set by the deployment.</p>
        ) : (
          <details data-email-change-form>
            <summary className="cursor-pointer select-none text-xs font-semibold">Change your sign-in email</summary>
            <form action={requestEmailChangeAction} className="flex flex-col gap-3 mt-2">
              <label className="flex flex-col gap-1">
                <span className="text-micro font-mono uppercase tracking-wider text-[var(--mute)]">New email</span>
                <input name="email" type="email" required autoComplete="email" className="border border-[var(--line-2)] rounded-lg p-2 text-sm" />
              </label>
              {user.passwordHash && <PasswordInput label="Your password" name="password" autoComplete="current-password" />}
              <p className="text-2xs text-[var(--mute)] m-0">A link goes to the new address; nothing changes until it&apos;s opened. Your current address is told.</p>
              <div className="flex justify-end"><SubmitButton className="btn primary sm" pendingText="Sending…">Send the confirmation link</SubmitButton></div>
            </form>
          </details>
        )}
      </section>

      {/* Change password */}
      <section className="card mb-4" id="password">
        <h2 className="font-mono font-bold text-sm mb-3 flex items-center gap-2"><Lock className="w-4 h-4" style={{ color: "var(--amber-on)" }} /> Change password</h2>
        {flash(["wrongpass", "invalid", "mismatch", "password"])}
        {error === "nopass" && <p className="text-sm text-[var(--brand)] mb-2">No password is set on this account. Use <Link href="/forgot" className="text-[var(--accent)] font-semibold">Forgot password</Link> instead.</p>}
        <form action={changePasswordAction} className="flex flex-col gap-3">
          <PasswordInput label="Current password" name="current" autoComplete="current-password" />
          <PasswordInput label="New password (8+ chars)" name="next" autoComplete="new-password" minLength={8} />
          <PasswordInput label="New password again" name="confirm" autoComplete="new-password" minLength={8} />
          <div className="flex justify-end"><SubmitButton className="btn primary sm" pendingText="Updating…">Change password</SubmitButton></div>
        </form>
      </section>

      {/* Time zone (E-SHL-09): the zone times are READ in — schedules keep the posting zone. */}
      <section className="card mb-4" id="zone">
        <h2 className="font-mono font-bold text-sm mb-2 flex items-center gap-2"><Clock className="w-4 h-4" style={{ color: "var(--indigo-on)" }} /> Time zone</h2>
        {flash(["zone"])}
        <p className="text-xs text-[var(--mute)] mb-3">
          Times you read — notifications, comments, the audit log, the assistant&apos;s history, the job queue — show in this zone.
          Anything you schedule or type a time into (posting slots, publish dates, the calendar, Measure&apos;s ranges) stays in each
          workspace&apos;s posting zone, so a time means the same moment to everyone on the team.
        </p>
        <form action={setTimeZoneAction} className="flex items-center gap-2 flex-wrap">
          <select key={`timeZone:${user.timeZone ?? ""}`} name="timeZone" defaultValue={user.timeZone ?? ""} className="border border-[var(--line-2)] rounded-lg px-2 py-1.5 text-sm max-w-full" aria-label="Your time zone" data-zone-select>
            <option value="">Each workspace&apos;s posting zone</option>
            {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
          </select>
          <SubmitButton className="btn primary sm" pendingText="Saving…">Save</SubmitButton>
        </form>
      </section>

      {/* Two-factor sign-in (E-SEC-07) — set up on its own page, outside the app shell. */}
      <section className="card mb-4">
        <h2 className="font-mono font-bold text-sm mb-2 flex items-center gap-2"><Lock className="w-4 h-4" style={{ color: "var(--green-on)" }} /> Two-factor sign-in</h2>
        <p className="text-sm m-0">
          {user.totpEnabledAt ? <>On — signing in takes your password and a code from your phone. </> : <>Off — a password alone signs you in. </>}
          <Link href="/account/two-factor" className="underline">{user.totpEnabledAt ? "Manage it" : "Turn it on"}</Link>
        </p>
      </section>

      {/* Theme — click to apply instantly (one form per option, auto-submitting). */}
      <section className="card mb-4">
        <h2 className="font-mono font-bold text-sm mb-3 flex items-center gap-2"><Palette className="w-4 h-4" style={{ color: "var(--violet-on)" }} /> Appearance</h2>
        <p className="text-xs text-[var(--mute)] mb-3">Click a mode to apply it instantly.</p>
        <div className="flex gap-2">
          {(["light", "dark", "auto"] as const).map((t) => {
            const active = theme === t;
            return (
              <form key={t} action={setThemeAction} className="flex-1">
                <input type="hidden" name="theme" value={t} />
                <input type="hidden" name="return" value="/settings" />
                <button
                  type="submit"
                  className="card w-full text-center cursor-pointer transition-colors"
                  style={active ? { borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent-on)", fontWeight: 600 } : undefined}
                >
                  <span className="capitalize">{t}</span>
                  {active && <span className="ml-2 text-micro font-mono uppercase tracking-wider">✓ active</span>}
                </button>
              </form>
            );
          })}
        </div>
      </section>

      {/* Content size — whole-UI scale, three levels, instant apply. */}
      <section className="card mb-4">
        <h2 className="font-mono font-bold text-sm mb-3 flex items-center gap-2"><Palette className="w-4 h-4" style={{ color: "var(--teal-on)" }} /> Content size</h2>
        <p className="text-xs text-[var(--mute)] mb-3">Scales everything on screen — text, buttons, charts. Applies instantly.</p>
        <div className="flex gap-2">
          {CONTENT_SIZES.map((s) => {
            const active = size === s;
            return (
              <form key={s} action={setContentSizeAction} className="flex-1">
                <input type="hidden" name="size" value={s} />
                <input type="hidden" name="return" value="/settings" />
                <button
                  type="submit"
                  className="card w-full text-center cursor-pointer transition-colors"
                  style={active ? { borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent-on)", fontWeight: 600 } : undefined}
                >
                  <span className={s === "standard" ? "text-sm" : s === "large" ? "text-base" : "text-lg"}>{SIZE_LABELS[s]}</span>
                  {active && <span className="ml-2 text-micro font-mono uppercase tracking-wider">✓ active</span>}
                </button>
              </form>
            );
          })}
        </div>
      </section>

      {/* Workspaces — also the only place in the app you can create one. */}
      <section className="card mb-4">
        <h2 className="font-mono font-bold text-sm mb-3 flex items-center gap-2">
          <Building2 className="w-4 h-4" style={{ color: "var(--accent-on)" }} /> Workspaces ({memberships.length})
        </h2>
        <ul className="m-0 p-0">
          {memberships.map((m) => (
            <li key={m.id} className="border-t border-[var(--line)] first:border-t-0 py-2 text-sm flex items-center gap-2 flex-wrap">
              <span className="flex-1">{m.workspace.name}</span>
              <span className="font-mono text-micro uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: "var(--accent-soft)", color: "var(--accent-on)" }}>{m.role}</span>
              {/* Only an ADMIN of that workspace may delete it, and only ever
                  their own — the action re-resolves membership for the target
                  id rather than trusting the one being viewed. */}
              {m.role === "ADMIN" && (
                <DeleteButton
                  kind="workspace"
                  id={m.workspaceId}
                  name={m.workspace.name}
                  confirmName
                  impact={workspaceImpacts[m.workspaceId]}
                  returnTo="/settings"
                  label="Delete"
                  warning={`It's kept for ${RESTORE_DAYS} days — paused and hidden from everyone, restorable by the platform operator — then purged with everything in it, its Zernio, Unipile and Google connections revoked. Download everything first from Settings → Workspace.`}
                />
              )}
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2 flex-wrap mt-3 pt-3 border-t border-[var(--line)]">
          <p className="text-2xs text-[var(--mute)] flex-1 leading-relaxed">
            Each workspace is a separate company — its own brand, content, connected accounts and API keys. Switch
            between them from the name at the top of the page.
            {!canCreateWorkspace && " New workspaces are set up by the platform administrator."}
          </p>
          {canCreateWorkspace && (
            <Link href="/onboarding/workspace" className="btn primary sm">
              <Plus className="w-3.5 h-3.5" /> New workspace
            </Link>
          )}
        </div>
      </section>

      {/* Delete my account (E-SHL-09): personal data goes; authored work stays as "Deleted user". */}
      <section className="card mb-4" id="delete" style={{ borderColor: "var(--rose)" }}>
        <h2 className="font-mono font-bold text-sm mb-2 flex items-center gap-2"><Trash2 className="w-4 h-4" style={{ color: "var(--rose-on)" }} /> Delete my account</h2>
        {flash(["delete-operator", "delete-confirm", "delete-password"])}
        {error === "delete-sole" && <p className="text-sm mb-2 rounded-md px-3 py-2" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }} data-settings-error="delete-sole">You&apos;re the only admin of {ws}. Make someone else an admin there first (Settings → People), or delete the workspace.</p>}
        <p className="text-xs text-[var(--mute)] mb-3">
          Your name, address, password, two-factor, sign-ins, memberships, notifications and API tokens are removed, and you&apos;re
          signed out everywhere. What you made — articles, posts, scripts, comments — stays with each workspace, credited to
          &ldquo;Deleted user&rdquo;, and the audit log keeps its record. This can&apos;t be undone.
        </p>
        {operator ? (
          <p className="text-xs text-[var(--mute)] m-0">The platform operator&apos;s account can&apos;t be deleted from here.</p>
        ) : sole.length ? (
          <p className="text-xs m-0" style={{ color: "var(--amber-on)" }} data-delete-blocked>You&apos;re the only admin of {sole.join(", ")} — hand that over first.</p>
        ) : (
          <details data-delete-form>
            <summary className="cursor-pointer select-none text-xs font-semibold" style={{ color: "var(--rose-on)" }}>Delete my account…</summary>
            <form action={deleteMyAccountAction} className="flex flex-col gap-3 mt-2">
              <label className="flex flex-col gap-1">
                <span className="text-micro font-mono uppercase tracking-wider text-[var(--mute)]">Type your sign-in email to confirm</span>
                <input name="confirmEmail" required autoComplete="off" placeholder={user.email} className="border border-[var(--line-2)] rounded-lg p-2 text-sm font-mono" />
              </label>
              {user.passwordHash && <PasswordInput label="Your password" name="password" autoComplete="current-password" />}
              <div className="flex justify-end"><SubmitButton className="btn sm !bg-[var(--rose)] !text-white" pendingText="Deleting…">Delete my account</SubmitButton></div>
            </form>
          </details>
        )}
      </section>
    </div>
  );
}
