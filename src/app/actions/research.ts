"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { llm } from "@/lib/llm";
import { getSearchProvider } from "@/lib/search";
import { youtubeFor } from "@/lib/youtube";

// /..04 — Deep AI Research tool.
// Multi-source: web search + (optionally) competitor YT channels + LLM synthesis.
// Saves a referenceable report into the channel's research library.

const DEPTH_BUDGETS = {
  basic:         5_000,
  intermediate: 15_000,
  comprehensive: 45_000,
  exhaustive:   90_000,
} as const;

export async function deepResearchAction(formData: FormData) {
  const channelId = String(formData.get("channelId"));
  const question = String(formData.get("question") ?? "").trim();
  const depth = String(formData.get("depth") ?? "intermediate") as keyof typeof DEPTH_BUDGETS;
  const includeCompetitors = String(formData.get("includeCompetitors") ?? "") === "1";
  if (!question) return;

  const { workspace } = await requireRole("EDITOR");
  const channel = await db.channel.findFirst({
    where: { id: channelId, workspaceId: workspace.id },
    include: { competitors: true, audience: true },
  });
  if (!channel) return;

  const budget = DEPTH_BUDGETS[depth] ?? DEPTH_BUDGETS.intermediate;

  // 1) Quick search for primary sources.
  const { provider: webSearch } = await getSearchProvider(workspace.id);
  const webResults = await webSearch.search(question, depth === "exhaustive" ? 15 : depth === "comprehensive" ? 10 : depth === "intermediate" ? 6 : 4);

  // 2) Optionally pull recent competitor titles for niche context.
  let competitorContext = "";
  if (includeCompetitors && channel.competitors.length > 0) {
    const titles: string[] = [];
    for (const c of channel.competitors.slice(0, 3)) {
      if (!c.youtubeId) continue;
      const videos = await youtubeFor(workspace.id).listVideos(c.youtubeId, 4);
      titles.push(...videos.map((v) => `- (${c.youtubeHandle ?? c.youtubeId}) ${v.title}`));
    }
    competitorContext = titles.join("\n").slice(0, 4_000);
  }

  // 3) LLM synthesis pass.
  const sourceBlock = webResults.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join("\n\n");
  const completion = await llm.complete({
    model: channel.defaultModel ?? "claude-sonnet",
    system: `You produce deep YouTube research reports. Return a Markdown report with:
1. **TL;DR** (3 bullets)
2. **Key facts** (numbered, each with [n] source ref)
3. **Contested claims** (where sources disagree)
4. **Surprising data points**
5. **Suggested angles** (3-5 video ideas grounded in the research)
6. **Sources** (numbered list from input)
Stay within ~${Math.round(budget / 6)} words.`,
    messages: [{
      role: "user",
      content: [
        `Question: ${question}`,
        `Niche: ${channel.nicheDescription ?? "—"}`,
        `Differentiation: ${channel.differentiation ?? "—"}`,
        competitorContext ? `Recent competitor titles:\n${competitorContext}` : "",
        `Web sources:\n${sourceBlock}`,
      ].filter(Boolean).join("\n\n"),
    }],
    workspaceId: workspace.id,
  });

  const research = await db.researchSource.create({
    data: {
      channelId,
      kind: "ai_research",
      ref: "deep-research:" + Date.now(),
      title: question.slice(0, 200),
      content: completion.content,
      wordCount: (completion.content.match(/[\p{L}\p{N}]+/gu) ?? []).length,
      starred: false,
    },
  });
  revalidatePath(`/channels/${channelId}/research`);
  const { redirect } = await import("next/navigation");
  redirect(`/channels/${channelId}/research?focus=${research.id}`);
}

export async function starResearchAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  const r = await db.researchSource.findFirst({
    where: { id, channel: { workspaceId: workspace.id } },
  });
  if (!r) return;
  await db.researchSource.update({ where: { id }, data: { starred: !r.starred } });
  revalidatePath(`/channels/${r.channelId}/research`);
}

export async function deleteResearchAction(formData: FormData) {
  const id = String(formData.get("id"));
  const channelId = String(formData.get("channelId"));
  const { workspace } = await requireRole("EDITOR");
  await db.researchSource.deleteMany({
    where: { id, channel: { workspaceId: workspace.id } },
  });
  revalidatePath(`/channels/${channelId}/research`);
}
