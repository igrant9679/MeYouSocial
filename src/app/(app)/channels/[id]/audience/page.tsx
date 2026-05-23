import { requireChannel } from "@/lib/channel";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import {
  updateAudienceSectionAction,
  refreshAudienceAction,
  generateAudiencePhotoAction,
} from "@/app/actions/audience";

// MU-13 — Audience Avatar. FR-AUD-01/02/03/04/05.

const SECTIONS = [
  { key: "demographics", label: "Demographics" },
  { key: "psychographics", label: "Psychographics" },
  { key: "onlineBehavior", label: "Online behavior" },
  { key: "offlineBehavior", label: "Offline behavior" },
] as const;

export default async function ChannelAudiencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireChannel(id);
  const audience = await db.audienceAvatar.findUnique({ where: { channelId: id } });

  if (!audience) {
    return (
      <div className="card text-center py-10">
        <p className="text-sm text-[var(--mute)] mb-3">No audience avatar yet.</p>
        <form action={refreshAudienceAction}>
          <input type="hidden" name="channelId" value={id} />
          <button type="submit" className="btn primary">Generate audience avatar</button>
        </form>
      </div>
    );
  }

  const keyQuestions = readJson<string[]>(audience.keyQuestions, []);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <aside className="card">
        <h2 className="font-mono text-[15px] mb-3">Audience photo</h2>
        {audience.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={audience.photoUrl} alt="Audience" className="w-full aspect-square object-cover rounded-xl mb-3" />
        ) : (
          <div className="w-full aspect-square rounded-xl mb-3 bg-[var(--panel)] grid place-items-center text-xs text-[var(--mute)] font-mono">No photo yet</div>
        )}
        <form action={generateAudiencePhotoAction}>
          <input type="hidden" name="channelId" value={id} />
          <button type="submit" className="btn w-full">{audience.photoUrl ? "Refresh photo" : "Generate photo"}</button>
        </form>
        <form action={refreshAudienceAction} className="mt-3">
          <input type="hidden" name="channelId" value={id} />
          <button type="submit" className="btn w-full" title="Re-generate avatar from latest YouTube data (overwrites edits)">Refresh avatar from YT data</button>
        </form>
      </aside>

      <div className="lg:col-span-2 flex flex-col gap-3">
        {SECTIONS.map((s) => {
          const value = readJson<{ summary?: string }>(audience[s.key] as string, {});
          return (
            <section key={s.key} className="card">
              <h2 className="font-mono text-[15px] mb-3">{s.label}</h2>
              <form action={updateAudienceSectionAction} className="flex flex-col gap-2">
                <input type="hidden" name="channelId" value={id} />
                <input type="hidden" name="section" value={s.key} />
                <textarea
                  name="value"
                  rows={3}
                  defaultValue={value.summary ?? ""}
                  className="border border-[var(--line-2)] rounded-lg p-2 text-sm"
                />
                <div className="flex justify-end">
                  <button type="submit" className="btn sm">Save</button>
                </div>
              </form>
            </section>
          );
        })}

        <section className="card">
          <h2 className="font-mono text-[15px] mb-3">Key questions they ask</h2>
          <form action={updateAudienceSectionAction} className="flex flex-col gap-2">
            <input type="hidden" name="channelId" value={id} />
            <input type="hidden" name="section" value="keyQuestions" />
            <textarea
              name="value"
              rows={6}
              defaultValue={keyQuestions.join("\n")}
              placeholder="One question per line"
              className="border border-[var(--line-2)] rounded-lg p-2 text-sm"
            />
            <div className="flex justify-end">
              <button type="submit" className="btn sm">Save</button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
