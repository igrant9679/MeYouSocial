import { requireChannel } from "@/lib/channel";
import { SubmitButton } from "@/components/SubmitButton";
import { db } from "@/lib/db";
import { MODELS } from "@/lib/llm/models";
import { updateChannelSettingsAction } from "@/app/actions/channel-settings";
import { relinkYoutubeAction, setBusinessChannelAction } from "@/app/actions/channel-extras";
import { updateThumbnailConfigAction } from "@/app/actions/final-pass";
import { ModelChip } from "@/components/ModelChip";
import { readJson } from "@/lib/db/json";

// Channel Settings: details, linked YouTube, Script Defaults.

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
    <div className="w-full">
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
              <option key={m.id} value={m.id}>{m.label} — {m.style} (speed: {m.speed}, length: {m.lengthAdherence})</option>
            ))}
          </SelectField>
          {channel.defaultModel && (() => {
            const m = MODELS.find((x) => x.id === channel.defaultModel);
            return m ? <div className="mt-1 -mb-2">Current: <ModelChip model={m} /></div> : null;
          })()}
          <SelectField name="defaultLanguage" label="Default language" defaultValue={channel.defaultLanguage ?? "en"}>
            {LANGS.map((l) => (<option key={l} value={l}>{l}</option>))}
          </SelectField>
          <SelectField name="defaultTemplateId" label="Default template" defaultValue={channel.defaultTemplateId ?? ""}>
            <option value="">No default</option>
            {templates.map((t) => (<option key={t.id} value={t.id}>{t.name} ({t.kind})</option>))}
          </SelectField>
        </fieldset>

        <div className="flex justify-end">
          <SubmitButton className="btn primary">Save settings</SubmitButton>
        </div>
      </form>

      {/* Relink YouTube channel (triggers voice + audience re-train) */}
      <form action={relinkYoutubeAction} className="card flex items-end gap-2 mt-4">
        <input type="hidden" name="channelId" value={id} />
        <label className="flex-1 flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Relink YouTube channel — re-trains voice + audience</span>
          <input name="handle" required placeholder="@new-handle" className="border border-[var(--line-2)] rounded-lg p-2 text-sm font-mono" />
        </label>
        <button type="submit" className="btn">Relink & retrain</button>
      </form>

      {/* Business / brand channel toggle */}
      <form action={setBusinessChannelAction} className="card flex items-center gap-3 mt-4">
        <input type="hidden" name="channelId" value={id} />
        <input type="hidden" name="business" value={channel.presentationStyle === "business" ? "0" : "1"} />
        <div className="flex-1">
          <div className="text-sm font-semibold">Business / brand channel</div>
          <p className="text-xs text-[var(--mute)]">Currently: <b>{channel.presentationStyle}</b>. Business channels represent a company or product rather than a person.</p>
        </div>
        <button type="submit" className="btn">{channel.presentationStyle === "business" ? "Switch to personality" : "Mark as business"}</button>
      </form>

      {/* Thumbnail brand assets + soft limit */}
      {(() => {
        const cfg = readJson<{ palette?: string; typography?: string; facePosition?: string; styleNotes?: string; logoUrl?: string }>(channel.thumbnailConfig ?? null, {});
        return (
          <form action={updateThumbnailConfigAction} className="card flex flex-col gap-3 mt-4">
            <h2 className="font-mono font-bold text-[14px]">Thumbnail brand & limits</h2>
            <input type="hidden" name="channelId" value={id} />
            <Field name="palette" label="Palette (hex / names)" defaultValue={cfg.palette ?? ""} placeholder="e.g. #E5482F, off-white, charcoal" />
            <Field name="typography" label="Typography" defaultValue={cfg.typography ?? ""} placeholder="e.g. Bold sans, max 4 words, all-caps last word" />
            <Field name="facePosition" label="Face position / composition" defaultValue={cfg.facePosition ?? ""} placeholder="e.g. tight crop, eyes upper-third" />
            <Field name="logoUrl" label="Brand logo URL" defaultValue={cfg.logoUrl ?? ""} placeholder="https://…" />
            <TextArea name="styleNotes" label="Other style notes" defaultValue={cfg.styleNotes ?? ""} />
            <Field name="limitThumbnailsPerMonth" label="Max thumbnails per month (0 = unlimited)" defaultValue={String(channel.limitThumbnailsPerMonth ?? "")} placeholder="0" />
            <div className="flex justify-end"><SubmitButton className="btn primary sm">Save thumbnail config</SubmitButton></div>
          </form>
        );
      })()}
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
