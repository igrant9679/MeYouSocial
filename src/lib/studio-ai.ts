import type { LLMResponse } from "@/lib/llm";

// The studio writes only what a real model wrote (audit VID-05). Before this,
// a keyless workspace or a long script that hit the router's 45 s timeout got
// the mock's prose stored as the script, the outline, a humanized pass or a
// thumbnail concept — fluent, plausible, and nobody's.

/** Long-form studio calls need more than the router's 45 s default. */
export const STUDIO_TIMEOUT_MS = { short: 60_000, outline: 120_000, rewrite: 180_000, script: 240_000 } as const;

/** Why `res` mustn't be written, as a sentence ending in `outcome` — or null when it's real. */
export function placeholderProblem(res: LLMResponse, outcome: string): string | null {
  if (res.provider !== "mock" && res.content.trim()) return null;
  return `The AI didn't answer (no usable key for this workspace, or the call failed or timed out), so ${outcome}.`;
}

type TemplateLike = { name: string; structure: string | null } | null | undefined;

/**
 * A template as the prompt sees it (audit VID-13): its name AND its structure.
 * Only the name was sent, so a cloned template's sections, pacing and beats
 * never reached the writer. Cloned templates hold `{ ai: "<the model's JSON>" }`;
 * built-ins hold `{ sections: [...] }`; anything else goes in as it is, trimmed.
 */
export function templateBlock(t: TemplateLike, max = 2000): string {
  if (!t) return "Flexible";
  let structure = "";
  try {
    const s = JSON.parse(t.structure ?? "null");
    const inner = typeof s?.ai === "string" ? (() => { try { return JSON.parse(s.ai.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return s.ai; } })() : s;
    if (inner && typeof inner === "object" && Array.isArray(inner.sections)) {
      structure = inner.sections
        .map((sec: Record<string, unknown>, i: number) => {
          const title = String(sec.title ?? sec.name ?? `Section ${i + 1}`);
          const purpose = sec.purpose ? ` — ${String(sec.purpose)}` : "";
          const secs = Number(sec.typicalDurationSeconds ?? sec.seconds);
          const beats = Array.isArray(sec.beats) ? `: ${sec.beats.map(String).join("; ")}` : "";
          return `${i + 1}. ${title}${purpose}${Number.isFinite(secs) && secs > 0 ? ` (~${Math.round(secs)}s)` : ""}${beats}`;
        })
        .join("\n");
      if (inner.pacing) structure += `\nPacing: ${String(inner.pacing)}`;
      if (Array.isArray(inner.transitions) && inner.transitions.length) structure += `\nTransitions: ${inner.transitions.map(String).join(" · ")}`;
    } else if (typeof inner === "string") {
      structure = inner;
    } else if (inner) {
      structure = JSON.stringify(inner);
    }
  } catch {
    structure = t.structure ?? "";
  }
  structure = structure.trim().slice(0, max);
  return structure ? `${t.name}\n${structure}` : t.name;
}
