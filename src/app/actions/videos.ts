"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { assembleRenderCore, packageVideoCore } from "@/lib/blog-autopilot";
import { estimateCostUsd } from "@/lib/video";
import { parseScenes, scenesToNarration, scenesToSrt, scriptToNarration, snapSceneSeconds, wordsToSrt, type TimedWord } from "@/lib/captions";
import { getTtsProvider } from "@/lib/tts";
import { isGloballyPaused, writeAudit } from "@/lib/governance";
import { jobs } from "@/lib/jobs";
import { registerVideoRenderJobs, VIDEO_RENDER_JOB } from "@/lib/jobs/video-render";

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

/**
 * Assign (or clear) the workspace Topic on a render. Renders packaged from a
 * blog post inherit that post's topic; this lets it be set or corrected by hand
 * (and is the only way to set one on a render with no source post).
 */
export async function setRenderTopicAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("topicId") ?? "").trim();
  const { workspace } = await requireRole("EDITOR");
  const render = await db.videoRender.findFirst({ where: { id, workspaceId: workspace.id }, select: { id: true } });
  if (!render) return;
  const topicId = raw
    ? (await db.topic.findFirst({ where: { id: raw, workspaceId: workspace.id }, select: { id: true } }))?.id ?? null
    : null;
  await db.videoRender.update({ where: { id: render.id }, data: { topicId } });
  revalidatePath("/videos");
  revalidatePath(`/videos/${render.id}`);
}

/**
 * "Render now" (ADMIN — it spends provider money). Queued as a background job
 * (E-VID-07) instead of holding the request open for minutes; the board's page
 * refreshes while it renders scene by scene. One job per board at a time.
 */
export async function processRenderNowAction(formData: FormData) {
  const id = String(formData.get("id"));
  const back = String(formData.get("back") ?? "") === "list" ? "/videos" : `/videos/${id}`;
  const { workspace, user } = await requireRole("ADMIN");
  const render = await db.videoRender.findFirst({ where: { id, workspaceId: workspace.id }, select: { id: true, status: true } });
  if (!render) return;
  const go = (k: "flash" | "flashErr", m: string): never => redirect(`${back}?${k}=${encodeURIComponent(m)}`);
  if (render.status !== "queued") go("flashErr", render.status === "rendering" ? "It's already rendering." : "Only a queued board can be rendered — Retry a stopped one first.");
  if (await isGloballyPaused(workspace.id)) go("flashErr", "Automation is paused for this workspace, so nothing renders until it's resumed.");
  registerVideoRenderJobs();
  const last = await jobs.latestFor(VIDEO_RENDER_JOB, render.id);
  if (last && (last.state === "queued" || last.state === "running")) go("flashErr", "A render of this board is already on its way.");
  await jobs.enqueue(VIDEO_RENDER_JOB, { workspaceId: workspace.id, renderId: render.id }, { refId: render.id, workspaceId: workspace.id, maxAttempts: 1 });
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "video.render_started", entityType: "video_render", entityId: render.id });
  revalidatePath("/videos");
  go("flash", "Rendering in the background — this page updates as each scene finishes.");
}

/**
 * Render one finished scene again (E-VID-07), keeping every other clip: the
 * scene is reset and the board queued, so the next render — Render now or the
 * engine's video step — pays for that scene only. The stitched cut is cleared;
 * it would no longer match the clips.
 */
export async function rerenderSceneAction(formData: FormData) {
  const id = String(formData.get("id"));
  const index = Number(formData.get("index"));
  const { workspace, user } = await requireRole("EDITOR");
  const render = await db.videoRender.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!render || (render.status !== "done" && render.status !== "failed")) return;
  const scenes = parseScenes(render.scenes);
  const scene = Number.isInteger(index) ? scenes[index] : undefined;
  const single = scenes.length <= 1;
  if (!single && !(scene && scene.status === "done" && scene.outputUrl)) return;
  if (!single) scenes[index] = { ...scene!, outputUrl: null, status: "planned" };
  // Conditional on the status read, so it can't re-queue a board that started rendering meanwhile.
  const r = await db.videoRender.updateMany({
    where: { id: render.id, status: render.status },
    data: {
      status: "queued",
      error: null,
      ...(single ? { outputUrl: null, storedUrl: null } : { scenes: JSON.stringify(scenes) }),
      assembledUrl: null,
      assemblyStatus: null,
      assemblyError: null,
    },
  });
  if (r.count) {
    await writeAudit({
      workspaceId: workspace.id, actorId: user.id, action: "video.scene_rerender_queued",
      entityType: "video_render", entityId: render.id, meta: { scene: single ? 1 : index + 1 },
    });
  }
  revalidatePath("/videos");
  redirect(`/videos/${render.id}?flash=${encodeURIComponent(r.count ? `Scene ${single ? 1 : index + 1} will render again; the other clips are kept. The board is queued.` : "The board changed meanwhile — nothing was queued.")}`);
}

/**
 * Stitch the board's clips into one file. EDITOR-level: unlike rendering this
 * costs no provider money, only local CPU. Re-runnable — a fresh voiceover or a
 * re-render is a legitimate reason to assemble again.
 */
export async function assembleRenderAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  // E-VID-08: the (re-)assemble form says whether the captions go into the picture.
  if (formData.has("burnChoice")) {
    await db.videoRender.updateMany({ where: { id, workspaceId: workspace.id }, data: { burnCaptions: formData.get("burn") === "on" } });
  }
  await assembleRenderCore(workspace.id, id);
  revalidatePath("/videos");
  revalidatePath(`/videos/${id}`);
}

export async function deleteRenderAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("ADMIN");
  await db.videoRender.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/videos");
}

/**
 * Stop a queued or rendering board (audit VID-09). It becomes "failed" with a
 * reason, so Retry picks it up later and renders only the scenes that didn't
 * finish; a board mid-render stops before its next scene (processRenderCore
 * checks between scenes and won't mark a cancelled board done).
 */
export async function cancelRenderAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace, user } = await requireRole("EDITOR");
  const r = await db.videoRender.updateMany({
    where: { id, workspaceId: workspace.id, status: { in: ["queued", "rendering"] } },
    data: { status: "failed", error: `Cancelled by ${user.name ?? user.email}. Retry renders only the scenes that didn't finish.` },
  });
  if (r.count) await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "video.render_cancelled", entityType: "video_render", entityId: id });
  revalidatePath("/videos");
  revalidatePath(`/videos/${id}`);
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
  const prompt = String(formData.get("prompt") ?? "").trim().slice(0, 2000) || scenes[index].prompt;
  const seconds = Number.isFinite(secondsRaw) ? snapSceneSeconds(secondsRaw) : scenes[index].seconds;
  // A retry skips finished clips; a scene whose picture changed isn't finished.
  const changed = prompt !== scenes[index].prompt || seconds !== scenes[index].seconds;
  scenes[index] = {
    ...scenes[index],
    prompt,
    text: String(formData.get("text") ?? "").trim().slice(0, 120) || null,
    seconds,
    ...(changed ? { outputUrl: null, status: "planned" } : {}),
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
  // E-VID-08: when the narration came back with word timing, the captions
  // follow the voice word by word; otherwise they're timed from the scenes.
  const words = parseWords(render.voiceWords);
  if (words.length) {
    await db.videoRender.update({ where: { id: render.id }, data: { srt: wordsToSrt(words), captionsTimedBy: "voice" } });
  } else {
    if (!scenes.length) return;
    await db.videoRender.update({ where: { id: render.id }, data: { srt: scenesToSrt(scenes), captionsTimedBy: "scenes" } });
  }
  revalidatePath(`/videos/${id}`);
}

function parseWords(raw: string | null | undefined): TimedWord[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((w): w is TimedWord => !!w && typeof w.word === "string" && Number.isFinite(w.start) && Number.isFinite(w.end)) : [];
  } catch {
    return [];
  }
}

export async function generateVoiceoverAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { user, workspace } = await requireRole("EDITOR");
  if (await isGloballyPaused(workspace.id)) return;
  const render = await db.videoRender.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!render) return;
  const scenes = parseScenes(render.scenes);
  // E-VID-08: narration from the script itself (its spoken words, directions
  // dropped) when the render has one and that's asked for; else the scenes.
  // The voice is the script's channel's own, else the provider's default.
  const script = render.scriptId
    ? await db.script.findFirst({ where: { id: render.scriptId, channel: { workspaceId: workspace.id } }, select: { body: true, channel: { select: { voiceId: true } } } })
    : null;
  const fromScript = String(formData.get("source") ?? "") === "script" && !!script?.body?.trim();
  const narration = fromScript ? scriptToNarration(script!.body!) : scenesToNarration(render.title, scenes);
  if (narration.trim().length < 10) return;
  const tts = await getTtsProvider(workspace.id);
  const out = await tts.speak(narration, { voiceId: script?.channel.voiceId ?? null });
  await db.videoRender.update({
    where: { id: render.id },
    data: {
      voiceoverUrl: out.url,
      voiceId: out.voice ?? null,
      narrationSource: fromScript ? "script" : "scenes",
      // New narration, new timing: captions timed to the OLD voice would drift.
      voiceWords: out.words?.length ? JSON.stringify(out.words) : null,
      ...(render.captionsTimedBy === "voice" ? { srt: out.words?.length ? wordsToSrt(out.words) : null, captionsTimedBy: out.words?.length ? "voice" : null } : {}),
    },
  });
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "video.voiceover_generated",
    entityType: "video_render",
    entityId: render.id,
    meta: { provider: out.provider, isAudio: out.isAudio, voice: out.voice ?? null, source: fromScript ? "script" : "scenes", timedWords: out.words?.length ?? 0 },
  });
  revalidatePath(`/videos/${id}`);
}
