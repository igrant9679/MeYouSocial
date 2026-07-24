"use server";

import { revalidatePath } from "next/cache";
import { jobs } from "@/lib/jobs";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { registerOnboardingJobs } from "@/lib/jobs/onboarding";

registerOnboardingJobs();

/** On-demand regeneration of the idea pipeline. */
export async function regenerateIdeasAction(formData: FormData) {
  const channelId = String(formData.get("channelId"));
  const { workspace } = await requireRole("EDITOR");
  const channel = await db.channel.findFirst({ where: { id: channelId, workspaceId: workspace.id } });
  if (!channel) return;
  await jobs.enqueue("onboarding.ideas", { channelId: channel.id });
  revalidatePath(`/channels/${channelId}/ideas`);
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
  revalidatePath(`/channels/${idea.channelId}/ideas`);
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
  const { redirect } = await import("next/navigation");
  redirect(`/scripts/${script.id}`);
}

export async function updateIdeaStatusAction(formData: FormData) {
  const ideaId = String(formData.get("ideaId"));
  const status = String(formData.get("status"));
  if (!["new", "in_progress", "scripted", "archived"].includes(status)) return;
  const { workspace } = await requireRole("EDITOR");
  await db.idea.updateMany({
    where: { id: ideaId, channel: { workspaceId: workspace.id } },
    data: { status },
  });
  revalidatePath("/ideas");
}
