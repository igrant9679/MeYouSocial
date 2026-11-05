"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { llm } from "@/lib/llm";
import { getSearchProvider } from "@/lib/search";
import { youtubeFor } from "@/lib/youtube";
import { placeholderProblem } from "@/lib/studio-ai";
import { passStamp } from "@/lib/provenance";
import { anglesFromReport } from "@/lib/report-angles";
import { storage } from "@/lib/storage";

/** Research that's a stored file, not a page or a report. */
const FILE_KINDS = ["pdf", "word", "text", "image"];

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
    purpose: "research",
    model: channel.defaultModel ?? "",
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

  const problem = placeholderProblem(completion, "no report was saved");
  if (problem) (await import("next/navigation")).redirect(`/channels/${channelId}/research?flashErr=${encodeURIComponent(problem)}`);
  const research = await db.researchSource.create({
    data: {
      channelId,
      kind: "ai_research",
      ref: "deep-research:" + Date.now(),
      title: question.slice(0, 200),
      content: completion.content,
      // Who wrote it and what it was given (E-IDE-15) — only links a page can open.
      writtenBy: passStamp(completion),
      webSources: JSON.stringify(webResults.filter((r) => /^https?:\/\//i.test(r.url)).map((r) => ({ title: r.title.slice(0, 200), url: r.url.slice(0, 1000) }))),
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
  const source = await db.researchSource.findFirst({ where: { id, channel: { workspaceId: workspace.id } }, select: { kind: true, ref: true } });
  await db.researchSource.deleteMany({
    where: { id, channel: { workspaceId: workspace.id } },
  });
  // An attached file goes with it: it can be 2,500 MB of someone's Drive (E-ENG-13).
  if (source && FILE_KINDS.includes(source.kind)) {
    await storage.remove(source.ref).catch(() => false);
    await db.storedObject.deleteMany({ where: { key: source.ref, workspaceId: workspace.id } });
  }
  revalidatePath(`/channels/${channelId}/research`);
}

/** Read an attached file over again: after a key is added, a password removed, or a reading that failed (E-ENG-13). */
export async function rereadResearchAction(formData: FormData) {
  const id = String(formData.get("id"));
  const channelId = String(formData.get("channelId"));
  const { workspace, user } = await requireRole("EDITOR");
  const { count } = await db.researchSource.updateMany({
    where: { id, kind: { in: FILE_KINDS }, readState: { notIn: ["reading", "unread"] }, channel: { workspaceId: workspace.id } },
    data: { readState: "reading", readNote: null },
  });
  if (count) {
    const { jobs } = await import("@/lib/jobs");
    const { registerResearchReadJobs } = await import("@/lib/jobs/research-read");
    registerResearchReadJobs();
    await jobs.enqueue("research.read", { sourceId: id, actorId: user.id }, { refId: id, workspaceId: workspace.id });
  }
  revalidatePath(`/channels/${channelId}/research`);
}

/**
 * "Make ideas from this report" (E-IDE-15): the report's own Suggested angles
 * become `new` ideas on its channel — read from the report, so nothing is spent
 * and nothing is made up. A title the channel already has is skipped.
 */
export async function ideasFromReportAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  const { redirect } = await import("next/navigation");
  const report = await db.researchSource.findFirst({
    where: { id, kind: "ai_research", channel: { workspaceId: workspace.id } },
    select: { id: true, channelId: true, content: true },
  });
  if (!report) return;
  const back = (msg: string, err = false) => redirect(`/channels/${report.channelId}/research?focus=${report.id}&${err ? "flashErr" : "flash"}=${encodeURIComponent(msg)}`);
  const angles = anglesFromReport(report.content);
  if (!angles.length) back("This report has no Suggested angles list, so no ideas were made.", true);
  const existing = new Set((await db.idea.findMany({ where: { channelId: report.channelId }, select: { title: true } })).map((i) => i.title.trim().toLowerCase()));
  const fresh = angles.filter((a) => !existing.has(a.title.toLowerCase()));
  if (fresh.length) {
    await db.idea.createMany({ data: fresh.map((a) => ({ channelId: report.channelId, title: a.title, strategy: a.angle || null, status: "new" })) });
  }
  revalidatePath("/ideas");
  revalidatePath(`/channels/${report.channelId}`);
  const skipped = angles.length - fresh.length;
  back(fresh.length
    ? `${fresh.length} idea${fresh.length === 1 ? "" : "s"} added to the Ideas board${skipped ? ` (${skipped} already there)` : ""}.`
    : `All ${angles.length} of this report's angles are already ideas on this channel.`);
}
