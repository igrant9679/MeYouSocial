import { requireRole } from "@/lib/acl";
import { startOnboardingAction } from "@/app/actions/onboarding";
import { StepHeader } from "@/components/onboarding/StepHeader";

// MU-12 — Onboarding Wizard, step 1.
// FR-ONB-01: capture niche/content description.
// FR-ONB-02: presentation style — Personality (on-camera) vs Faceless.
// FR-ONB-03: choose path — link existing YouTube channel or start a custom channel.

export default async function OnboardingStartPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireRole("EDITOR");
  const { error } = await searchParams;

  return (
    <div className="max-w-2xl mx-auto">
      <StepHeader step={1} total={5} title="Tell us about your channel" subtitle="We'll use this to train your voice, audience avatar, and starter ideas." />

      <form action={startOnboardingAction} className="card flex flex-col gap-5 mt-5">
        {error && <p className="text-sm text-[var(--brand)]">Please fill in every field — at least 10 characters for the niche.</p>}

        <label className="flex flex-col gap-1">
          <span className="text-xs font-mono uppercase text-[var(--mute)]">What's your channel about? (FR-ONB-01)</span>
          <textarea name="niche" required minLength={10} rows={4} placeholder="e.g. Evidence-based productivity for knowledge workers. Less hustle, more systems." className="border border-[var(--line-2)] rounded-lg p-3 text-sm" />
        </label>

        <fieldset className="flex flex-col gap-1">
          <span className="text-xs font-mono uppercase text-[var(--mute)]">Presentation style (FR-ONB-02)</span>
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
          <span className="text-xs font-mono uppercase text-[var(--mute)]">Path (FR-ONB-03)</span>
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
          <button type="submit" className="btn primary">Continue →</button>
        </div>
      </form>
    </div>
  );
}
