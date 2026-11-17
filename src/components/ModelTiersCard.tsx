import { Layers } from "lucide-react";
import { SubmitButton } from "@/components/SubmitButton";
import { ModelOptions, ModelChoiceNote } from "@/components/ModelOptions";
import { DialNote } from "@/components/DialNote";
import { lightModelChoices, modelChoices, tierRuns } from "@/lib/llm";
import { modelLabel } from "@/lib/llm/models";
import { ALLOW_DEEPSEEK_KEY, PURPOSE_TIER, TIERS, TIERS_ON_KEY, TIER_LABEL, TIER_MODEL_KEY, ELSIE_TIER_KEY, autoTierModel, tierOf, type Tier } from "@/lib/llm/tiers";
import { PURPOSE_LABEL } from "@/lib/ai-spend";
import { lastSettingChanges, type DialChange } from "@/lib/setting-history";
import { saveModelTiersAction } from "@/app/actions/model-tiers";

// Settings → Workspace: a model for each kind of job (lib/llm/tiers.ts).
// Standard is the default model picked in the form above — there is no second
// picker for it. Everything listed here is read from the same map the router uses.

const WHAT: Record<Tier, string> = {
  light: "Short jobs a person sees and can fix in seconds.",
  standard: "Everything else.",
  best: "The long writing, and the review that decides whether it may publish.",
};

export async function ModelTiersCard({ workspaceId, timeZone }: { workspaceId: string; timeZone: string }) {
  const [runs, choices, lightChoices, changes] = await Promise.all([
    tierRuns(workspaceId),
    modelChoices(workspaceId),
    lightModelChoices(workspaceId),
    lastSettingChanges(workspaceId, [TIERS_ON_KEY, TIER_MODEL_KEY.light, TIER_MODEL_KEY.best, ELSIE_TIER_KEY, ALLOW_DEEPSEEK_KEY]).catch(() => new Map<string, DialChange>()),
  ]);
  const s = runs.settings;
  const jobs = (tier: Tier) => Object.keys(PURPOSE_TIER).filter((p) => tierOf(p, s.elsie) === tier).map((p) => PURPOSE_LABEL[p] ?? p);
  const onOff = (v: string | null) => (v === "on" ? "on" : "off");
  const picked = (v: string | null) => (v ? modelLabel(v) : "automatic");
  const select = "border border-[var(--line-2)] rounded-lg p-2 text-sm";
  const eyebrow = "text-micro font-mono uppercase tracking-wider text-[var(--mute)]";

  return (
    <form id="tiers" action={saveModelTiersAction} className="card flex flex-col gap-4 mt-3 scroll-mt-20" data-model-tiers={s.on ? "on" : "off"}>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl grid place-items-center shrink-0" style={{ background: "var(--violet-soft)", color: "var(--violet)" }}>
          <Layers className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div>
          <h2 className="font-mono font-bold text-sm leading-tight m-0">A model for each kind of job</h2>
          <p className="text-xs text-[var(--mute)] m-0 mt-0.5">
            Off, every job uses the default model above. On, short jobs run on a lighter model and the biggest ones on the best.
            A model chosen on an article, a script or a channel is never replaced.
          </p>
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="tiers" defaultChecked={s.on} className="mt-0.5" />
        <span>
          Match the model to the job
          <DialNote change={changes.get(TIERS_ON_KEY)} timeZone={timeZone} fmt={onOff} />
        </span>
      </label>

      <div className="grid gap-3 md:grid-cols-3">
        {TIERS.map((tier) => (
          <div key={tier} className="rounded-xl border border-[var(--line)] p-3 flex flex-col gap-2" data-tier={tier} data-tier-runs={runs[tier]}>
            <div>
              <div className="font-mono font-bold text-sm">{TIER_LABEL[tier]}</div>
              <div className="text-2xs text-[var(--mute)]">{WHAT[tier]}</div>
            </div>
            {tier === "standard" ? (
              <div className="text-sm">
                <span className={eyebrow}>Model</span>
                <div>{modelLabel(runs.standard)} <span className="text-2xs text-[var(--mute)]">— the default model above</span></div>
              </div>
            ) : (
              <label className="flex flex-col gap-1">
                <span className={eyebrow}>Model</span>
                <select key={`${tier}:${s[tier]}`} name={tier} defaultValue={s[tier]} className={select}>
                  <option value="">Automatic ({modelLabel(autoTierModel(tier, runs.standard))})</option>
                  <ModelOptions choices={tier === "light" ? lightChoices : choices} current={s[tier]} />
                </select>
                <ModelChoiceNote choices={tier === "light" ? lightChoices : choices} current={s[tier]} runs={runs[tier]} />
                <DialNote change={changes.get(TIER_MODEL_KEY[tier])} timeZone={timeZone} fmt={picked} />
              </label>
            )}
            <ul className="m-0 pl-4 text-2xs text-[var(--mute)] leading-snug" data-tier-jobs={tier}>
              {jobs(tier).map((j) => <li key={j}>{j}</li>)}
            </ul>
          </div>
        ))}
      </div>

      <label className="flex flex-col gap-1">
        <span className={eyebrow}>Elsie&apos;s own replies use</span>
        <select key={`elsie:${s.elsie}`} name="elsie" defaultValue={s.elsie} className={`${select} md:max-w-xs`}>
          <option value="light">Light</option>
          <option value="standard">Standard (the usual)</option>
          <option value="best">Best</option>
        </select>
        <span className="text-2xs text-[var(--mute)]">
          On Light she answers questions on the lighter model; anything she would change is asked again of the Standard model first, and still waits for your Yes.
        </span>
        <DialNote change={changes.get(ELSIE_TIER_KEY)} timeZone={timeZone} fmt={(v) => (v ? v : "standard")} />
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="allowDeepseek" defaultChecked={s.deepseek} className="mt-0.5" />
        <span>
          Allow DeepSeek for this workspace
          <span className="block text-2xs text-[var(--mute)]">
            DeepSeek Flash can only be the Light model. DeepSeek&apos;s privacy policy says it processes and stores what it is sent in China and may use it to improve its models —
            for Light jobs that is your brand context and the text of the articles and posts those jobs work on, and your conversations with Elsie if she is set to Light. It needs a DeepSeek key under Settings → Keys, and picking it checks that key with one short call.
          </span>
          <DialNote change={changes.get(ALLOW_DEEPSEEK_KEY)} timeZone={timeZone} fmt={onOff} />
        </span>
      </label>

      <div className="flex justify-end"><SubmitButton className="btn primary">Save model choices</SubmitButton></div>
    </form>
  );
}
