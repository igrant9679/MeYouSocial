import { createDeepSeekProvider } from "./deepseek";
import { getApiKey } from "./keys";
import { isLightOnlyModel } from "./models";
import { meterAi } from "@/lib/usage-meter";

/**
 * One real, tiny call to a light-only model (DeepSeek) on THIS workspace's own
 * key — made when an admin picks it as the Light model, before the pick is
 * saved (app/actions/model-tiers.ts).
 *
 * The house rule is that no model id is offered until it has answered a real
 * call on the key it will run on: a provider's model list and its docs have
 * both advertised names that then 404 (lib/llm/google.ts), and the router turns
 * a failed call into a placeholder that reads like the feature working. Nobody
 * here had a DeepSeek key when the adapter was written, so the proof is made
 * here, per workspace, at the moment of choosing.
 *
 * Called directly, not through the router: the router would answer a failure
 * with the placeholder, and the pick isn't saved yet for it to route to.
 */
export async function probeModel(model: string, workspaceId: string): Promise<{ ok: true } | { ok: false; why: string }> {
  if (!isLightOnlyModel(model)) return { ok: false, why: "there is no test call for this model" };
  const key = await getApiKey("deepseek", workspaceId).catch(() => "");
  if (!key) return { ok: false, why: "there's no DeepSeek key here — add one under Settings → Keys first" };
  try {
    const out = await createDeepSeekProvider(key).complete({
      model,
      messages: [{ role: "user", content: "Reply with the one word: ready" }],
      maxTokens: 16,
      timeoutMs: 20_000,
      workspaceId,
    });
    await meterAi({ workspaceId, action: "ai.text", provider: "deepseek", model, inputTokens: out.inputTokens, outputTokens: out.outputTokens, purpose: "model.check" });
    return { ok: true };
  } catch (e) {
    const why = (e instanceof Error ? e.message : String(e)).replace(/sk-[\w-]{8,}/g, "[key]").replace(/\s+/g, " ").slice(0, 200);
    return { ok: false, why: why || "no answer" };
  }
}
