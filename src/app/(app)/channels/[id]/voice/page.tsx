import { requireChannel } from "@/lib/channel";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import {
  refineVoiceSimpleAction,
  updateVoiceAdvancedAction,
  generateVoicePreviewAction,
} from "@/app/actions/voice";

// MU-03 — Voice editor. FR-VOICE-01..04, 08.

export default async function ChannelVoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireChannel(id);
  const profile = await db.voiceProfile.findFirst({
    where: { channelId: id, isDefault: true },
  });

  if (!profile) {
    return (
      <div className="card text-center py-10">
        <p className="text-sm text-[var(--mute)]">No voice profile yet. It's still generating after onboarding — refresh in a few seconds.</p>
      </div>
    );
  }

  const data = readJson<{
    archetype?: Record<string, string>;
    delivery?: Record<string, string>;
    rhetoric?: Record<string, unknown>;
    diction?: Record<string, unknown>;
    extras?: Record<string, unknown>;
    _lastInstruction?: string;
    _refined?: string;
    _preview?: string;
    summary?: string;
  }>(profile.data, {});

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <section className="card">
        <h2 className="font-mono text-[15px] mb-3">Simple mode (FR-VOICE-03)</h2>
        <p className="text-xs text-[var(--mute)] mb-3">Refine your voice with plain-language instructions.</p>
        <form action={refineVoiceSimpleAction} className="flex flex-col gap-2">
          <input type="hidden" name="channelId" value={id} />
          <input type="hidden" name="voiceId" value={profile.id} />
          <input name="instruction" placeholder="e.g. more casual, shorter sentences" className="border border-[var(--line-2)] rounded-lg p-2 text-sm" required />
          <div className="flex justify-end">
            <button type="submit" className="btn primary sm">Apply</button>
          </div>
        </form>
        {data._lastInstruction && (
          <div className="mt-4 text-xs">
            <div className="font-mono uppercase text-[var(--mute)] mb-1">Last instruction</div>
            <div className="bg-[var(--zebra)] rounded-md p-2">{data._lastInstruction}</div>
          </div>
        )}

        <form action={generateVoicePreviewAction} className="mt-4">
          <input type="hidden" name="channelId" value={id} />
          <input type="hidden" name="voiceId" value={profile.id} />
          <button type="submit" className="btn">Generate preview (FR-VOICE-08)</button>
        </form>
        {data._preview && (
          <div className="mt-3 text-sm bg-[var(--zebra)] rounded-md p-3 whitespace-pre-wrap">{data._preview}</div>
        )}
      </section>

      <section className="card">
        <h2 className="font-mono text-[15px] mb-3">Advanced mode (FR-VOICE-04)</h2>
        <p className="text-xs text-[var(--mute)] mb-3">Edit the structured voice payload directly. Archetype · Delivery · Rhetoric · Diction · Extras.</p>
        <form action={updateVoiceAdvancedAction} className="flex flex-col gap-2">
          <input type="hidden" name="channelId" value={id} />
          <input type="hidden" name="voiceId" value={profile.id} />
          <textarea
            name="data"
            rows={20}
            defaultValue={JSON.stringify(data, null, 2)}
            className="border border-[var(--line-2)] rounded-lg p-2 text-xs font-mono"
          />
          <div className="flex justify-end">
            <button type="submit" className="btn primary sm">Save</button>
          </div>
        </form>
      </section>
    </div>
  );
}
