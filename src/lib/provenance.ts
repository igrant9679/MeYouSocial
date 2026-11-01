import type { LLMResponse } from "@/lib/llm";
import { modelLabel } from "@/lib/llm/models";

/**
 * Who wrote a generated block (E-VID-13), stamped when it is written:
 * "provider|model|ISO time". The provider is the one that ANSWERED (the router
 * stamps it, fallback included), so a block the mock wrote says so even where
 * a refusal check was missed. A block with no stamp predates this and claims
 * nothing — it is never guessed from the model a person picked.
 */
export function passStamp(res: Pick<LLMResponse, "provider" | "model">, at = new Date()): string {
  return [res.provider ?? "", res.model ?? "", at.toISOString()].join("|");
}

export type Provenance = { provider: string; model: string; at: Date; mock: boolean; label: string };

export function readStamp(raw: string | null | undefined): Provenance | null {
  if (!raw) return null;
  const [provider, model, iso] = raw.split("|");
  const at = new Date(iso ?? "");
  if (!provider || Number.isNaN(at.getTime())) return null;
  const mock = provider === "mock";
  return { provider, model: model ?? "", at, mock, label: mock ? "Mock — AI unavailable" : modelLabel(model || provider) };
}
