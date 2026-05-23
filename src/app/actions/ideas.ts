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
