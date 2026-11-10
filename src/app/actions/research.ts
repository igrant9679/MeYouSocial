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
  // Reach (2026-11-09): read the top results in full instead of their snippets,
  // and add what people are saying on Reddit.
  const readSources = String(formData.get("readSources") ?? "") === "1";
  const includeDiscussions = String(formData.get("includeDiscussions") ?? "") === "1";
  // Public social posts (growth part db, 2026-11-10): Threads, Quora, Hacker
  // News, Bluesky, LinkedIn, Medium, YouTube, Pinterest — found without a login.
  const includeSocial = String(formData.get("includeSocial") ?? "") === "1";
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

  // 3) Reach: the top results read in full, and Reddit threads — each numbered
  // after the web results so the report can cite them as [n]. A channel that
  // fails is named at the foot of the report, never silently dropped.
  const { webRead, searchReddit, readReddit, searchSocial, readLink, sourceLabel, reasonOf, quoteForPrompt, QUOTED_MATERIAL_RULE } = await import("@/lib/reach");
  const notReached: string[] = [];
  const fullReads = readSources ? ({ basic: 1, intermediate: 2, comprehensive: 4, exhaustive: 6 } as const)[depth] ?? 2 : 0;
  const fullText = new Map<string, string>();
  await Promise.all(webResults.filter((r) => /^https?:\/\//i.test(r.url)).slice(0, fullReads).map(async (r) => {
    const read = await webRead(workspace.id, r.url, { maxChars: 4000 }).catch((e) => { notReached.push(`${r.url} — ${reasonOf(e)}`); return null; });
    if (read) fullText.set(r.url, read.item.text);
  }));
  type Thread = { title: string; url: string; text: string };
  const threads: Thread[] = [];
  if (includeDiscussions) {
    const found = await searchReddit(workspace.id, question, depth === "basic" ? 3 : 5).catch((e) => { notReached.push(`Reddit — ${reasonOf(e)}`); return null; });
    const readThreads = depth === "comprehensive" || depth === "exhaustive" ? 3 : 1;
    for (const [i, t] of (found?.items ?? []).entries()) {
      let text = t.text;
      if (i < readThreads && t.url) {
        const full = await readReddit(workspace.id, t.url, 3500).catch((e) => { notReached.push(`${t.url} — ${reasonOf(e)}`); return null; });
        if (full) text = full.item.text;
      }
      if (t.url) threads.push({ title: t.title ?? t.url, url: t.url, text });
    }
  }
  // Social posts: the search excerpt for each, the first one or two read in full
  // (a YouTube result by its captions). A post that can't be read keeps its excerpt.
  type Post = Thread & { platform: string };
  const posts: Post[] = [];
  if (includeSocial) {
    const found = await searchSocial(workspace.id, question, depth === "basic" ? 3 : depth === "intermediate" ? 5 : 6).catch((e) => { notReached.push(`Social posts — ${reasonOf(e)}`); return null; });
    const readPosts = depth === "comprehensive" || depth === "exhaustive" ? 2 : 1;
    for (const [i, p] of (found?.items ?? []).entries()) {
      if (!p.url) continue;
      let text = p.text;
      if (i < readPosts) {
        const full = await readLink(workspace.id, p.url, 3500).catch((e) => { notReached.push(`${p.url} — ${reasonOf(e)}`); return null; });
        if (full) text = full.item.text;
      }
      posts.push({ title: p.title ?? p.url, url: p.url, text, platform: sourceLabel("social", p.url) });
    }
  }

  // 4) LLM synthesis pass.
  const webBlock = webResults.map((r, i) => {
    const body = fullText.get(r.url);
    return body ? `[${i + 1}] ${r.title}\n${r.url}\n${quoteForPrompt(`page ${i + 1}`, body, 4000)}` : `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`;
  });
  const threadBlock = threads.map((t, i) => `[${webResults.length + i + 1}] (Reddit) ${t.title}\n${t.url}\n${quoteForPrompt(`thread ${webResults.length + i + 1}`, t.text, 3500)}`);
  const postStart = webResults.length + threads.length;
  const postBlock = posts.map((p, i) => `[${postStart + i + 1}] (${p.platform}) ${p.title}\n${p.url}\n${quoteForPrompt(`post ${postStart + i + 1}`, p.text, 3500)}`);
  const sourceBlock = [...webBlock, ...threadBlock, ...postBlock].join("\n\n");
  const heardFrom = [threads.length ? "the Reddit threads" : "", posts.length ? "the social posts" : ""].filter(Boolean).join(" and ");
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
${heardFrom ? `Add a section **What people are saying** between 4 and 5: the questions, complaints and disagreements in ${heardFrom}, each with its [n].\n` : ""}Stay within ~${Math.round(budget / 6)} words.
${QUOTED_MATERIAL_RULE}`,
    messages: [{
      role: "user",
      content: [
        `Question: ${question}`,
        `Niche: ${channel.nicheDescription ?? "—"}`,
        `Differentiation: ${channel.differentiation ?? "—"}`,
        competitorContext ? `Recent competitor titles:\n${competitorContext}` : "",
        `Sources:\n${sourceBlock}`,
      ].filter(Boolean).join("\n\n"),
    }],
    workspaceId: workspace.id,
  });

  const problem = placeholderProblem(completion, "no report was saved");
  // What couldn't be reached is part of the report: a reader must know a source was missing.
  const foot = notReached.length ? `\n\n---\n_Not reached while researching: ${notReached.slice(0, 8).join("; ")}._` : "";
  if (problem) (await import("next/navigation")).redirect(`/channels/${channelId}/research?flashErr=${encodeURIComponent(problem)}`);
  const research = await db.researchSource.create({
    data: {
      channelId,
      kind: "ai_research",
      ref: "deep-research:" + Date.now(),
      title: question.slice(0, 200),
      content: completion.content + foot,
      // Who wrote it and what it was given (E-IDE-15) — only links a page can open.
      writtenBy: passStamp(completion),
      webSources: JSON.stringify([
        ...webResults.filter((r) => /^https?:\/\//i.test(r.url)).map((r) => ({ title: r.title.slice(0, 200), url: r.url.slice(0, 1000), ...(fullText.has(r.url) ? { read: true } : {}) })),
        ...threads.map((t) => ({ title: t.title.slice(0, 200), url: t.url.slice(0, 1000), source: "reddit" })),
        ...posts.map((p) => ({ title: p.title.slice(0, 200), url: p.url.slice(0, 1000), source: "social", platform: p.platform })),
      ]),
      wordCount: (completion.content.match(/[\p{L}\p{N}]+/gu) ?? []).length,
      starred: false,
    },
  });
  revalidatePath(`/channels/${channelId}/research`);
  const { redirect } = await import("next/navigation");
  redirect(`/channels/${channelId}/research?focus=${research.id}`);
}

/**
 * Add a link to the research library (Reach, 2026-11-09): a web page as clean
 * text, a YouTube video's captions, a Reddit thread with its comments, a GitHub
 * repository's README or an issue with its comments, a public social post
 * (Threads, LinkedIn, Hacker News, Bluesky …, 2026-11-10). Stored as read; a link
 * that can't be read is refused with the reason, never saved empty.
 */
export async function addResearchLinkAction(formData: FormData) {
  const channelId = String(formData.get("channelId") ?? "");
  const url = String(formData.get("url") ?? "").trim().slice(0, 2000);
  const { workspace } = await requireRole("EDITOR");
  const channel = await db.channel.findFirst({ where: { id: channelId, workspaceId: workspace.id }, select: { id: true } });
  const { redirect } = await import("next/navigation");
  const back = (q: string): never => redirect(`/channels/${channelId}/research?${q}`);
  if (!channel) back(`flashErr=${encodeURIComponent("That channel isn't in this workspace.")}`);
  if (!/^https?:\/\//i.test(url)) back(`flashErr=${encodeURIComponent("Paste a full link, starting with https://.")}`);
  const { readLink, reasonOf, linkKind, sourceLabel } = await import("@/lib/reach");
  const read = await readLink(workspace.id, url, 60_000).catch((e: unknown) => back(`flashErr=${encodeURIComponent(`That link couldn't be read: ${reasonOf(e)}`)}`));
  const { item, via } = read;
  const kind = linkKind(url);
  const created = await db.researchSource.create({
    data: {
      channelId,
      kind,
      ref: url,
      title: (item.title ?? url).slice(0, 200),
      content: item.text,
      readNote: `${sourceLabel(kind, url)}${kind === "social" ? " post" : ""}${item.source === "youtube" ? ` captions${item.meta?.auto ? " (auto-generated)" : ""}` : ""}, read via ${via}${item.author ? ` · by ${item.author}` : ""}${item.publishedAt ? ` · ${String(item.publishedAt).slice(0, 10)}` : ""}`.slice(0, 300),
      wordCount: (item.text.match(/[\p{L}\p{N}]+/gu) ?? []).length,
      starred: false,
    },
  });
  revalidatePath(`/channels/${channelId}/research`);
  back(`focus=${created.id}&flash=${encodeURIComponent(`Added “${(item.title ?? url).slice(0, 80)}” — ${sourceLabel(kind, url)}${kind === "social" ? " post" : ""}, read via ${via}.`)}`);
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
