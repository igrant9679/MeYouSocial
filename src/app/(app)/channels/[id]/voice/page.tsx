import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { Mic2, Plus, Star, Trash2, FileText, Sparkles } from "lucide-react";
import { requireChannel } from "@/lib/channel";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import {
  refineVoiceSimpleAction,
  updateVoiceAdvancedAction,
  generateVoicePreviewAction,
  addVoiceSampleAction,
  removeVoiceSampleAction,
  borrowVoiceAction,
  createVoiceProfileAction,
  setDefaultVoiceAction,
  deleteVoiceProfileAction,
  retrainVoiceFromSamplesAction,
} from "@/app/actions/voice";
import { canEdit } from "@/lib/acl";
import { listVersions, voiceSnapshot } from "@/lib/profile-versions";
import { displayTimeZone } from "@/lib/display-zone";
import { ProfileVersions } from "@/components/ProfileVersions";

// MU-03 — Voice editor. Implements..08:
//   01 auto-train · 02 baseline · 03 Simple · 04 Advanced · 05 samples ·
//   06 borrow-a-voice · 07 multiple profiles per channel · 08 instant preview.

type VoiceData = {
  archetype?: Record<string, string>;
  delivery?: Record<string, string>;
  rhetoric?: Record<string, unknown>;
  diction?: Record<string, unknown>;
  extras?: Record<string, unknown>;
  _lastInstruction?: string;
  _refined?: string;
  _preview?: string;
  summary?: string;
  borrowedFrom?: string;
  /** Written by onboarding.voice — what, if anything, actually trained this. */
  source?: { trained?: boolean; basis?: string; videos?: number; transcripts?: number; reason?: string };
};

type Sample = { id: string; label: string; chars: number; body: string };

export default async function ChannelVoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ profile?: string; error?: string; ok?: string; err?: string }>;
}) {
  const { id } = await params;
  const { profile: profileParam, error, ok, err } = await searchParams;
  const { workspace, membership } = await requireChannel(id);
  const editor = canEdit(membership.role);

  const profiles = await db.voiceProfile.findMany({
    where: { channelId: id },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  if (profiles.length === 0) {
    return (
      <div className="card text-center py-10">
        <p className="text-sm text-[var(--mute)]">No voice profile yet. It&apos;s still generating after onboarding — refresh in a few seconds.</p>
      </div>
    );
  }

  const active = profiles.find((p) => p.id === profileParam) ?? profiles.find((p) => p.isDefault) ?? profiles[0];
  const data = readJson<VoiceData>(active.data, {});
  const samples = readJson<Sample[]>(active.samples, []);
  // E-SET-07: every refine, retrain, edit and restore of this profile.
  const [versions, readTz] = await Promise.all([listVersions("voice", active.id, voiceSnapshot(active.data)), displayTimeZone(workspace.id)]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
      {/* Profile sidebar */}
      <aside className="card p-3 h-fit">
        <div className="flex items-center gap-2 mb-3">
          <Mic2 className="w-4 h-4" style={{ color: "var(--accent)" }} />
          <h2 className="font-mono font-bold text-xs uppercase tracking-wider">Profiles ({profiles.length})</h2>
        </div>
        <ul className="m-0 p-0 flex flex-col gap-1 mb-3">
          {profiles.map((p) => (
            <li key={p.id}>
              <Link
                href={`/channels/${id}/voice?profile=${p.id}`}
                className={"flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition " + (p.id === active.id ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--slate)] hover:bg-[var(--zebra)]")}
              >
                {p.isDefault && <Star className="w-3.5 h-3.5" fill="currentColor" style={{ color: "#D97706" }} />}
                <span className="truncate flex-1">{p.label}</span>
              </Link>
            </li>
          ))}
        </ul>

        <form action={createVoiceProfileAction} className="border-t border-[var(--line)] pt-3 flex flex-col gap-2">
          <input type="hidden" name="channelId" value={id} />
          <input name="label" required placeholder="New profile name" className="border border-[var(--line-2)] rounded-md p-1.5 text-xs" />
          <button type="submit" className="btn sm flex items-center justify-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add profile</button>
        </form>

        <form action={borrowVoiceAction} className="border-t border-[var(--line)] pt-3 mt-3 flex flex-col gap-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)]">Borrow a voice</span>
          <input type="hidden" name="channelId" value={id} />
          <input name="handle" required placeholder="@another-creator" className="border border-[var(--line-2)] rounded-md p-1.5 text-xs font-mono" />
          <input name="label" placeholder="Label (optional)" className="border border-[var(--line-2)] rounded-md p-1.5 text-xs" />
          <SubmitButton className="btn primary sm">Train from their videos</SubmitButton>
        </form>
        {error === "notfound" && <p className="text-xs text-[var(--brand)] mt-2">Channel not found for that handle.</p>}
      </aside>

      {/* Active profile editor */}
      <div className="flex flex-col gap-4">
        <div className="card flex items-center gap-3">
          <div className="flex-1">
            <h1 className="font-mono font-bold text-xl leading-tight flex items-center gap-2">
              {active.label}
              {active.isDefault && <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>default</span>}
              {data.borrowedFrom && <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>borrowed from {data.borrowedFrom}</span>}
            </h1>
            {/* A profile the AI wrote from PLACEHOLDER data says so in its own
                text (tracker #24: LSI's default voice read "INCOMPLETE - MOCK
                DATA DETECTED"). The page says it louder, and what to do. */}
            {/mock (data|transcripts)|INCOMPLETE\s*-\s*MOCK|INSUFFICIENT DATA/i.test(data.summary ?? "") ? (
              <p className="text-[11px] mt-0.5" style={{ color: "var(--rose-on)" }} data-voice-placeholder>
                <b>Built from placeholder data</b> — the AI says so in its own summary; it was made before real YouTube data could be read.
                {active.isDefault ? " Scripts on this channel use it as their default voice. " : " "}
                {data.borrowedFrom ? `Borrow ${data.borrowedFrom} again, ` : "Retrain it from writing samples, "}or make another profile the default.
              </p>
            ) : !data.source ? (
              <p className="text-[11px] text-[var(--mute)] mt-0.5" data-voice-unrecorded>
                No record of what built this voice — profiles only started recording it on 27 Jul 2026. If it reads generic, retrain it.
              </p>
            ) : null}
            {/* An untrained profile is a generic placeholder — it must not read
                as if it were learned from the channel. Say which it is. */}
            {data.source && (
              data.source.trained ? (
                <p className="text-[11px] text-[var(--mute)] mt-0.5">
                  Trained from {data.source.basis}
                  {data.source.videos ? ` across ${data.source.videos} videos` : ""}.
                </p>
              ) : (
                <p className="text-[11px] mt-0.5" style={{ color: "var(--amber-on)" }}>
                  <b>Not trained on this channel</b> — generic starting point. {data.source.reason}
                </p>
              )
            )}
          </div>
          {!active.isDefault && (
            <form action={setDefaultVoiceAction}>
              <input type="hidden" name="voiceId" value={active.id} />
              <button type="submit" className="btn sm flex items-center gap-1.5"><Star className="w-3.5 h-3.5" /> Set default</button>
            </form>
          )}
          {!active.isDefault && (
            <form action={deleteVoiceProfileAction}>
              <input type="hidden" name="voiceId" value={active.id} />
              <button type="submit" className="btn sm" title="Delete this profile"><Trash2 className="w-3.5 h-3.5" /></button>
            </form>
          )}
        </div>

        {(ok || err) && (
          <div className="card text-sm" data-voice-flash style={{ background: ok ? "var(--green-soft)" : "var(--rose-soft)", color: ok ? "var(--green-on)" : "var(--rose-on)" }}>{ok ?? err}</div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Simple mode */}
          <section className="card">
            <h2 className="font-mono text-[14px] font-bold mb-3 flex items-center gap-2"><Sparkles className="w-4 h-4" style={{ color: "var(--accent)" }} /> Simple mode</h2>
            <p className="text-xs text-[var(--mute)] mb-3">Refine your voice with plain-language instructions.</p>
            <form action={refineVoiceSimpleAction} className="flex flex-col gap-2">
              <input type="hidden" name="channelId" value={id} />
              <input type="hidden" name="voiceId" value={active.id} />
              <input name="instruction" placeholder="e.g. more casual, shorter sentences" className="border border-[var(--line-2)] rounded-lg p-2 text-sm" required />
              <div className="flex justify-end"><SubmitButton className="btn primary sm">Apply</SubmitButton></div>
            </form>
            {data._lastInstruction && (
              <div className="mt-4 text-xs">
                <div className="font-mono uppercase text-[var(--mute)] mb-1">Last instruction</div>
                <div className="bg-[var(--zebra)] rounded-md p-2">{data._lastInstruction}</div>
              </div>
            )}

            <form action={generateVoicePreviewAction} className="mt-4">
              <input type="hidden" name="channelId" value={id} />
              <input type="hidden" name="voiceId" value={active.id} />
              <SubmitButton className="btn" pendingText="Writing a preview…">Generate preview</SubmitButton>
            </form>
            {data._preview && (
              <div className="mt-3 text-sm bg-[var(--zebra)] rounded-md p-3 whitespace-pre-wrap">{data._preview}</div>
            )}
          </section>

          {/* Advanced mode */}
          <section className="card">
            <h2 className="font-mono text-[14px] font-bold mb-3">Advanced mode</h2>
            <p className="text-xs text-[var(--mute)] mb-3">Edit the structured voice payload directly.</p>
            <form action={updateVoiceAdvancedAction} className="flex flex-col gap-2">
              <input type="hidden" name="channelId" value={id} />
              <input type="hidden" name="voiceId" value={active.id} />
              <textarea
                name="data"
                rows={16}
                defaultValue={JSON.stringify(data, null, 2)}
                className="border border-[var(--line-2)] rounded-lg p-2 text-xs font-mono"
              />
              <div className="flex justify-end"><SubmitButton className="btn primary sm">Save</SubmitButton></div>
            </form>
          </section>
        </div>

        {/* Writing samples */}
        <section className="card">
          <h2 className="font-mono text-[14px] font-bold mb-3 flex items-center gap-2"><FileText className="w-4 h-4" style={{ color: "#2563EB" }} /> Writing samples <span className="text-xs text-[var(--mute)] font-normal">— up to 50,000 chars each</span></h2>
          <p className="text-xs text-[var(--mute)] mb-3">Paste blog posts, threads, transcripts, or other scripts you&apos;ve written. More samples = better voice match — Simple mode reads them too.</p>
          {samples.length > 0 && (
            <form action={retrainVoiceFromSamplesAction} className="mb-3 flex items-center gap-2 flex-wrap">
              <input type="hidden" name="channelId" value={id} />
              <input type="hidden" name="voiceId" value={active.id} />
              <SubmitButton className="btn sm" pendingText="Retraining…" title="Re-derive this voice from the samples below — what it is now is kept as a version"><Sparkles className="w-3.5 h-3.5" /> Retrain from {samples.length} sample{samples.length === 1 ? "" : "s"}</SubmitButton>
              <span className="text-[11px] text-[var(--mute)]">Makes a new version; the one before can be restored.</span>
            </form>
          )}

          <form action={addVoiceSampleAction} className="flex flex-col gap-2 mb-4">
            <input type="hidden" name="voiceId" value={active.id} />
            <input name="label" placeholder="Sample label (e.g. Newsletter Aug 2025)" className="border border-[var(--line-2)] rounded-lg p-2 text-sm" />
            <textarea name="body" required rows={5} maxLength={50_000} placeholder="Paste up to 50,000 characters…" className="border border-[var(--line-2)] rounded-lg p-2 text-sm font-mono" />
            <div className="flex justify-end"><SubmitButton className="btn primary sm">Add sample</SubmitButton></div>
          </form>

          {samples.length === 0 && <p className="text-xs text-[var(--mute)] text-center py-2">No samples yet.</p>}
          <ul className="m-0 p-0">
            {samples.map((s) => (
              <li key={s.id} className="border-t border-[var(--line)] py-2.5 flex items-center gap-3 text-sm">
                <FileText className="w-4 h-4 text-[var(--mute)]" />
                <span className="flex-1 font-semibold">{s.label}</span>
                <span className="text-[11px] text-[var(--mute)] font-mono">{s.chars.toLocaleString()} chars</span>
                <form action={removeVoiceSampleAction}>
                  <input type="hidden" name="voiceId" value={active.id} />
                  <input type="hidden" name="sampleId" value={s.id} />
                  <button type="submit" className="btn sm" title="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
                </form>
              </li>
            ))}
          </ul>
        </section>

        <ProfileVersions versions={versions} editor={editor} timeZone={readTz} noun="voice" />
      </div>
    </div>
  );
}
