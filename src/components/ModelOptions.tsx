import type { ModelChoice } from "@/lib/llm";
import { PROVIDER_LABEL, modelLabel } from "@/lib/llm/models";

// A model picker's options (audit SET-01): only models the router can call. One
// whose provider has no key here is listed but can't be picked. A choice saved
// before this check stays selectable, so an unrelated save doesn't change it —
// ModelChoiceNote says what runs instead.

export function ModelOptions({ choices, current, detail = false }: { choices: ModelChoice[]; current?: string | null; detail?: boolean }) {
  const legacy = current && !choices.some((m) => m.id === current) ? current : null;
  return (
    <>
      {legacy && <option value={legacy}>{modelLabel(legacy)} (saved earlier — can&apos;t write here)</option>}
      {choices.map((m) => (
        <option key={m.id} value={m.id} disabled={!m.keyed && m.id !== current}>
          {m.label}{detail ? ` — ${m.style}` : ""}{m.keyed ? "" : ` (no ${PROVIDER_LABEL[m.provider] ?? m.provider} key)`}
        </option>
      ))}
    </>
  );
}

/** Under a picker: what actually writes when the saved choice can't, or that nothing can. */
export function ModelChoiceNote({ choices, current, runs }: { choices: ModelChoice[]; current?: string | null; runs: string }) {
  const style = { color: "var(--rose-on)" };
  if (!choices.some((m) => m.keyed)) {
    return <p className="text-[11px] mt-1" style={style}>No Claude or Gemini key resolves here, so AI text is a placeholder until one is added under Settings → Keys.</p>;
  }
  if (!current) return null;
  const m = choices.find((x) => x.id === current);
  if (m?.keyed) return null;
  const why = m ? `there's no ${PROVIDER_LABEL[m.provider] ?? m.provider} API key here` : "this app can't write with it";
  return <p className="text-[11px] mt-1" style={style}>Saved choice {modelLabel(current)}: {why}, so {modelLabel(runs)} writes instead.</p>;
}
