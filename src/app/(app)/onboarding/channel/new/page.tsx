import Link from "next/link";
import { requireRole, canAdmin } from "@/lib/acl";
import { SubmitButton } from "@/components/SubmitButton";
import { startOnboardingAction, discardDraftChannelAction, clearStaleDraftChannelsAction } from "@/app/actions/onboarding";
import { draftChannels, mayCreateChannels, STALE_DRAFT_DAYS } from "@/lib/channel-drafts";
import { EmptyState } from "@/components/EmptyState";
import { formatDay } from "@/lib/zoned-dates";
import { StepHeader } from "@/components/onboarding/StepHeader";
import { AiAssist } from "@/components/AiAssist";

// MU-12 — Onboarding Wizard, step 1.
// capture niche/content description.
// presentation style — Personality (on-camera) vs Faceless.
// choose path — link existing YouTube channel or start a custom channel.

export default async function OnboardingStartPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { workspace, membership } = await requireRole("EDITOR");
  const { error } = await searchParams;
  // Who may start a channel is a workspace dial (E-SET-09) — an editor turned away is told why here.
  if (!(await mayCreateChannels(workspace.id, membership.role))) {
    return (
      <main className="max-w-2xl mx-auto" data-channel-creators="admins">
        <EmptyState line="Only admins start channels in this workspace." note="An admin set this under Settings → Workspace. Ask one to start the channel, or to let editors do it." action={{ label: "Back to the Inbox", href: "/inbox" }} />
      </main>
    );
  }
  const drafts = await draftChannels(workspace.id);
  const admin = canAdmin(membership.role);
  const stale = drafts.filter((d) => d.stale).length;

  return (
    <div className="max-w-2xl mx-auto">
      <StepHeader step={1} total={5} title="Tell us about your channel" subtitle="We'll use this to train your voice, audience avatar, and starter ideas." />

      {/* Wizards left half-way (E-SET-09): pick one up where it stopped, or let it go. */}
      {drafts.length > 0 && (
        <section className="card mt-5" data-draft-channels>
          <div className="flex items-center gap-2 mb-2">
            <h2 className="font-mono font-bold text-[13px] m-0">Unfinished channels ({drafts.length})</h2>
            <span className="flex-1" />
            {admin && stale > 0 && (
              <form action={clearStaleDraftChannelsAction}>
                <SubmitButton className="btn sm" pendingText="Clearing…" title={`Delete every empty draft untouched for ${STALE_DRAFT_DAYS} days`}>Clear {stale} older than {STALE_DRAFT_DAYS} days</SubmitButton>
              </form>
            )}
          </div>
          <ul className="m-0 p-0 list-none flex flex-col">
            {drafts.map((d) => (
              <li key={d.id} className="border-t border-[var(--line)] first:border-t-0 py-1.5 flex flex-wrap items-center gap-2 text-sm" data-draft={d.id}>
                <span className="font-semibold flex-1 min-w-0 truncate">{d.name}</span>
                <span className="text-[11px] text-[var(--mute)]">started {formatDay(d.createdAt)}</span>
                <Link href={d.resume} className="btn sm">Resume →</Link>
                {d.empty ? (
                  <form action={discardDraftChannelAction}>
                    <input type="hidden" name="channelId" value={d.id} />
                    <SubmitButton className="btn sm" pendingText="Discarding…">Discard</SubmitButton>
                  </form>
                ) : <span className="text-[11px] text-[var(--mute)]" title="It has content on it">an admin deletes it from its settings</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <form action={startOnboardingAction} className="card flex flex-col gap-5 mt-5">
        {error && <p className="text-sm text-[var(--brand)]">Please fill in every field — at least 10 characters for the niche.</p>}

        <label className="flex flex-col gap-1">
          <span className="text-xs font-mono uppercase text-[var(--mute)]">What&apos;s your channel about?</span>
          <textarea name="niche" required minLength={10} rows={4} placeholder="e.g. Evidence-based productivity for knowledge workers. Less hustle, more systems." className="border border-[var(--line-2)] rounded-lg p-3 text-sm" />
        </label>
        {/* No channel exists yet at step 1, so this drafts from the company
            profile alone — thin, but better than a blank box for someone who
            doesn't know what "niche description" is supposed to contain. */}
        <AiAssist field="channel.nicheDescription" target="niche" />

        <fieldset className="flex flex-col gap-1">
          <span className="text-xs font-mono uppercase text-[var(--mute)]">Presentation style</span>
          <div className="grid grid-cols-2 gap-3 mt-1">
            <label className="card cursor-pointer flex items-start gap-3 has-[input:checked]:border-[var(--accent)] has-[input:checked]:bg-[var(--accent-soft)]">
              <input type="radio" name="style" value="personality" defaultChecked className="mt-1" />
              <div>
                <div className="font-semibold">Personality</div>
                <div className="text-xs text-[var(--mute)]">On-camera creator. Voice mirrors how you speak.</div>
              </div>
            </label>
            <label className="card cursor-pointer flex items-start gap-3 has-[input:checked]:border-[var(--accent)] has-[input:checked]:bg-[var(--accent-soft)]">
              <input type="radio" name="style" value="faceless" className="mt-1" />
              <div>
                <div className="font-semibold">Faceless</div>
                <div className="text-xs text-[var(--mute)]">Topic / voiceover / B-roll. Voice optimized for AI narration.</div>
              </div>
            </label>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-1">
          <span className="text-xs font-mono uppercase text-[var(--mute)]">Path</span>
          <div className="grid grid-cols-2 gap-3 mt-1">
            <label className="card cursor-pointer flex items-start gap-3 has-[input:checked]:border-[var(--accent)] has-[input:checked]:bg-[var(--accent-soft)]">
              <input type="radio" name="path" value="youtube" defaultChecked className="mt-1" />
              <div>
                <div className="font-semibold">Link existing YouTube channel</div>
                <div className="text-xs text-[var(--mute)]">No YouTube login required. We use only public data.</div>
              </div>
            </label>
            <label className="card cursor-pointer flex items-start gap-3 has-[input:checked]:border-[var(--accent)] has-[input:checked]:bg-[var(--accent-soft)]">
              <input type="radio" name="path" value="custom" className="mt-1" />
              <div>
                <div className="font-semibold">Start a new channel</div>
                <div className="text-xs text-[var(--mute)]">Pre-launch / planning. Name + description only.</div>
              </div>
            </label>
          </div>
        </fieldset>

        <div className="flex justify-end">
          <SubmitButton className="btn primary">Continue →</SubmitButton>
        </div>
      </form>
    </div>
  );
}
