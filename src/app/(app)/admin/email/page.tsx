import { Mail, CheckCircle2, AlertCircle, Send } from "lucide-react";
import { SubmitButton } from "@/components/SubmitButton";
import { requireRole } from "@/lib/acl";
import { getSmtpConfig } from "@/lib/email/config";
import { saveSmtpAction, clearSmtpAction, testSmtpAction } from "@/app/actions/email-config";

// Admin-only: configure the SMTP account the app uses to send invitations,
// verification, password reset, and Agent completion emails. DB-stored settings
// override SMTP_* env vars; if neither is set the app falls back to mock
// (console log) so flows never crash.

type SearchParams = { ok?: string; error?: string; msg?: string; to?: string };

const PRESETS: { label: string; host: string; port: number; secure: boolean; note?: string }[] = [
  { label: "Gmail",           host: "smtp.gmail.com",     port: 465, secure: true,  note: "Use an App Password — your regular Gmail password won't work" },
  { label: "Outlook / 365",   host: "smtp.office365.com", port: 587, secure: false, note: "Port 587 with STARTTLS" },
  { label: "iCloud",          host: "smtp.mail.me.com",   port: 587, secure: false, note: "Use an app-specific password" },
  { label: "SendGrid",        host: "smtp.sendgrid.net",  port: 587, secure: false, note: "User is the literal string 'apikey'; password is your SendGrid API key" },
  { label: "Resend",          host: "smtp.resend.com",    port: 465, secure: true,  note: "User is 'resend'; password is your Resend API key" },
  { label: "Mailgun",         host: "smtp.mailgun.org",   port: 587, secure: false, note: "User/pass from Mailgun → Sending → Domain Settings → SMTP credentials" },
  { label: "Postmark",        host: "smtp.postmarkapp.com", port: 587, secure: false, note: "User and password are both your Postmark Server Token" },
];

export default async function EmailSettingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { workspace } = await requireRole("ADMIN");
  const { ok, error, msg, to } = await searchParams;
  // The form edits THIS workspace's own SMTP (multi-tenant); the platform
  // config/env stays as the fallback for workspaces that never set one.
  const { getWorkspaceSettingRaw } = await import("@/lib/settings");
  const ownRaw = await getWorkspaceSettingRaw(workspace.id, "email:smtp");
  const cfg = ownRaw ? await getSmtpConfig(workspace.id) : null;
  const inherited = !cfg ? await getSmtpConfig() : null;

  return (
    <div className="w-full">
      <div className="flex items-center gap-3 mb-2">
        <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: "#E5EDFD", color: "#2563EB" }}>
          <Mail className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-lg leading-tight">Email (SMTP) settings</h1>
          <p className="text-xs text-[var(--mute)]">
            The account <b>{workspace.name}</b> sends its invitations and notification emails from.
            Saved for this workspace only — other companies on this install never see or use it.
          </p>
        </div>
      </div>

      {ok === "saved"   && <Banner kind="ok"   text="Settings saved. New emails will use the new SMTP server within ~30s." />}
      {ok === "cleared" && <Banner kind="ok"   text="Cleared. The app will fall back to env-var SMTP if configured, otherwise to mock (console log)." />}
      {ok === "sent"    && <Banner kind="ok"   text={`Test email sent to ${to}. Check the inbox (and spam folder).`} />}
      {error === "missing" && <Banner kind="err" text="Host, port, and From email are required." />}
      {error === "notest"  && <Banner kind="err" text="Enter a recipient address before sending a test." />}
      {error === "send"    && <Banner kind="err" text={`Test send failed: ${msg ?? "(no error message)"}.`} />}

      {/* IMAP note — we only need SMTP for outbound. */}
      <div className="card mb-4 text-xs text-[var(--mute)] leading-relaxed">
        <p className="mb-1"><strong>Why no IMAP field?</strong> IMAP is for <em>reading</em> mail; MeYouSocial only sends. The same email account you'd configure in your mail client will work — paste its SMTP settings here.</p>
        <p>For Gmail & iCloud you must generate an <strong>app-specific password</strong> in your account's security settings (the normal password won't work).</p>
      </div>

      {/* Presets */}
      <details className="card mb-4">
        <summary className="text-sm font-mono font-bold cursor-pointer">Quick presets (click to expand)</summary>
        <table className="w-full text-xs mt-3">
          <thead className="text-[10px] uppercase tracking-wider text-[var(--mute)]">
            <tr><th className="text-left py-1">Provider</th><th className="text-left">Host</th><th>Port</th><th>TLS</th><th className="text-left">Note</th></tr>
          </thead>
          <tbody className="font-mono">
            {PRESETS.map((p) => (
              <tr key={p.label} className="border-t border-[var(--line)]">
                <td className="py-1 font-bold">{p.label}</td>
                <td>{p.host}</td>
                <td className="text-center">{p.port}</td>
                <td className="text-center">{p.secure ? "yes" : "STARTTLS"}</td>
                <td className="text-[11px] text-[var(--mute)]">{p.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      {/* Main form — used by both Save and Send-test buttons. */}
      <form action={saveSmtpAction} className="card mb-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field name="host"      label="SMTP host"                  required defaultValue={cfg?.host ?? ""}      placeholder="smtp.gmail.com" />
          <Field name="port"      label="Port"               type="number"   required defaultValue={String(cfg?.port ?? 587)} placeholder="587" />
          <Field name="user"      label="Username"                            defaultValue={cfg?.user ?? ""}      placeholder="you@example.com" />
          <Field name="pass"      label={cfg ? "Password (leave empty to keep existing)" : "Password"} type="password" defaultValue="" placeholder="app password or API key" />
          <Field name="fromEmail" label="From address"               required defaultValue={cfg?.fromEmail ?? ""} placeholder="no-reply@yourdomain.com" />
          <Field name="fromName"  label="From name (optional)"                defaultValue={cfg?.fromName ?? ""}  placeholder="MeYouSocial" />
          <label className="flex items-center gap-2 mt-2 md:col-span-2 cursor-pointer">
            <input type="checkbox" name="secure" defaultChecked={cfg?.secure ?? false} />
            <span className="text-xs text-[var(--mute)]">Use implicit TLS (port 465). Leave off for STARTTLS on 587.</span>
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-4 border-t border-[var(--line)] pt-3">
          {cfg && (
            <button formAction={clearSmtpAction} type="submit" className="btn sm" formNoValidate>
              Clear saved config
            </button>
          )}
          <SubmitButton className="btn primary sm">Save settings</SubmitButton>
        </div>

        {/* Test send — formAction lets one form drive two server actions. */}
        <div className="mt-4 pt-4 border-t border-[var(--line)]">
          <h3 className="font-mono font-bold text-xs uppercase tracking-wider text-[var(--mute)] mb-2 flex items-center gap-1.5"><Send className="w-3.5 h-3.5" /> Send a test email</h3>
          <p className="text-xs text-[var(--mute)] mb-2">Uses the values above (no save needed). Leave the password field blank to test with the currently saved password.</p>
          <div className="flex gap-2">
            <input name="testTo" type="email" placeholder="someone@example.com" className="flex-1 border border-[var(--line-2)] rounded-lg p-2 text-sm" />
            <button formAction={testSmtpAction} type="submit" className="btn sm" formNoValidate>Send test</button>
          </div>
        </div>
      </form>

      {!cfg && (
        <div className="card text-xs text-[var(--mute)]">
          <p>
            No SMTP saved for this workspace. Its email currently goes out via{" "}
            {inherited
              ? `the platform's shared SMTP (${inherited.host})`
              : process.env.SMTP_HOST
                ? `env-var SMTP (${process.env.SMTP_HOST})`
                : "the mock provider (emails are logged to the server console, not actually sent)"}
            . Password resets and email verification always use the platform sender.
          </p>
        </div>
      )}
    </div>
  );
}

function Field(props: { name: string; label: string; type?: string; required?: boolean; defaultValue?: string; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">{props.label}{props.required && " *"}</span>
      <input
        name={props.name}
        type={props.type ?? "text"}
        required={props.required}
        defaultValue={props.defaultValue}
        placeholder={props.placeholder}
        autoComplete="off"
        className="border border-[var(--line-2)] rounded-lg p-2 text-sm font-mono"
      />
    </label>
  );
}

function Banner({ kind, text }: { kind: "ok" | "err"; text: string }) {
  const ok = kind === "ok";
  return (
    <div className="card mb-4 flex items-start gap-2" style={{ background: ok ? "var(--green-soft)" : "var(--brand-soft)", borderColor: ok ? "var(--green)" : "var(--brand)" }}>
      {ok ? <CheckCircle2 className="w-4 h-4 mt-0.5" style={{ color: "var(--green)" }} /> : <AlertCircle className="w-4 h-4 mt-0.5" style={{ color: "var(--brand)" }} />}
      <span className="text-sm">{text}</span>
    </div>
  );
}
