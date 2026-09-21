"use server";

import { revalidatePath } from "next/cache";
import { jobs } from "@/lib/jobs";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { registerOnboardingJobs } from "@/lib/jobs/onboarding";
import { addBlogIdeaAction } from "@/app/actions/blog-ideas";
import { addSocialIdeaAction } from "@/app/actions/social-ideas";
import { cleanTitle } from "@/lib/list-marker";
import { ownTopicId } from "@/lib/topics";
import { isIdeaFormat } from "@/lib/ideas-board";

registerOnboardingJobs();

// Video-idea actions. Since One-Loop step 4 the board is ONE page (/ideas) for
// article and video ideas alike, so every write revalidates it as well as the
// channel page that still lists a channel's own ideas.

function revalidateBoards(channelId?: string) {
  revalidatePath("/ideas");
  if (channelId) revalidatePath(`/channels/${channelId}`);
}

/**
 * One add form for all three formats. `format` is "article", "social" or
 * "video:<channelId>"; an article idea goes through the existing blog-idea
 * path (keyword, topic, scoring), a social idea through social-ideas.ts, a
 * video idea lands on its channel as `new`.
 */
export async function addIdeaAction(formData: FormData) {
  const raw = String(formData.get("format") ?? "article");
  if (raw === "social") return addSocialIdeaAction(formData);
  if (!raw.startsWith("video:")) return addBlogIdeaAction(formData);
  const channelId = raw.slice("video:".length);
  const title = cleanTitle(String(formData.get("title") ?? ""), 200);
  if (!title) return;
  const { workspace } = await requireRole("EDITOR");
  const channel = await db.channel.findFirst({ where: { id: channelId, workspaceId: workspace.id }, select: { id: true } });
  if (!channel) return;
  const rawTopic = String(formData.get("topicId") ?? "").trim();
  const topicId = rawTopic
    ? (await db.topic.findFirst({ where: { id: rawTopic, workspaceId: workspace.id }, select: { id: true } }))?.id ?? null
    : null;
  await db.idea.create({ data: { channelId: channel.id, title, topicId, status: "new" } });
  revalidateBoards(channel.id);
}

/** On-demand regeneration of the idea pipeline. */
export async function regenerateIdeasAction(formData: FormData) {
  const channelId = String(formData.get("channelId"));
  const { workspace } = await requireRole("EDITOR");
  const channel = await db.channel.findFirst({ where: { id: channelId, workspaceId: workspace.id } });
  if (!channel) return;
  await jobs.enqueue("onboarding.ideas", { channelId: channel.id }, { refId: channel.id, workspaceId: workspace.id });
  revalidateBoards(channelId);
}

/**
 * Assign (or clear) the workspace Topic on a channel idea. Both the idea and
 * the topic are validated through the caller's workspace — a channel idea can
 * only take a topic owned by the same company.
 */
export async function setIdeaTopicAction(formData: FormData) {
  const ideaId = String(formData.get("ideaId") ?? "");
  const raw = String(formData.get("topicId") ?? "").trim();
  const { workspace } = await requireRole("EDITOR");
  const idea = await db.idea.findFirst({
    where: { id: ideaId, channel: { workspaceId: workspace.id } },
    select: { id: true, channelId: true },
  });
  if (!idea) return;
  const topicId = raw
    ? (await db.topic.findFirst({ where: { id: raw, workspaceId: workspace.id }, select: { id: true } }))?.id ?? null
    : null;
  await db.idea.update({ where: { id: idea.id }, data: { topicId } });
  revalidateBoards(idea.channelId);
}

/**
 * The board's one "tag it" control, for any format: set (or clear) the Topic
 * on an article, video or social idea. This is how the "No topic yet" lane
 * empties — 92 legacy ideas on the two tenants had no Topic when lanes
 * arrived (2026-09-21). Tenant boundary on both the idea and the topic.
 */
export async function setBoardIdeaTopicAction(formData: FormData) {
  const format = String(formData.get("format") ?? "");
  const id = String(formData.get("id") ?? "");
  if (!isIdeaFormat(format) || !id) return;
  const { workspace } = await requireRole("EDITOR");
  const topicId = await ownTopicId(workspace.id, formData.get("topicId"));
  if (format === "article") {
    await db.blogIdea.updateMany({ where: { id, workspaceId: workspace.id }, data: { topicId } });
  } else if (format === "social") {
    await db.socialIdea.updateMany({ where: { id, workspaceId: workspace.id }, data: { topicId } });
  } else {
    const idea = await db.idea.findFirst({ where: { id, channel: { workspaceId: workspace.id } }, select: { id: true, channelId: true } });
    if (!idea) return;
    await db.idea.update({ where: { id: idea.id }, data: { topicId } });
    revalidatePath(`/channels/${idea.channelId}`);
  }
  revalidatePath("/ideas", "layout");
}

/**
 * Research → the board, in any format, with its Topic and its source
 * (components/ResearchIdeaForm.tsx). `format` is "article", "social" or
 * "video:<channelId>". The idea keeps `sourceVideoId` so it always points
 * back at the evidence; a video idea also carries the measured outlier.
 */
export async function ideaFromResearchAction(formData: FormData) {
  const { user, workspace } = await requireRole("EDITOR");
  const videoId = String(formData.get("videoId") ?? "").trim();
  const video = await db.intelVideo.findFirst({
    where: { id: videoId, intelChannel: { workspaceId: workspace.id } },
    select: { id: true, title: true, outlierScore: true, intelChannel: { select: { name: true } } },
  });
  if (!video) return;
  const topicId = await ownTopicId(workspace.id, formData.get("topicId"));
  const raw = String(formData.get("format") ?? "article");
  const title = cleanTitle(video.title, 200);
  if (!title) return;
  const angle = video.outlierScore != null
    ? `Beat ${video.intelChannel.name ?? "its channel"}'s average by ${video.outlierScore.toFixed(1)}× — remix the hook, not the subject.`
    : `From ${video.intelChannel.name ?? "a competitor"} — remix the hook, not the subject.`;

  let made = "article idea";
  if (raw.startsWith("video:")) {
    const channel = await db.channel.findFirst({ where: { id: raw.slice("video:".length), workspaceId: workspace.id }, select: { id: true } });
    if (!channel) return;
    await db.idea.create({ data: { channelId: channel.id, title, strategy: angle, sourceVideoId: video.id, outlierScore: video.outlierScore, topicId, status: "new" } });
    revalidatePath(`/channels/${channel.id}`);
    made = "video idea";
  } else if (raw === "social") {
    await db.socialIdea.create({ data: { workspaceId: workspace.id, hook: cleanTitle(video.title, 240), angle, sourceVideoId: video.id, topicId, source: "research", createdById: user.id } });
    made = "social idea";
  } else {
    await db.blogIdea.create({ data: { workspaceId: workspace.id, title, angle, sourceVideoId: video.id, topicId, source: "research" } });
  }
  revalidatePath("/ideas", "layout");
  revalidatePath("/inbox");
  const back = String(formData.get("back") ?? "/research");
  const to = /^\/(research|intel)(\/|$)/.test(back) ? back.split("?")[0] : "/research";
  const { redirect } = await import("next/navigation");
  redirect(`${to}?ok=${encodeURIComponent(`Added as ${made === "article idea" ? "an" : "a"} ${made}${topicId ? " with its Topic" : ""} — it is on the board as discovered.`)}`);
}

/**
 * The board's primary action: discover ideas per Topic. With a `topicId` the
 * run is that one Topic; without, the emptiest Topic × format cells go first
 * (lib/ideation.ts). `formats` is a comma list; default article.
 */
export async function discoverIdeasAction(formData?: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const topicId = await ownTopicId(workspace.id, formData?.get("topicId"));
  const formats = String(formData?.get("formats") ?? "article").split(",").map((s) => s.trim()).filter(isIdeaFormat);
  const { runIdeation } = await import("@/lib/ideation");
  await runIdeation(workspace.id, { formats: formats.length ? formats : ["article"], maxCells: topicId ? formats.length || 1 : 3, topicId });
  revalidatePath("/ideas", "layout");
  revalidatePath("/inbox");
}

/** Write action: create a Script with the idea's context pre-loaded; open Canvas. */
export async function writeIdeaToCanvasAction(formData: FormData) {
  const ideaId = String(formData.get("ideaId"));
  const { user, workspace } = await requireRole("EDITOR");
  const idea = await db.idea.findFirst({
    where: { id: ideaId, channel: { workspaceId: workspace.id } },
    include: { channel: true },
  });
  if (!idea) return;
  const script = await db.script.create({
    data: {
      channelId: idea.channelId,
      ideaId: idea.id,
      authorId: user.id,
      title: idea.title,
      workflow: "canvas",
      language: idea.channel.defaultLanguage,
      templateId: idea.channel.defaultTemplateId,
      model: idea.channel.defaultModel,
    },
  });
  // Linked Canvas chat ( — one-chat-one-script).
  await db.chat.create({
    data: {
      channelId: idea.channelId,
      userId: user.id,
      type: "canvas",
      scriptId: script.id,
      title: idea.title,
      messages: {
        create: {
          role: "assistant",
          content: `Pulled from idea: **${idea.title}**\n${idea.strategy ? `\nStrategy: ${idea.strategy}` : ""}\n\nWhen you're ready, head to the Plan tab, answer the planning questions, and generate an outline.`,
        },
      },
    },
  });
  await db.idea.update({ where: { id: idea.id }, data: { status: "in_progress" } });
  revalidateBoards(idea.channelId);
  const { redirect } = await import("next/navigation");
  redirect(`/scripts/${script.id}`);
}

/**
 * The board's own vocabulary on a video idea: new (discovered) · approved
 * (chosen, next to write — added in step 4) · in_progress / scripted (drafted)
 * · archived (rejected).
 */
export async function updateIdeaStatusAction(formData: FormData) {
  const ideaId = String(formData.get("ideaId"));
  const status = String(formData.get("status"));
  if (!["new", "approved", "in_progress", "scripted", "archived"].includes(status)) return;
  const { workspace } = await requireRole("EDITOR");
  const idea = await db.idea.findFirst({ where: { id: ideaId, channel: { workspaceId: workspace.id } }, select: { id: true, channelId: true } });
  if (!idea) return;
  await db.idea.update({ where: { id: idea.id }, data: { status } });
  revalidateBoards(idea.channelId);
}
