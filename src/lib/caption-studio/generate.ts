import { db } from "@/lib/db";
import { llm, resolveUsableModel } from "@/lib/llm";
import { brandContextBlock, motifPromptFor } from "@/lib/motifs";
import { isGloballyPaused, writeAudit } from "@/lib/governance";
import { buildPrompt, expectedItems, type ScenarioInput } from "@/lib/caption-studio/prompts";
import { checkBatch, parseReply, type CaptionItem, type Flag } from "@/lib/caption-studio/checks";

/**
 * Run one Caption Studio scenario for a workspace. The client is the
 * workspace itself — its name, profile, brand guardrails and tone — so the
 * doc's "make every caption clearly relevant to the specific client" has
 * something real to stand on.
 *
 * ⚠ The mock is fluent. Its output is never returned as captions: a person
 * would review it, find it plausible, and schedule it to a real feed. No real
 * provider → a plain refusal.
 */
export type GenerateResult =
  | { ok: true; items: CaptionItem[]; flags: Flag[][]; provider: string; model: string }
  | { ok: false; error: string };

export async function generateCaptions(workspaceId: string, input: ScenarioInput, actorId: string | null): Promise<GenerateResult> {
  if (await isGloballyPaused(workspaceId)) return { ok: false, error: "AI is paused for this workspace (Settings → Automation), so nothing was generated." };
  const expected = expectedItems(input);
  if (expected.length === 0) return { ok: false, error: "Nothing to write — pick at least one item." };
  if (expected.length > 20) return { ok: false, error: "At most 20 captions in one go — split it into two batches." };

  const [workspace, org, guardrails, tone] = await Promise.all([
    db.workspace.findUnique({ where: { id: workspaceId }, select: { name: true, defaultModel: true } }),
    db.orgProfile.findUnique({ where: { workspaceId }, select: { description: true, industry: true, audience: true } }),
    brandContextBlock(workspaceId).catch(() => null),
    motifPromptFor(workspaceId, {}, "short").catch(() => null),
  ]);
  if (!workspace) return { ok: false, error: "Workspace not found." };

  const { system, user } = buildPrompt(input, {
    name: workspace.name,
    description: org?.description,
    industry: org?.industry,
    audience: org?.audience,
    guardrails,
    tone,
  });
  const model = await resolveUsableModel(workspace.defaultModel ?? llm.defaultModel, workspaceId);
  const res = await llm.complete({
    model,
    system,
    messages: [{ role: "user", content: user }],
    // ⚠ Reasoning models spend a small budget thinking and return EMPTY text
    // (the CLAUDE.md trap) — 8000 leaves room for 20 captions after thought.
    maxTokens: 8000,
    timeoutMs: 150_000,
    temperature: 0.8,
    workspaceId,
  });
  if (res.provider === "mock" || !res.content?.trim()) {
    await writeAudit({ workspaceId, actorId, action: "captions.failed", entityType: "workspace", meta: { scenario: input.scenario, provider: res.provider, reason: "no real AI provider replied" } });
    return { ok: false, error: "No working AI provider replied, so nothing was written. Check the AI key under Settings → Keys." };
  }
  const items = parseReply(res.content, expected);
  if (items.length !== expected.length || items.some((it) => !it.body)) {
    await writeAudit({ workspaceId, actorId, action: "captions.failed", entityType: "workspace", meta: { scenario: input.scenario, provider: res.provider, got: items.length, wanted: expected.length } });
    return { ok: false, error: `The model returned ${items.filter((i) => i.body).length} usable caption${items.length === 1 ? "" : "s"} of the ${expected.length} asked for. Try again.` };
  }
  const previous = input.scenario === "campaign" || input.scenario === "images" ? input.previous : [];
  await writeAudit({ workspaceId, actorId, action: "captions.generated", entityType: "workspace", meta: { scenario: input.scenario, count: items.length, provider: res.provider } });
  return { ok: true, items, flags: checkBatch(items, previous), provider: String(res.provider ?? "unknown"), model: String(model ?? "") };
}
