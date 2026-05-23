import { requireChannel } from "@/lib/channel";
import { db } from "@/lib/db";
import { MODELS } from "@/lib/llm/models";
import { updateChannelSettingsAction } from "@/app/actions/channel-settings";

// FR-CHAN-04 — Channel Settings: details, linked YouTube, Script Defaults.

const LANGS = [
  "en", "es", "fr", "de", "it", "pt", "nl", "sv", "da", "fi", "no", "pl", "cs", "ro", "tr", "el", "ru", "uk", "ar", "hi", "bn", "ja", "ko", "zh", "th", "vi", "id", "ms",
];

export default async function ChannelSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireChannel(id);
  const [channel, templates] = await Promise.all([
    db.channel.findUnique({ where: { id } }),
    db.template.findMany({ where: { OR: [{ channelId: id }, { channelId: null }] } }),
  ]);
  if (!channel) return null;

  return (
    <div className="max-w-2xl">
      <h1 className="font-mono text-xl font-bold mb-3">Channel settings</h1>
      <form action={updateChannelSettingsAction} className="card flex flex-col gap-4">
        <input type="hidden" name="channelId" value={id} />

        <fieldset className="flex flex-col gap-3">
          <legend className="font-mono text-xs uppercase tracking-wider text-[var(--mute)]">Details</legend>
          <Field name="name" label="Channel name" defaultValue={channel.name} required />
          <Field name="linkedYoutubeHandle" label="Linked YouTube handle" defaultValue={channel.linkedYoutubeHandle ?? ""} placeholder="@example" />
          <TextArea name="nicheDescription" label="Niche description" defaultValue={channel.nicheDescription ?? ""} />
          <TextArea name="differentiation" label="Differentiation" defaultValue={channel.differentiation ?? ""} />
        </fieldset>

        <fieldset className="flex flex-col gap-3 border-t border-[var(--line)] pt-4">
          <legend className="font-mono text-xs uppercase tracking-wider text-[var(--mute)]">Script defaults</legend>
          <SelectField name="defaultModel" label="Default draft model" defaultValue={channel.defaultModel ?? ""}>
            <option value="">Workspace default</option>
            {MODELS.filter((m) => m.provider !== "mock").map((m) => (
              <option key={m.id} value={m.id}>{m.label} — {m.style}</option>
            ))}
          </SelectField>
          <SelectField name="defaultLanguage" label="Default language" defaultValue={channel.defaultLanguage ?? "en"}>
            {LANGS.map((l) => (<option key={l} value={l}>{l}</option>))}
          </SelectField>
          <SelectField name="defaultTemplateId" label="Default template" defaultValue={channel.defaultTemplateId ?? ""}>
            <option value="">No default</option>
            {templates.map((t) => (<option key={t.id} value={t.id}>{t.name} ({t.kind})</option>))}
          </SelectField>
        </fieldset>

        <div className="flex justify-end">
          <button type="submit" className="btn primary">Save settings</button>
        </div>
      </form>
    </div>
  );
}

function Field(props: { name: string; label: string; defaultValue?: string; placeholder?: string; required?: boolean }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-mono uppercase text-[var(--mute)]">{props.label}</span>
      <input
        name={props.name}
        defaultValue={props.defaultValue}
        placeholder={props.placeholder}
        required={props.required}
        className="border border-[var(--line-2)] rounded-lg p-2 text-sm"
      />
    </label>
  );
}

function TextArea(props: { name: string; label: string; defaultValue?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-mono uppercase text-[var(--mute)]">{props.label}</span>
      <textarea
        name={props.name}
        defaultValue={props.defaultValue}
        rows={3}
        className="border border-[var(--line-2)] rounded-lg p-2 text-sm"
      />
    </label>
  );
}

function SelectField(props: { name: string; label: string; defaultValue?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-mono uppercase text-[var(--mute)]">{props.label}</span>
      <select name={props.name} defaultValue={props.defaultValue} className="border border-[var(--line-2)] rounded-lg p-2 text-sm">
        {props.children}
      </select>
    </label>
  );
}
