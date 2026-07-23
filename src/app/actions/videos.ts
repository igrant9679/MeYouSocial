"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { packageVideoCore, processRenderCore } from "@/lib/blog-autopilot";
import { env } from "@/lib/env";
import { estimateCostUsd } from "@/lib/video";
import { parseScenes, scenesToNarration, scenesToSrt } from "@/lib/captions";
import { getTtsProvider } from "@/lib/tts";
import { isGloballyPaused, writeAudit } from "@/lib/governance";

/**
 * Phase 4 video actions. Packaging is cheap (one LLM call); rendering costs
 * real money on a live provider, so manual processing is ADMIN-only and the
 * daily cap applies in the core either way.
 */

export async function createVideoPackageAction(formData: FormData) {
  const blogPostId = String(formData.get("blogPostId"));
  const { workspace } = await requireRole("EDITOR");
  await packageVideoCore(workspace.id, blogPostId);
  revalidatePath("/videos");
  revalidatePath(`/blog/${blogPostId}`);
}

export async function processRenderNowAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("ADMIN");
  await processRenderCore(workspace.id, id);
  revalidatePath("/videos");
}

export async function deleteRenderAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("ADMIN");
  await db.videoRender.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/videos");
}

/** Failed → queued again (clears the error; the daily cap still applies). */
export async function retryRenderAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  await db.videoRender.updateMany({
    where: { id, workspaceId: workspace.id, status: "failed" },
    data: { status: "queued", error: null },
  });
  revalidatePath("/videos");
  revalidatePath(`/videos/${id}`);
}

// ---- Storyboard editing --------------------------------------------------------

async function loadEditableRender(workspaceId: string, id: string) {
  const render = await db.videoRender.findFirst({ where: { id, workspaceId } });
  // Scenes are only editable before rendering starts — editing a done board
  // would silently desync the SRT and the clips.
  if (!render || (render.status !== "queued" && render.status !== "failed")) return null;
  return render;
}

export async function updateSceneAction(formData: FormData) {
  const id = String(formData.get("id"));
  const index = parseInt(String(formData.get("index")), 10);
  const { workspace } = await requireRole("EDITOR");
  const render = await loadEditableRender(workspace.id, id);
  if (!render || !Number.isFinite(index)) return;
  const scenes = parseScenes(render.scenes);
  if (index < 0 || index >= scenes.length) return;
  const secondsRaw = parseInt(String(formData.get("seconds")), 10);
  scenes[index] = {
    ...scenes[index],
    prompt: String(formData.get("prompt") ?? "").trim().slice(0, 2000) || scenes[index].prompt,
    text: String(formData.get("text") ?? "").trim().slice(0, 120) || null,
    seconds: Number.isFinite(secondsRaw) ? Math.max(2, Math.min(env.VIDEO_MAX_SECONDS, secondsRaw)) : scenes[index].seconds,
  };
  await persistScenes(render.id, scenes);
  revalidatePath(`/videos/${id}`);
}

export async function addSceneAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  const render = await loadEditableRender(workspace.id, id);
  if (!render) return;
  const scenes = parseScenes(render.scenes);
  if (scenes.length >= 6) return;
  scenes.push({
    prompt: String(formData.get("prompt") ?? "").trim().slice(0, 2000) || "A concrete visual scene continuing the story",
    seconds: 6,
    text: String(formData.get("text") ?? "").trim().slice(0, 120) || null,
    outputUrl: null,
    status: "planned",
  });
  await persistScenes(render.id, scenes);
  revalidatePath(`/videos/${id}`);
}

export async function deleteSceneAction(formData: FormData) {
  const id = String(formData.get("id"));
  const index = parseInt(String(formData.get("index")), 10);
  const { workspace } = await requireRole("EDITOR");
  const render = await loadEditableRender(workspace.id, id);
  if (!render || !Number.isFinite(index)) return;
  const scenes = parseScenes(render.scenes);
  if (scenes.length <= 1 || index < 0 || index >= scenes.length) return;
  scenes.splice(index, 1);
  await persistScenes(render.id, scenes);
  revalidatePath(`/videos/${id}`);
}

/** Keep the derived columns (prompt/seconds/cost) in sync with the board. */
async function persistScenes(renderId: string, scenes: ReturnType<typeof parseScenes>) {
  const totalSeconds = scenes.reduce((a, s) => a + s.seconds, 0);
  await db.videoRender.update({
    where: { id: renderId },
    data: {
      scenes: JSON.stringify(scenes),
      prompt: scenes[0]?.prompt.slice(0, 2000) ?? "",
      seconds: totalSeconds,
      costEstimate: estimateCostUsd(totalSeconds),
    },
  });
}

export async function generateSrtAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  const render = await db.videoRender.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!render) return;
  const scenes = parseScenes(render.scenes);
  if (!scenes.length) return;
  await db.videoRender.update({ where: { id: render.id }, data: { srt: scenesToSrt(scenes) } });
  revalidatePath(`/videos/${id}`);
}

export async function generateVoiceoverAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { user, workspace } = await requireRole("EDITOR");
  if (await isGloballyPaused(workspace.id)) return;
  const render = await db.videoRender.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!render) return;
  const scenes = parseScenes(render.scenes);
  const narration = scenesToNarration(render.title, scenes);
  if (narration.trim().length < 10) return;
  const tts = await getTtsProvider();
  const out = await tts.speak(narration);
  await db.videoRender.update({ where: { id: render.id }, data: { voiceoverUrl: out.url } });
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "video.voiceover_generated",
    entityType: "video_render",
    entityId: render.id,
    meta: { provider: out.provider, isAudio: out.isAudio },
  });
  revalidatePath(`/videos/${id}`);
}
