import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { HelpCircle, Keyboard, Palette, Sparkles, ExternalLink, Compass } from "lucide-react";
import { setThemeAction, getTheme } from "@/app/actions/theme";
import { HelpClient } from "./HelpClient";
import { TRACKS, ELSIE_NAME } from "@/lib/guide/steps";

// User Guide / Help center. Searchable FAQ + per-role quick starts
// + appearance + shortcuts in one place.

// Quick starts describe the app as it is now — a content engine that also
// publishes and measures — rather than the YouTube-scripting tool it began as.
const QUICK_START = [
  { role: "Setting the app up",       steps: ["Admin → API keys: paste a provider key", "Set the model to match that key", "Admin → Connections: social + a mailbox", "Admin → Storage: switch off local disk"] },
  { role: "New creator (solo)",       steps: ["Link your YouTube channel", "Add two or three Topics in Brand", "Browse the generated ideas", "Click Write, then run the agent"] },
  { role: "Publishing regularly",     steps: ["Set your posting slots + timezone", "Compose once, pick the accounts", "Queue drafts into the next free slot", "Check History for per-network results"] },
  { role: "Agency / team lead",       steps: ["Invite the team in Admin → Users", "One workspace per client — keys stay separate", "Per-channel default models & templates", "Track work on the Production board"] },
];

const SHORTCUTS = [
  { keys: "Ctrl/⌘ + /", action: "Open Prompt Library (in chat)" },
  { keys: "Esc",        action: "Dismiss the guide, or close a modal" },
  { keys: "Tab",        action: "Move through form fields" },
];

export default async function HelpPage() {
  const theme = await getTheme();

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "#D8EFF5", color: "#0891B2" }}>
          <HelpCircle className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-2xl leading-tight">Help center</h1>
          <p className="text-xs text-[var(--mute)]">Searchable FAQ, quick starts, shortcuts, and appearance — for you and your whole team.</p>
        </div>
      </div>

      {/* Quick starts by role */}
      <section className="card mb-4">
        <h2 className="font-mono font-bold text-[14px] mb-3 flex items-center gap-2"><Sparkles className="w-4 h-4" style={{ color: "var(--accent)" }} /> Quick start by role</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {QUICK_START.map((qs) => (
            <div key={qs.role} className="border border-[var(--line)] rounded-xl p-3">
              <div className="text-sm font-semibold mb-2">{qs.role}</div>
              <ol className="m-0 pl-4 list-decimal text-xs text-[var(--mute)] space-y-1">
                {qs.steps.map((s, i) => (<li key={i}>{s}</li>))}
              </ol>
            </div>
          ))}
        </div>
      </section>

      {/* Appearance + shortcuts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <section className="card">
          <h2 className="font-mono font-bold text-[14px] mb-3 flex items-center gap-2"><Palette className="w-4 h-4" style={{ color: "#6D28D9" }} /> Appearance</h2>
          <form action={setThemeAction} className="flex flex-col sm:flex-row gap-2 items-stretch">
            <input type="hidden" name="return" value="/help" />
            {(["light", "dark", "auto"] as const).map((t) => (
              <label key={t} className="flex-1 cursor-pointer border rounded-lg p-2.5 text-center transition has-[input:checked]:border-[var(--accent)] has-[input:checked]:bg-[var(--accent-soft)]" style={{ borderColor: theme === t ? "var(--accent)" : "var(--line-2)" }}>
                <input type="radio" name="theme" value={t} defaultChecked={theme === t} className="hidden" />
                <span className="text-sm capitalize font-semibold">{t}</span>
                <div className="text-[10px] font-mono text-[var(--mute)] uppercase tracking-wider mt-0.5">
                  {t === "auto" ? "Match OS" : t === "dark" ? "Reduce eye strain" : "Default"}
                </div>
              </label>
            ))}
            <SubmitButton className="btn primary">Save</SubmitButton>
          </form>
        </section>

        <section className="card">
          <h2 className="font-mono font-bold text-[14px] mb-3 flex items-center gap-2"><Keyboard className="w-4 h-4" style={{ color: "var(--accent)" }} /> Keyboard shortcuts</h2>
          <ul className="m-0 p-0">
            {SHORTCUTS.map((s) => (
              <li key={s.keys} className="border-t border-[var(--line)] first:border-t-0 py-2 flex items-center gap-3 text-sm">
                <kbd className="px-2 py-0.5 rounded bg-[var(--zebra)] border border-[var(--line-2)] text-xs font-mono whitespace-nowrap">{s.keys}</kbd>
                <span className="flex-1">{s.action}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Elsie — the guide lives in the top bar, which isn't obvious unless
          someone says so. The tours are listed from the same source of truth
          she uses, so this can't drift out of sync with what she offers. */}
      <section className="card mb-4">
        <h2 className="font-mono font-bold text-[14px] mb-1 flex items-center gap-2">
          <Compass className="w-4 h-4" style={{ color: "var(--amber-on)" }} /> {ELSIE_NAME}, the in-app guide
        </h2>
        <p className="text-xs text-[var(--mute)] mb-3">
          The compass button in the top bar. She flags setup that&apos;s genuinely still outstanding for your workspace,
          then offers a tour — each one short, so you take the one you need. Esc is only &ldquo;not now&rdquo;; the top-bar
          button is the real on/off.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {TRACKS.map((t) => (
            <div key={t.id} className="border border-[var(--line)] rounded-lg px-3 py-2">
              <div className="text-sm font-semibold">
                {t.label}
                {t.operatorOnly && (
                  <span className="ml-1.5 text-[10px] font-mono uppercase tracking-wider px-1 py-0.5 rounded" style={{ background: "var(--accent-soft)", color: "var(--accent-on)" }}>
                    operator
                  </span>
                )}
              </div>
              <div className="text-[11px] text-[var(--mute)] leading-snug">{t.blurb}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Useful links */}
      <section className="card mb-5">
        <h2 className="font-mono font-bold text-[14px] mb-3">Useful links</h2>
        <div className="flex flex-wrap gap-2">
          <Link href="/channels" className="btn sm flex items-center gap-1.5">Manage channels <ExternalLink className="w-3 h-3" /></Link>
          <Link href="/onboarding/channel/new" className="btn sm flex items-center gap-1.5">New channel <ExternalLink className="w-3 h-3" /></Link>
          <Link href="/brand" className="btn sm flex items-center gap-1.5">Brand &amp; topics <ExternalLink className="w-3 h-3" /></Link>
          <Link href="/intel" className="btn sm flex items-center gap-1.5">Intel <ExternalLink className="w-3 h-3" /></Link>
          <Link href="/blog" className="btn sm flex items-center gap-1.5">Blog <ExternalLink className="w-3 h-3" /></Link>
          <Link href="/social" className="btn sm flex items-center gap-1.5">Social <ExternalLink className="w-3 h-3" /></Link>
          <Link href="/insights" className="btn sm flex items-center gap-1.5">Insights <ExternalLink className="w-3 h-3" /></Link>
          <Link href="/production" className="btn sm flex items-center gap-1.5">Production board <ExternalLink className="w-3 h-3" /></Link>
          <Link href="/admin" className="btn sm flex items-center gap-1.5">Admin <ExternalLink className="w-3 h-3" /></Link>
          <Link href="/settings" className="btn sm flex items-center gap-1.5">Profile <ExternalLink className="w-3 h-3" /></Link>
        </div>
      </section>

      {/* Searchable FAQ */}
      <h2 className="font-mono font-bold text-[15px] mb-3 mt-2">Frequently asked questions</h2>
      <HelpClient />
    </div>
  );
}
