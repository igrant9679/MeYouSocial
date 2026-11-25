import { db } from "@/lib/db";
import { EXTENDED_MAX_SECONDS, parseScenes, scenesToSrt, type StoryScene } from "@/lib/captions";
import { writeAudit } from "@/lib/governance";
import { getVideoProvider, VIDEO_MODEL } from "@/lib/video";
import { downloadGeminiFile, extendSeconds, extendWithOmni } from "@/lib/video/omni";

/**
 * Extend a finished scene (2026-11-24, the owner's "continue" — Flow's last missing feature): continue the clip Google
 * made, in the same conversation (`previous_interaction_id`), by 3–10 seconds at its end, up to 30 seconds in all.
 *
 * Google's pages say each turn "adds" seconds and the clip may total 30, but not whether the answer is the WHOLE
 * longer clip or only the new seconds. So the answer is measured (ffmpeg): long enough to hold the old clip → it is
 * the new clip; about the length asked → it is only the tail, and it is joined onto the old clip. Either way the
 * scene's clip is replaced by one file, its seconds become what that file runs, and its `ref` moves to the new
 * interaction (so it can be extended again). A multi-scene board's stitched cut no longer matches and is made again.
 *
 * Costs money: only ever a background job after an admin confirmed the seconds (extendSceneAction). On failure the
 * scene keeps its clip, and the reason is kept on the scene (`extendError`) for its card.
 */

export type ExtendRequest = { workspaceId: string; renderId: string; index: number; seconds: number; direction?: string | null };

/** What is wrong with extending this scene now, in words — or null when it can be. */
export function extendRefusal(scene: StoryScene | undefined, boardStatus: string, seconds: number): string | null {
  if (!scene) return "That scene isn't on the board any more.";
  if (boardStatus !== "done") return "A scene can be extended once its board has finished rendering.";
  if (scene.status === "extending") return "That scene is being extended already.";
  if (scene.status !== "done" || !scene.outputUrl) return "That scene has no finished clip to continue.";
  if (!scene.ref) return "This clip was made before clips could be continued — render the scene again, then extend it.";
  if (scene.seconds + extendSeconds(seconds) > EXTENDED_MAX_SECONDS) return `A scene can run ${EXTENDED_MAX_SECONDS} seconds at most — this one is ${scene.seconds} s.`;
  return null;
}

async function readClip(url: string): Promise<Buffer | null> {
  const { storage } = await import("@/lib/storage");
  const key = url.startsWith("/uploads/") ? url.slice("/uploads/".length) : url.startsWith("/api/files/") ? url.slice("/api/files/".length) : null;
  return key ? storage.get(decodeURIComponent(key)).catch(() => null) : null;
}

export async function extendSceneCore(req: ExtendRequest): Promise<boolean> {
  const render = await db.videoRender.findFirst({ where: { id: req.renderId, workspaceId: req.workspaceId } });
  if (!render) return false;
  const scenes = parseScenes(render.scenes);
  const scene = scenes[req.index];
  const n = extendSeconds(req.seconds);
  if (extendRefusal(scene, render.status, n)) return false;

  // Claim the scene: only one extension at a time, and only of the board as it was read.
  const before = render.scenes;
  scenes[req.index] = { ...scene, status: "extending", extendError: null };
  const claimed = await db.videoRender.updateMany({ where: { id: render.id, status: "done", scenes: before }, data: { scenes: JSON.stringify(scenes) } });
  if (claimed.count !== 1) return false;

  const settle = async (patch: Partial<StoryScene>, extra: Record<string, unknown> = {}) => {
    const now = await db.videoRender.findUnique({ where: { id: render.id } });
    const cur = parseScenes(now?.scenes);
    if (!cur[req.index]) return;
    cur[req.index] = { ...cur[req.index], ...patch };
    const total = cur.reduce((a, s) => a + s.seconds, 0);
    await db.videoRender.update({ where: { id: render.id }, data: { scenes: JSON.stringify(cur), seconds: total, srt: scenesToSrt(cur), ...extra } });
  };

  try {
    const provider = await getVideoProvider(req.workspaceId);
    if (provider.name !== "google") throw new Error("Extending a clip needs Google video — the renderer here is set to the mock.");
    const out = await extendWithOmni({ workspaceId: req.workspaceId, previousId: scene.ref!, seconds: n, aspect: render.aspect as "9:16" | "16:9" | "1:1", direction: req.direction });
    const { meterVideoScene } = await import("@/lib/video-spend");
    await meterVideoScene({ workspaceId: req.workspaceId, provider: "google", model: VIDEO_MODEL, seconds: n });

    const got = out.bytes?.length ? out.bytes : await downloadGeminiFile(out.url, req.workspaceId);
    if (!got?.length) throw new Error("Google's extended clip came back empty.");
    const { probeVideo } = await import("@/lib/media-probe");
    const facts = await probeVideo(got);
    const { storage } = await import("@/lib/storage");
    // Whole clip (it holds the old one) or only the new seconds? Measured; with no ffmpeg to measure, Google's
    // "up to 30 seconds total" is read as the whole clip.
    const whole = !facts || facts.durationSec >= scene.seconds + n * 0.5;
    let url: string;
    let seconds: number;
    if (whole) {
      url = (await storage.put("render.mp4", got, out.mime ?? "video/mp4", req.workspaceId)).url;
      seconds = facts ? Math.round(facts.durationSec) : scene.seconds + n;
    } else {
      const old = await readClip(scene.outputUrl!);
      if (!old?.length) throw new Error("The scene's own clip couldn't be read back to join the new seconds onto.");
      const tail = (await storage.put("render-tail.mp4", got, out.mime ?? "video/mp4", req.workspaceId)).url;
      const { assembleScenes } = await import("@/lib/video/assemble");
      const joined = await assembleScenes(
        [{ prompt: scene.prompt, seconds: scene.seconds, outputUrl: scene.outputUrl }, { prompt: scene.prompt, seconds: Math.max(1, Math.round(facts.durationSec)), outputUrl: tail }],
        render.aspect,
        null,
        req.workspaceId,
      );
      url = joined.url;
      seconds = scene.seconds + Math.max(1, Math.round(facts.durationSec));
    }
    seconds = Math.min(EXTENDED_MAX_SECONDS, Math.max(scene.seconds, seconds));
    const single = scenes.length <= 1;
    await settle(
      { outputUrl: url, seconds, ref: out.interactionId ?? null, extended: true, status: "done", extendError: null },
      // The stitched cut no longer matches its clips; a one-scene board's output IS this clip.
      single ? { outputUrl: url, storedUrl: url } : { assembledUrl: null, assemblyStatus: null, assemblyError: null },
    );
    await writeAudit({ workspaceId: req.workspaceId, action: "video.scene_extended", entityType: "video_render", entityId: render.id, meta: { scene: req.index + 1, added: n, seconds, joined: !whole } });
    if (!single) {
      const { assembleRenderCore } = await import("@/lib/blog-autopilot");
      await assembleRenderCore(req.workspaceId, render.id).catch(() => false);
    }
    return true;
  } catch (e) {
    const message = (e instanceof Error ? e.message : "The extension failed.").slice(0, 400);
    await settle({ status: "done", extendError: message });
    await writeAudit({ workspaceId: req.workspaceId, action: "video.scene_extend_failed", entityType: "video_render", entityId: render.id, meta: { scene: req.index + 1, error: message.slice(0, 200) } });
    return false;
  }
}
