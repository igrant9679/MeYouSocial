import { Settings } from "lucide-react";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { MODELS } from "@/lib/llm/models";
import { updateWorkspaceSettingsAction } from "@/app/actions/admin";

// FR-ADMIN-02 — Workspace settings: name, default channel, default AI model/language.

const LANGS = ["en", "es", "fr", "de", "it", "pt", "nl", "sv", "da", "fi", "no", "pl", "cs", "ro", "tr", "el", "ru", "uk", "ar", "hi", "bn", "ja", "ko", "zh", "th", "vi", "id", "ms"];

export default async function AdminSettingsPage() {
  const { workspace } = await requireRole("ADMIN");
  const channels = await db.channel.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "asc" } });

  return (
    <div className="max-w-2xl">
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
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Default language (FR-I18N-01)</span>
          <select name="defaultLanguage" defaultValue={workspace.defaultLanguage ?? "en"} className="border border-[var(--line-2)] rounded-lg p-2 text-sm">
            {LANGS.map((l) => (<option key={l} value={l}>{l}</option>))}
          </select>
        </label>

        <div className="flex justify-end"><button type="submit" className="btn primary">Save settings</button></div>
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
