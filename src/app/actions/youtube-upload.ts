"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { isGloballyPaused, writeAudit } from "@/lib/governance";
import { jobs } from "@/lib/jobs";
import { getPostingTimeZone, parseZonedInput } from "@/lib/social/slots";
import { youtubeOauthConnected } from "@/lib/youtube/oauth";
import { metadataProblem, videoTypeOf, type Privacy } from "@/lib/youtube/upload";
import { registerYoutubeUploadJobs, YOUTUBE_UPLOAD_JOB } from "@/lib/jobs/youtube-upload";
import { projectUploadSources } from "@/lib/youtube/upload-sources";

/**
 * Upload a project's video to the workspace's YouTube channel (E-VID-03).
 * ADMIN: it puts something on a public platform. The form defaults to Private,
 * and the first press shows what will go where and asks; only the confirmed
 * press starts the background upload. Blocked while the workspace is paused.
 */
export async function startYoutubeUploadAction(formData: FormData) {
  const { workspace, user } = await requireRole("ADMIN");
  const projectId = String(formData.get("projectId") ?? "");
  const back = `/production/projects/${encodeURIComponent(projectId)}`;
  const err = (m: string): never => redirect(`${back}?flashErr=${encodeURIComponent(m)}#youtube-upload`);
  const project = await db.contentProject.findFirst({ where: { id: projectId, channel: { workspaceId: workspace.id } }, select: { id: true, title: true, scriptId: true } });
  if (!project) err("That project isn't in this workspace.");
  if (await isGloballyPaused(workspace.id)) err("Automation is paused for this workspace, so nothing goes to YouTube until it's resumed.");
  const yt = await youtubeOauthConnected(workspace.id);
  if (!yt.connected) err("No YouTube channel is connected — connect it under Settings → Connections first (it asks Google for upload permission).");

  const sources = await projectUploadSources(workspace.id, project!.id, project!.scriptId);
  const source = sources.videos.find((s) => s.value === String(formData.get("source") ?? ""));
  if (!source) err("Pick the video to upload — one of this project's own files.");
  const thumbValue = String(formData.get("thumbnail") ?? "");
  const thumb = thumbValue ? sources.images.find((s) => s.value === thumbValue) : null;
  if (thumbValue && !thumb) err("That thumbnail isn't one of this project's images.");

  const kids = String(formData.get("madeForKids") ?? "");
  if (kids !== "yes" && kids !== "no") err("Say whether the video is made for kids — YouTube requires it.");
  const privacy = String(formData.get("privacy") ?? "private") as Privacy;
  if (!["private", "unlisted", "public"].includes(privacy)) err("Choose Private, Unlisted or Public.");
  const rawAt = String(formData.get("publishAt") ?? "").trim();
  const publishAt = rawAt ? parseZonedInput(rawAt, await getPostingTimeZone(workspace.id)) : null;
  if (rawAt && (!publishAt || Number.isNaN(publishAt.getTime()))) err("Enter a valid date and time to publish, or leave it blank.");
  const tags = String(formData.get("tags") ?? "").split(",").map((t) => t.trim().replace(/[<>"]/g, "")).filter(Boolean).slice(0, 60);
  const meta = {
    title: String(formData.get("title") ?? "").trim(),
    description: String(formData.get("description") ?? "").replace(/\r\n/g, "\n"),
    tags,
    privacy,
    publishAt,
    madeForKids: kids === "yes",
  };
  const problem = metadataProblem(meta);
  if (problem) err(problem);

  await db.youtubeUpload.deleteMany({ where: { workspaceId: workspace.id, projectId: project!.id, state: "draft" } });
  const busy = await db.youtubeUpload.count({ where: { workspaceId: workspace.id, projectId: project!.id, state: { in: ["queued", "uploading"] } } });
  if (busy) err("An upload of this project is already on its way.");

  // First press: a summary to say yes to — what goes where, as what.
  {
    // The summary is a draft row the confirm turns into a queued upload — the form's values never ride in a URL.
    const draft = await db.youtubeUpload.create({
      data: {
        workspaceId: workspace.id, projectId: project!.id, sourceKey: source!.key, sourceName: source!.name, contentType: videoTypeOf(source!.name) ?? "video/mp4",
        title: meta.title, description: meta.description, tags: JSON.stringify(meta.tags), privacy: meta.privacy, publishAt: meta.publishAt,
        madeForKids: meta.madeForKids, thumbnailKey: thumb?.key ?? null, state: "draft", createdById: user.id,
      },
    });
    redirect(`${back}?confirmUpload=${draft.id}#youtube-upload`);
  }
}

/** The confirmed press: the draft row becomes a queued upload and the job starts. */
export async function confirmYoutubeUploadAction(formData: FormData) {
  const { workspace, user } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const up = await db.youtubeUpload.findFirst({ where: { id, workspaceId: workspace.id, state: "draft" } });
  const back = up?.projectId ? `/production/projects/${up.projectId}` : "/production";
  const go = (k: "flash" | "flashErr", m: string): never => redirect(`${back}?${k}=${encodeURIComponent(m)}#youtube-upload`);
  if (!up) go("flashErr", "That upload isn't waiting for a yes any more.");
  if (await isGloballyPaused(workspace.id)) go("flashErr", "Automation is paused for this workspace, so nothing goes to YouTube until it's resumed.");
  const moved = await db.youtubeUpload.updateMany({ where: { id: up!.id, state: "draft" }, data: { state: "queued" } });
  if (!moved.count) go("flashErr", "That upload already started.");
  registerYoutubeUploadJobs();
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "youtube.upload_started", entityType: "youtube_upload", entityId: up!.id, meta: { title: up!.title, privacy: up!.publishAt ? "scheduled" : up!.privacy } });
  await jobs.enqueue(YOUTUBE_UPLOAD_JOB, { uploadId: up!.id }, { refId: up!.id, workspaceId: workspace.id, maxAttempts: 1 });
  revalidatePath(back);
  go("flash", "Uploading to YouTube in the background — this page shows how far it's got.");
}

/** Drop a summary nobody confirmed, or retry a failed upload (it resumes where YouTube says it stopped). */
export async function youtubeUploadStepAction(formData: FormData) {
  const { workspace, user } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const op = String(formData.get("op") ?? "");
  const up = await db.youtubeUpload.findFirst({ where: { id, workspaceId: workspace.id } });
  const back = up?.projectId ? `/production/projects/${up.projectId}` : "/production";
  const go = (k: "flash" | "flashErr", m: string): never => redirect(`${back}?${k}=${encodeURIComponent(m)}#youtube-upload`);
  if (!up) go("flashErr", "That upload isn't here any more.");
  if (op === "discard") {
    await db.youtubeUpload.deleteMany({ where: { id: up!.id, state: { in: ["draft", "failed"] } } });
    go("flash", up!.state === "draft" ? "Not uploaded." : "Removed.");
  }
  if (op === "retry") {
    if (await isGloballyPaused(workspace.id)) go("flashErr", "Automation is paused for this workspace, so nothing goes to YouTube until it's resumed.");
    const moved = await db.youtubeUpload.updateMany({ where: { id: up!.id, state: "failed" }, data: { state: "queued", error: null } });
    if (!moved.count) go("flashErr", "Only a failed upload can be retried.");
    registerYoutubeUploadJobs();
    await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "youtube.upload_retried", entityType: "youtube_upload", entityId: up!.id });
    await jobs.enqueue(YOUTUBE_UPLOAD_JOB, { uploadId: up!.id }, { refId: up!.id, workspaceId: workspace.id, maxAttempts: 1 });
    revalidatePath(back);
    go("flash", "Trying again — it carries on from what YouTube already has.");
  }
  go("flashErr", "Nothing to do.");
}

