"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/acl";
import { youtube } from "@/lib/youtube";
import { CHANNEL_COOKIE } from "@/lib/channel";
import { jobs } from "@/lib/jobs";
import { registerOnboardingJobs } from "@/lib/jobs/onboarding";
import { writeJson } from "@/lib/db/json";

registerOnboardingJobs();

const PALETTE = ["#E5482F", "#6D28D9", "#2563EB", "#0D9488", "#D97706", "#DB2777", "#4F46E5", "#15924B", "#0891B2", "#7C3AED", "#E11D48"];

const stepOneSchema = z.object({
  niche: z.string().min(10).max(2000),
  style: z.enum(["personality", "faceless"]),
  path: z.enum(["youtube", "custom"]),
});

/** Creates the channel skeleton on step 1 of the wizard so subsequent steps can update it. */
export async function startOnboardingAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const parsed = stepOneSchema.safeParse({
    niche: formData.get("niche"),
    style: formData.get("style"),
    path: formData.get("path"),
  });
  if (!parsed.success) redirect("/onboarding/channel/new?step=1&error=invalid");

  const count = await db.channel.count({ where: { workspaceId: workspace.id } });
  const channel = await db.channel.create({
    data: {
      workspaceId: workspace.id,
      name: "Untitled channel",
      nicheDescription: parsed.data.niche,
      presentationStyle: parsed.data.style,
      accentColor: PALETTE[count % PALETTE.length],
    },
  });
  redirect(`/onboarding/channel/${channel.id}?step=2&path=${parsed.data.path}`);
}

const youtubeStepSchema = z.object({
  channelId: z.string(),
  handle: z.string().min(2).max(120),
});

/** Step 2 — YouTube path: look up by handle/URL, save the linked-channel summary. */
export async function lookupYoutubeAction(formData: FormData) {
  const parsed = youtubeStepSchema.safeParse({
    channelId: formData.get("channelId"),
    handle: formData.get("handle"),
  });
  if (!parsed.success) redirect(`/onboarding/channel/${formData.get("channelId")}?step=2&path=youtube&error=invalid`);

  const { channel } = await requireOwn(parsed.data.channelId);
  const summary = await youtube.findChannel(parsed.data.handle);
  if (!summary) redirect(`/onboarding/channel/${channel.id}?step=2&path=youtube&error=notfound`);

  await db.channel.update({
    where: { id: channel.id },
    data: {
      name: summary.name,
      linkedYoutubeId: summary.id,
      linkedYoutubeHandle: summary.handle ?? null,
      defaultLanguage: summary.language ?? "en",
    },
  });
  redirect(`/onboarding/channel/${channel.id}?step=3&path=youtube`);
}

const customStepSchema = z.object({
  channelId: z.string(),
  name: z.string().min(2).max(120),
  description: z.string().min(20).max(2000),
});

/** Step 2 — Custom path: capture channel name + description. */
export async function customChannelAction(formData: FormData) {
  const parsed = customStepSchema.safeParse({
    channelId: formData.get("channelId"),
    name: formData.get("name"),
    description: formData.get("description"),
  });
  if (!parsed.success) redirect(`/onboarding/channel/${formData.get("channelId")}?step=2&path=custom&error=invalid`);

  const { channel } = await requireOwn(parsed.data.channelId);
  await db.channel.update({
    where: { id: channel.id },
    data: { name: parsed.data.name, nicheDescription: parsed.data.description },
  });
  redirect(`/onboarding/channel/${channel.id}?step=3&path=custom`);
}

const competitorsSchema = z.object({
  channelId: z.string(),
  handles: z.string(), // comma-separated handles
});

/** Step 3 — competitors. */
export async function saveCompetitorsAction(formData: FormData) {
  const parsed = competitorsSchema.safeParse({
    channelId: formData.get("channelId"),
    handles: formData.get("handles") ?? "",
  });
  if (!parsed.success) return;
  const { channel } = await requireOwn(parsed.data.channelId);

  const handles = parsed.data.handles
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);

  await db.competitor.deleteMany({ where: { channelId: channel.id } });
  for (const h of handles) {
    const found = await youtube.findChannel(h);
    if (!found) continue;
    await db.competitor.create({
      data: {
        channelId: channel.id,
        youtubeHandle: found.handle ?? h,
        youtubeId: found.id,
        metricsSnapshot: writeJson({ subs: found.subscribers, views: found.totalViews }),
      },
    });
  }
  const path = String(formData.get("path") ?? "youtube");
  redirect(`/onboarding/channel/${channel.id}?step=4&path=${path}`);
}

const diffSchema = z.object({
  channelId: z.string(),
  differentiation: z.string().min(20).max(1000),
});

/** Step 4 — differentiation. Triggers background jobs for voice/audience/ideas (FR-ONB-09). */
export async function differentiationAction(formData: FormData) {
  const parsed = diffSchema.safeParse({
    channelId: formData.get("channelId"),
    differentiation: formData.get("differentiation"),
  });
  if (!parsed.success) redirect(`/onboarding/channel/${formData.get("channelId")}?step=4&error=invalid`);

  const { channel } = await requireOwn(parsed.data.channelId);
  await db.channel.update({
    where: { id: channel.id },
    data: { differentiation: parsed.data.differentiation },
  });

  // Kick off the background generation jobs (FR-ONB-09). They run independently;
  // the wizard's final step polls their status, but users can also leave and come back.
  await jobs.enqueue("onboarding.voice", { channelId: channel.id });
  await jobs.enqueue("onboarding.audience", { channelId: channel.id });
  await jobs.enqueue("onboarding.ideas", { channelId: channel.id });

  // Make this the active channel as the user finishes onboarding.
  const jar = await cookies();
  jar.set(CHANNEL_COOKIE, channel.id, { httpOnly: true, sameSite: "lax", path: "/" });

  redirect(`/onboarding/channel/${channel.id}?step=5`);
}

export async function finishOnboardingAction(formData: FormData) {
  const channelId = String(formData.get("channelId"));
  const { channel } = await requireOwn(channelId);
  revalidatePath("/dashboard");
  redirect(`/channels/${channel.id}`);
}

async function requireOwn(channelId: string) {
  const { workspace } = await requireRole("EDITOR");
  const channel = await db.channel.findFirst({ where: { id: channelId, workspaceId: workspace.id } });
  if (!channel) redirect("/onboarding/channel/new");
  return { channel, workspace };
}
