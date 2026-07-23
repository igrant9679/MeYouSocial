"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { youtubeFor } from "@/lib/youtube";
import { jobs } from "@/lib/jobs";
import { registerOnboardingJobs } from "@/lib/jobs/onboarding";

registerOnboardingJobs();

// Relink / change the linked YouTube channel; re-trains voice + audience.
export async function relinkYoutubeAction(formData: FormData) {
  const channelId = String(formData.get("channelId"));
  const handle = String(formData.get("handle") ?? "").trim();
  if (!handle) return;
  const { workspace } = await requireRole("EDITOR");
  const channel = await db.channel.findFirst({ where: { id: channelId, workspaceId: workspace.id } });
  if (!channel) return;

  const found = await youtubeFor(workspace.id).findChannel(handle);
  if (!found) redirect(`/channels/${channelId}/settings?error=notfound`);

  await db.channel.update({
    where: { id: channelId },
    data: {
      linkedYoutubeId: found!.id,
      linkedYoutubeHandle: found!.handle ?? handle,
      defaultLanguage: found!.language ?? channel.defaultLanguage,
    },
  });
  // Kick off re-training jobs in the background.
  await jobs.enqueue("onboarding.voice", { channelId });
  await jobs.enqueue("onboarding.audience", { channelId });
  revalidatePath(`/channels/${channelId}/settings`);
  revalidatePath(`/channels/${channelId}/voice`);
  revalidatePath(`/channels/${channelId}/audience`);
}

// Mark channel as a business/brand channel.
export async function setBusinessChannelAction(formData: FormData) {
  const channelId = String(formData.get("channelId"));
  const business = String(formData.get("business") ?? "") === "1";
  const { workspace } = await requireRole("EDITOR");
  const channel = await db.channel.findFirst({ where: { id: channelId, workspaceId: workspace.id } });
  if (!channel) return;
  await db.channel.update({
    where: { id: channelId },
    data: { presentationStyle: business ? "business" : (channel.presentationStyle === "business" ? "personality" : channel.presentationStyle) },
  });
  revalidatePath(`/channels/${channelId}/settings`);
}
