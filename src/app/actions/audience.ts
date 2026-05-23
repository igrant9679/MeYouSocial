"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeJson } from "@/lib/db/json";
import { jobs } from "@/lib/jobs";
import { registerOnboardingJobs } from "@/lib/jobs/onboarding";
import { images } from "@/lib/images";

registerOnboardingJobs();

/** FR-AUD-04 — Edit any section of the avatar manually. */
export async function updateAudienceSectionAction(formData: FormData) {
  const channelId = String(formData.get("channelId"));
  const section = String(formData.get("section"));
  const value = String(formData.get("value") ?? "");
  if (!["demographics", "psychographics", "onlineBehavior", "offlineBehavior", "keyQuestions"].includes(section)) return;

  const { workspace } = await requireRole("EDITOR");
  const channel = await db.channel.findFirst({ where: { id: channelId, workspaceId: workspace.id } });
  if (!channel) return;

  const payload =
    section === "keyQuestions"
      ? writeJson(value.split(/\n+/).map((s) => s.trim()).filter(Boolean))
      : writeJson({ summary: value });

  await db.audienceAvatar.upsert({
    where: { channelId },
    update: { [section]: payload },
    create: {
      channelId,
      [section]: payload,
    },
  });
  revalidatePath(`/channels/${channelId}/audience`);
}

/** FR-AUD-04 — Fully refresh from latest YouTube data (overwrite, with confirmation). */
export async function refreshAudienceAction(formData: FormData) {
  const channelId = String(formData.get("channelId"));
  const { workspace } = await requireRole("EDITOR");
  const channel = await db.channel.findFirst({ where: { id: channelId, workspaceId: workspace.id } });
  if (!channel) return;
  await jobs.enqueue("onboarding.audience", { channelId });
  revalidatePath(`/channels/${channelId}/audience`);
}

/** FR-AUD-03 — Generate a representative audience photo. */
export async function generateAudiencePhotoAction(formData: FormData) {
  const channelId = String(formData.get("channelId"));
  const { workspace } = await requireRole("EDITOR");
  const channel = await db.channel.findFirst({
    where: { id: channelId, workspaceId: workspace.id },
    include: { audience: true },
  });
  if (!channel || !channel.audience) return;

  const result = await images.generate({
    prompt: `Editorial portrait of the ideal viewer of a ${channel.nicheDescription} channel — natural lighting, warm tones.`,
    aspectRatio: "1:1",
  });
  await db.audienceAvatar.update({
    where: { channelId },
    data: { photoUrl: result.url },
  });
  revalidatePath(`/channels/${channelId}/audience`);
}
