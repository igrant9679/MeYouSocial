import { Settings, Palette, CheckCircle2, AlertTriangle } from "lucide-react";
import { SubmitButton } from "@/components/SubmitButton";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { MODELS } from "@/lib/llm/models";
import { updateWorkspaceSettingsAction } from "@/app/actions/admin";
import { saveWorkspaceAccentAction, uploadWorkspaceLogoAction, clearWorkspaceLogoAction } from "@/app/actions/branding";

// Workspace settings: name, defaults, and per-company branding (accent color +
// logo — applied to the whole app chrome for this workspace only).

const LANGS = ["en", "es", "fr", "de", "it", "pt", "nl", "sv", "da", "fi", "no", "pl", "cs", "ro", "tr", "el", "ru", "uk", "ar", "hi", "bn", "ja", "ko", "zh", "th", "vi", "id", "ms"];

// Preset accents drawn from the app's own hue palette (all pass the same
// contrast treatment the default coral gets).
const ACCENT_PRESETS = ["#E5482F", "#6D28D9", "#2563EB", "#0D9488", "#D97706", "#DB2777", "#4F46E5", "#15924B", "#0891B2", "#E11D48"];

export default async function AdminSettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { workspace } = await requireRole("ADMIN");
  const { ok, err } = await searchParams;
  const channels = await db.channel.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "asc" } });

  return (
    <div className="w-full">
      <div className="flex items-center gap-3 mb-4">
        <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: "#E5EDFD", color: "#2563EB" }}>
          <Settings className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-lg leading-tight">Workspace settings</h1>
          <p className="text-xs text-[var(--mute)]">Defaults applied to every new channel + script.</p>
        </div>
      </div>

      <form action={updateWorkspaceSettingsAction} className="card flex flex-col gap-4">
        <Field name="name" label="Workspace name" defaultValue={workspace.name} required />

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Default channel (visible to new users)</span>
          <select name="defaultChannelId" defaultValue={workspace.defaultChannelId ?? ""} className="border border-[var(--line-2)] rounded-lg p-2 text-sm">
            <option value="">No default</option>
            {channels.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Default AI model</span>
          <select name="defaultModel" defaultValue={workspace.defaultModel ?? ""} className="border border-[var(--line-2)] rounded-lg p-2 text-sm">
            <option value="">Use the system default ({workspace.defaultModel ?? "claude-sonnet"})</option>
            {MODELS.filter((m) => m.provider !== "mock").map((m) => (
              <option key={m.id} value={m.id}>{m.label} — {m.style}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Default language (18N-01)</span>
          <select name="defaultLanguage" defaultValue={workspace.defaultLanguage ?? "en"} className="border border-[var(--line-2)] rounded-lg p-2 text-sm">
            {LANGS.map((l) => (<option key={l} value={l}>{l}</option>))}
          </select>
        </label>

        <div className="flex justify-end"><SubmitButton className="btn primary">Save settings</SubmitButton></div>
      </form>

      {/* Branding — per-company chrome. Only THIS workspace sees it. */}
      <div className="flex items-center gap-3 mb-2 mt-8">
        <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: "var(--pink-soft)", color: "var(--pink-on)" }}>
          <Palette className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-lg leading-tight">Branding</h1>
          <p className="text-xs text-[var(--mute)]">
            Your company&apos;s accent color and logo, applied to the whole app for members of <b>{workspace.name}</b>.
            Other companies on this install keep their own look.
          </p>
        </div>
      </div>

      {ok && (
        <div className="card mb-3 flex items-center gap-2 text-sm" style={{ background: "var(--green-soft)", borderColor: "var(--green)" }}>
          <CheckCircle2 className="w-4 h-4" style={{ color: "var(--green)" }} />
          {ok === "accent" ? "Accent saved — the app chrome updates immediately." : ok === "logo" ? "Logo uploaded." : "Logo cleared — back to the MeYouSocial mark."}
        </div>
      )}
      {err && (
        <div className="card mb-3 flex items-center gap-2 text-sm" style={{ background: "var(--rose-soft)", borderColor: "var(--rose)" }}>
          <AlertTriangle className="w-4 h-4" style={{ color: "var(--rose-on)" }} />
          {err === "accent" ? "Accent must be a 6-digit hex color like #2563EB." : err === "logo-size" ? "Logo too large (max 2 MB)." : err === "logo-type" ? "Use PNG, JPEG, WebP or SVG." : "Pick a file first."}
        </div>
      )}

      <form action={saveWorkspaceAccentAction} className="card mb-3">
        <div className="font-mono font-bold text-sm mb-1">Accent color</div>
        <p className="text-[11px] text-[var(--mute)] mb-2">
          Drives buttons, active states, badges and highlights. Leave empty and save to reset to the default coral.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {ACCENT_PRESETS.map((c) => (
            <button
              key={c}
              name="accentColor"
              value={c}
              title={c}
              aria-label={`Use accent ${c}`}
              className="w-9 h-9 rounded-xl cursor-pointer border-2 transition-transform hover:scale-110 motion-reduce:transform-none"
              style={{ background: c, borderColor: (workspace.accentColor ?? "#E5482F") === c ? "var(--ink)" : "transparent" }}
            />
          ))}
          <input
            name="accentColor"
            type="text"
            defaultValue={workspace.accentColor ?? ""}
            placeholder="#RRGGBB"
            pattern="#[0-9a-fA-F]{6}"
            className="w-28 border border-[var(--line-2)] rounded-lg p-2 text-sm font-mono"
            autoComplete="off"
          />
          <SubmitButton className="btn primary sm" pendingText="Saving…">Save</SubmitButton>
        </div>
      </form>

      <form action={uploadWorkspaceLogoAction} className="card mb-3">
        <div className="font-mono font-bold text-sm mb-1">Logo</div>
        <p className="text-[11px] text-[var(--mute)] mb-2">
          Shown in the sidebar and menu instead of the MeYouSocial mark. Square works best (it renders at 38px, rounded). PNG, JPEG, WebP or SVG, max 2 MB.
        </p>
        <div className="flex items-center gap-3">
          {workspace.logoKey ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={storage.url(workspace.logoKey)} alt={`${workspace.name} logo`} className="w-[38px] h-[38px] rounded-xl object-cover border border-[var(--line)]" />
          ) : (
            <span className="text-[11px] font-mono text-[var(--mute)]">none set</span>
          )}
          <input name="logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="text-xs flex-1" />
          <SubmitButton className="btn primary sm" pendingText="Uploading…">Upload</SubmitButton>
          {workspace.logoKey && (
            <button formAction={clearWorkspaceLogoAction} className="btn sm" formNoValidate>Remove</button>
          )}
        </div>
        <p className="text-[10px] text-[var(--mute)] mt-2">
          Heads-up: logos are stored in the app&apos;s file storage — on the Local backend they vanish on redeploy.
          Configure Google Drive under Admin → API keys → Storage for a logo that survives.
        </p>
      </form>
    </div>
  );
}

function Field(props: { name: string; label: string; defaultValue?: string; required?: boolean }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">{props.label}</span>
      <input name={props.name} defaultValue={props.defaultValue} required={props.required} className="border border-[var(--line-2)] rounded-lg p-2 text-sm" />
    </label>
  );
}
