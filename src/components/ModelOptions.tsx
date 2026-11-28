import type { ModelChoice } from "@/lib/llm";
import { PROVIDER_LABEL, modelLabel } from "@/lib/llm/models";

// A model picker's options (audit SET-01): only models the router can call. One
// whose provider has no key here is listed but can't be picked. A choice saved
// before this check stays selectable, so an unrelated save doesn't change it —
// ModelChoiceNote says what runs instead.
//
// OpenRouter's models (2026-11-27) come in their own group, newest Claude Sonnet first, each
// with OpenRouter's listed price — present only while an OpenRouter key resolves here.

export function ModelOptions({ choices, current, detail = false }: { choices: ModelChoice[]; current?: string | null; detail?: boolean }) {
  const legacy = current && !choices.some((m) => m.id === current) ? current : null;
  const own = choices.filter((m) => m.provider !== "openrouter");
  const routed = choices.filter((m) => m.provider === "openrouter");
  const option = (m: ModelChoice, withStyle: boolean) => (
    <option key={m.id} value={m.id} disabled={!m.keyed && m.id !== current}>
      {m.label}{withStyle ? ` — ${m.style}` : ""}{m.keyed ? "" : ` (no ${PROVIDER_LABEL[m.provider] ?? m.provider} key)`}
    </option>
  );
  return (
    <>
      {legacy && <option value={legacy}>{modelLabel(legacy)} (saved earlier — can&apos;t write here)</option>}
      {own.map((m) => option(m, detail))}
      {routed.length > 0 && (
        // The price is shown on every OpenRouter option: hundreds of models, and the price is how people choose between them.
        <optgroup label={`OpenRouter — ${routed.length} models`}>
          {routed.map((m, i) => option({ ...m, label: i === 0 ? `${m.label} (OpenRouter's default)` : m.label }, true))}
        </optgroup>
      )}
    </>
  );
}

/** Under a picker: what actually writes when the saved choice can't, or that nothing can. */
export function ModelChoiceNote({ choices, current, runs }: { choices: ModelChoice[]; current?: string | null; runs: string }) {
  const style = { color: "var(--rose-on)" };
  if (!choices.some((m) => m.keyed)) {
    return <p className="text-2xs mt-1" style={style}>No Claude, Gemini or OpenRouter key resolves here, so AI text is a placeholder until one is added under Settings → Keys.</p>;
  }
  // The router resolved the saved choice itself (an OpenRouter model while its list can't be read, say): nothing to explain.
  if (!current || runs === current) return null;
  const m = choices.find((x) => x.id === current);
  if (m?.keyed) return null;
  const why = m ? `there's no ${PROVIDER_LABEL[m.provider] ?? m.provider} API key here` : "this app can't write with it";
  return <p className="text-2xs mt-1" style={style}>Saved choice {modelLabel(current)}: {why}, so {modelLabel(runs)} writes instead.</p>;
}
