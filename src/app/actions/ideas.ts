"use server";

import { revalidatePath } from "next/cache";
import { jobs } from "@/lib/jobs";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { registerOnboardingJobs } from "@/lib/jobs/onboarding";

registerOnboardingJobs();

/** FR-IDEA-09 — On-demand regeneration of the idea pipeline. */
export async function regenerateIdeasAction(formData: FormData) {
  const channelId = String(formData.get("channelId"));
  const { workspace } = await requireRole("EDITOR");
  const channel = await db.channel.findFirst({ where: { id: channelId, workspaceId: workspace.id } });
  if (!channel) return;
  await jobs.enqueue("onboarding.ideas", { channelId: channel.id });
  revalidatePath(`/channels/${channelId}/ideas`);
}

/** FR-IDEA-07 — Write action: create a Script with the idea's context pre-loaded; open Canvas. */
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
