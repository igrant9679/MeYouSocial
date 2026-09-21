import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { writeAudit, isGloballyPaused } from "@/lib/governance";
import { llm, resolveUsableModel } from "@/lib/llm";
import { motifPromptFor, brandContextBlock } from "@/lib/motifs";
import { stripListMarker } from "@/lib/list-marker";

/**
 * Social ideation — the idea stage a social post never had.
 *
 * Proposes social IDEAS for one Topic: a hook in one line and why it works.
 * They land on the Ideas board as `discovered`, take the per-format gate
 * (`ideas:social_gate`, lib/social/gate.ts) and are drafted into the queue by
 * social/drafting.ts — the same three steps an article takes. This replaces
 * the Topic-rotation generator that wrote posts straight into the queue with
 * no step a person could steer.
 *
 * Grounding is what autogen's prompt used: the company, the Topic and its
 * phrases, recently published article titles, the motif tone and the brand
 * guardrails. The same truthfulness rules apply — the MOCK provider's output
 * is never stored, and the prompt forbids invented specifics.
 */

const MAX_HOOK = 240;

export async function discoverSocialIdeasCore(workspaceId: string, topicId: string, count = 4): Promise<number> {
  if (await isGloballyPaused(workspaceId)) return 0;
  const want = Math.max(1, Math.min(8, Math.round(count)));
  const topic = await db.topic.findFirst({ where: { id: topicId, workspaceId, status: "active" } });
  if (!topic) return 0;

  const [workspace, org, recentPosts, recentIdeas, motifs, guardrails] = await Promise.all([
    db.workspace.findUnique({ where: { id: workspaceId }, select: { name: true, defaultModel: true } }),
    db.orgProfile.findUnique({ where: { workspaceId }, select: { description: true, industry: true, audience: true } }),
    db.blogPost.findMany({ where: { workspaceId, status: "published" }, orderBy: { updatedAt: "desc" }, take: 5, select: { title: true } }),
    db.socialIdea.findMany({ where: { workspaceId, topicId }, orderBy: { createdAt: "desc" }, take: 20, select: { hook: true } }),
    motifPromptFor(workspaceId, {}, "short").catch(() => null),
    brandContextBlock(workspaceId).catch(() => null),
  ]);
  if (!workspace) return 0;

  const phrases = readJson<string[]>(topic.keywords, []);
  const facts = [
    `Company: ${workspace.name}`,
    org?.industry ? `Industry: ${org.industry}` : "",
    org?.description ? `What it does: ${org.description}` : "",
    org?.audience ? `Audience: ${org.audience}` : "",
    `Topic: ${topic.name}${topic.description ? ` — ${topic.description}` : ""}${phrases.length ? ` (related phrases: ${phrases.slice(0, 8).join(", ")})` : ""}`,
    recentPosts.length ? `Recently published articles: ${recentPosts.map((p) => p.title).join(" · ")}` : "",
    recentIdeas.length ? `Avoid repeating these existing post ideas: ${recentIdeas.map((i) => i.hook).join(" | ")}` : "",
  ].filter(Boolean);

  const res = await llm.complete({
    model: await resolveUsableModel(workspace.defaultModel ?? llm.defaultModel, workspaceId),
    system:
      "You propose social media post IDEAS for a real company's feed — not finished posts. " +
      'Respond ONLY with a JSON array: [{"hook": string, "angle": string}] — no prose, no markdown fences. ' +
      `hook = the post's core in one line, at most ${MAX_HOOK} characters, specific to this company and topic. ` +
      "angle = one sentence on why it would land with the audience. " +
      "⚠ Never invent facts, numbers, statistics, customer names or claims — if a specific isn't in the context, don't use one. " +
      "Each idea must be a different angle on the topic, in the company's voice.",
    messages: [{
      role: "user",
      content: [
        `Context:\n${facts.join("\n")}`,
        motifs ? `Tone:\n${motifs}` : "",
        guardrails ?? "",
        `Propose ${want} post ideas.`,
      ].filter(Boolean).join("\n\n"),
    }],
    maxTokens: 4000,
    timeoutMs: 90_000,
    workspaceId,
    temperature: 0.8,
  });
  // ⚠ Unattended: the mock is fluent. Refuse, audit, store nothing.
  if (res.provider === "mock" || !res.content?.trim()) {
    await writeAudit({ workspaceId, action: "social.ideation_failed", entityType: "workspace", meta: { provider: res.provider, topic: topic.name, reason: "provider unavailable — refused to store mock ideas" } });
    return 0;
  }

  type Raw = { hook?: unknown; angle?: unknown };
  let raw: Raw[] = [];
  try {
    const match = res.content.match(/\[[\s\S]*\]/);
    raw = match ? JSON.parse(match[0]) : [];
  } catch {
    raw = [];
  }
  const text = (v: unknown, max: number) => {
    if (typeof v !== "string" || !v.trim()) return null;
    const cleaned = stripListMarker(v).replace(/^["“]|["”]$/g, "").slice(0, max).trim();
    return cleaned || null;
  };
  const rows = raw
    .map((r) => ({ hook: text(r.hook, MAX_HOOK), angle: text(r.angle, 300) }))
    .filter((r): r is { hook: string; angle: string | null } => Boolean(r.hook && r.hook.length > 8))
    .slice(0, want)
    .map((r) => ({
      workspaceId,
      topicId: topic.id,
      hook: r.hook,
      angle: r.angle,
      status: "discovered",
      source: "discovered",
    }));
  if (rows.length) await db.socialIdea.createMany({ data: rows });
  await writeAudit({
    workspaceId,
    action: "social.ideation",
    entityType: "social_idea",
    meta: { topic: topic.name, created: rows.length, provider: res.provider },
  });
  return rows.length;
}
