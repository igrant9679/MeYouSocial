"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { durationSeconds } from "@/lib/canvas/duration";
import { writeJson, readJson } from "@/lib/db/json";

// ── — Sync published-video stats into Content Projects ───────────

/**
 * ⚠ Audit VID-08: this wrote views, retention and engagement computed from a
 * HASH of the project id — invented numbers shown as the video's performance
 * (and fed to idea generation as "own-channel retention"). A project has no
 * link to its published YouTube video yet, so there is nothing real to read:
 * it records nothing and says so.
 */
export async function syncStatsAction(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const { workspace } = await requireRole("EDITOR");
  const project = await db.contentProject.findFirst({ where: { id: projectId, channel: { workspaceId: workspace.id } }, select: { id: true } });
  if (!project) return;
  (await import("next/navigation")).redirect(`/production/projects/${project.id}?flashErr=${encodeURIComponent("Stats can't be synced yet: a project isn't linked to its published YouTube video, so there's nothing real to read. Nothing was recorded.")}`);
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

/**
 * Chapter markers COMPUTED from the script (audit VID-08): each section heading
 * (a bold line or a # heading) at the speaking time of the words before it —
 * the same words-per-minute the canvas shows. A model used to guess the
 * timestamps. YouTube needs the first at 00:00, at least three, 10 s apart.
 */
export async function generateChapterMarkersAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId"));
  const { workspace } = await requireRole("EDITOR");
  const script = await db.script.findFirst({
    where: { id: scriptId, channel: { workspaceId: workspace.id } },
    select: { id: true, body: true, outline: true },
  });
  if (!script || !script.body) return;

  const chapters = chaptersFromScript(script.body);
  if (chapters.length < 3) {
    (await import("next/navigation")).redirect(`/scripts/${script.id}/publish?flashErr=${encodeURIComponent("Chapters need at least three section headings in the script, 10 seconds apart (bold lines or # headings). Add them on the Canvas and try again.")}`);
  }

  const outline = readJson<{ markdown?: string; questions?: unknown; publish?: Record<string, string> }>(script.outline ?? null, {});
  outline.publish = { ...(outline.publish ?? {}), chapters: chapters.join("\n") };
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
  revalidatePath("/ideas");
}

function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), sec = seconds % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}

/** "MM:SS Title" lines from a script's headings, timed by the words before each. */
function chaptersFromScript(body: string): string[] {
  const out: Array<{ at: number; title: string }> = [];
  let words = 0;
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    const heading = t.match(/^#{1,6}\s+(.+)$/)?.[1] ?? t.match(/^\*\*(.+?)\*\*:?$/)?.[1];
    if (heading) {
      const title = heading.replace(/[*_`]/g, "").replace(/^\d+[.)]\s*/, "").trim().slice(0, 80);
      const at = out.length === 0 ? 0 : durationSeconds(words);
      if (title && (out.length === 0 || at - out[out.length - 1].at >= 10)) out.push({ at, title });
      continue;
    }
    words += t ? t.split(/\s+/).length : 0;
  }
  return out.map((c) => `${clock(c.at)} ${c.title}`);
}
