"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { llm } from "@/lib/llm";
import { youtubeFor } from "@/lib/youtube";
import { writeJson, readJson } from "@/lib/db/json";

// ── — Sync published-video stats into Content Projects ───────────

/** Generates a ChannelStat row for a project. In mock mode this fabricates plausible numbers;
 *  with USE_MOCK_YOUTUBE=false the real YouTube provider will be used. */
export async function syncStatsAction(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const { workspace } = await requireRole("EDITOR");
  const project = await db.contentProject.findFirst({
    where: { id: projectId, channel: { workspaceId: workspace.id } },
    include: { channel: true, script: true },
  });
  if (!project) return;

  // For demo: hash project id to a stable but varied numbers; with real YT, swap in a fetch.
  const seed = [...project.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0);
  const abs = Math.abs(seed);
  const views = 1000 + (abs % 250_000);
  const retention = 0.35 + ((abs % 40) / 100); // 35-75%
  const engagement = 0.01 + ((abs % 8) / 100); // 1-9%

  // In a real wiring we'd resolve project -> youtube video id and call youtube.fetchStats(...)
  if (!process.env.USE_MOCK_YOUTUBE || process.env.USE_MOCK_YOUTUBE === "true") {
    // mock path
  } else if (project.channel.linkedYoutubeId) {
    await youtubeFor(workspace.id).listVideos(project.channel.linkedYoutubeId, 1); // placeholder hook
  }

  await db.channelStat.create({
    data: {
      channelId: project.channelId,
      videoYoutubeId: project.script?.id ?? null,
      views: BigInt(views),
      retentionProxy: retention,
      engagement,
    },
  });
  revalidatePath(`/production/projects/${projectId}`);
}

// ── — Idea / ContentProject merit tags ──────────────────────────

const MERITS = ["pillar", "trending", "experiment"] as const;

export async function setIdeaMeritAction(formData: FormData) {
  const ideaId = String(formData.get("ideaId"));
  const merit = String(formData.get("merit") ?? "");
  const value = MERITS.includes(merit as typeof MERITS[number]) ? merit : null;
  const { workspace } = await requireRole("EDITOR");
  await db.idea.updateMany({
    where: { id: ideaId, channel: { workspaceId: workspace.id } },
    data: { merit: value },
  });
  revalidatePath("/ideas");
}

export async function setProjectMeritAction(formData: FormData) {
  const id = String(formData.get("id"));
  const merit = String(formData.get("merit") ?? "");
  const value = MERITS.includes(merit as typeof MERITS[number]) ? merit : null;
  const { workspace } = await requireRole("EDITOR");
  await db.contentProject.updateMany({
    where: { id, channel: { workspaceId: workspace.id } },
    data: { ideaMerit: value },
  });
  revalidatePath(`/production/projects/${id}`);
}

// ── — keywords ─────────────────────────────────────────────────────

export async function setProjectKeywordsAction(formData: FormData) {
  const id = String(formData.get("id"));
  const raw = String(formData.get("keywords") ?? "");
  const list = raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 100);
  const { workspace } = await requireRole("EDITOR");
  await db.contentProject.updateMany({
    where: { id, channel: { workspaceId: workspace.id } },
    data: { keywords: writeJson(list) },
  });
  revalidatePath(`/production/projects/${id}`);
}

// ── — chapter markers ────────────────────────────────────────────

/** Generate YouTube-style chapter markers from the script outline + body. */
export async function generateChapterMarkersAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId"));
  const { workspace } = await requireRole("EDITOR");
  const script = await db.script.findFirst({
    where: { id: scriptId, channel: { workspaceId: workspace.id } },
    include: { channel: true },
  });
  if (!script || !script.body) return;

  const completion = await llm.complete({
    model: script.model ?? script.channel.defaultModel ?? "claude-sonnet",
    system: `Produce YouTube chapter markers for a video script. Output ONLY the timestamps, one per line in the format "MM:SS Chapter title". The first must be "00:00 Introduction" (or similar). Estimate timing at ~150 wpm.`,
    messages: [{ role: "user", content: `Title: ${script.title}\nScript:\n${script.body.slice(0, 10_000)}` }],
    workspaceId: workspace.id,
  });

  const outline = readJson<{ markdown?: string; questions?: unknown; publish?: Record<string, string> }>(script.outline ?? null, {});
  outline.publish = { ...(outline.publish ?? {}), chapters: completion.content };
  await db.script.update({ where: { id: script.id }, data: { outline: writeJson(outline) } });
  revalidatePath(`/scripts/${scriptId}/publish`);
}

// ── — derivative content projects ──────────────────────────────

export async function repurposeProjectAction(formData: FormData) {
  const parentId = String(formData.get("parentId"));
  const format = String(formData.get("format") ?? "short");
  const title = String(formData.get("title") ?? "").trim();
  const { workspace } = await requireRole("EDITOR");
  const parent = await db.contentProject.findFirst({
    where: { id: parentId, channel: { workspaceId: workspace.id } },
  });
  if (!parent) return;

  const child = await db.contentProject.create({
    data: {
      channelId: parent.channelId,
      parentId: parent.id,
      title: title || `${parent.title} (${format})`,
      status: "idea",
      format,
    },
  });
  const { redirect } = await import("next/navigation");
  redirect(`/production/projects/${child.id}`);
}

// ── — Audience submissions ────────────────────────────────────────

const submitSchema = z.object({
  channelId: z.string(),
  topic: z.string().min(5).max(500),
  notes: z.string().max(2000).optional(),
  submitter: z.string().max(120).optional(),
});

/** Public submission. Called from the unauthenticated /submit/[channelId] page. */
export async function submitAudienceTopicAction(formData: FormData) {
  const parsed = submitSchema.safeParse({
    channelId: formData.get("channelId"),
    topic: formData.get("topic"),
    notes: formData.get("notes") ?? undefined,
    submitter: formData.get("submitter") ?? undefined,
  });
  if (!parsed.success) {
    const { redirect } = await import("next/navigation");
    redirect(`/submit/${formData.get("channelId")}?error=invalid`);
  }
  const channel = await db.channel.findUnique({ where: { id: parsed.data!.channelId } });
  if (!channel) {
    const { redirect } = await import("next/navigation");
    redirect(`/submit/${parsed.data!.channelId}?error=notfound`);
  }
  await db.audienceSubmission.create({
    data: {
      channelId: parsed.data!.channelId,
      topic: parsed.data!.topic,
      notes: parsed.data!.notes ?? null,
      submitter: parsed.data!.submitter ?? null,
    },
  });
  const { redirect } = await import("next/navigation");
  redirect(`/submit/${parsed.data!.channelId}?ok=1`);
}

export async function reviewSubmissionAction(formData: FormData) {
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  if (!["new", "reviewed", "promoted", "rejected"].includes(status)) return;
  const { workspace } = await requireRole("EDITOR");
  await db.audienceSubmission.updateMany({
    where: { id, channel: { workspaceId: workspace.id } },
    data: { status },
  });
  revalidatePath(`/channels`);
}

/** Promote a submission to an Idea. */
export async function promoteSubmissionAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  const sub = await db.audienceSubmission.findFirst({
    where: { id, channel: { workspaceId: workspace.id } },
  });
  if (!sub) return;
  await db.idea.create({
    data: {
      channelId: sub.channelId,
      title: sub.topic,
      strategy: sub.notes ?? "From audience submission",
      status: "new",
    },
  });
  await db.audienceSubmission.update({ where: { id: sub.id }, data: { status: "promoted" } });
  revalidatePath(`/channels/${sub.channelId}/submissions`);
  revalidatePath(`/channels/${sub.channelId}/ideas`);
}
