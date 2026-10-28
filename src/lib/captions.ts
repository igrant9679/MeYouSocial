/**
 * Deterministic SRT generation from a storyboard. Timing comes straight from
 * each scene's duration; the caption is the scene's on-screen text (falling
 * back to a trimmed prompt). No model involved — captions must match what the
 * video actually shows.
 */

import { env } from "@/lib/env";

/**
 * Veo renders 4, 6 or 8 seconds (audit VID-11). No length was sent, so every
 * clip came back at the provider's default while the SRT and the cost used the
 * board's numbers. Scenes are snapped on read to the nearest valid length
 * within VIDEO_MAX_SECONDS (a tie rounds up), so the board, the request, the
 * captions and the estimate agree.
 */
export const SCENE_SECONDS = [4, 6, 8] as const;
export function snapSceneSeconds(n: number): number {
  const allowed = SCENE_SECONDS.filter((s) => s <= Math.max(4, env.VIDEO_MAX_SECONDS));
  return allowed.reduce((best, s) => (Math.abs(s - n) <= Math.abs(best - n) ? s : best), allowed[0]);
}

export type StoryScene = {
  prompt: string;
  seconds: number;
  text?: string | null;
  outputUrl?: string | null;
  status?: string;
};

export function parseScenes(json: string | null | undefined): StoryScene[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json);
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s) => ({
        prompt: typeof s.prompt === "string" ? s.prompt : "",
        seconds: snapSceneSeconds(Number.isFinite(Number(s.seconds)) && Number(s.seconds) > 0 ? Number(s.seconds) : 6),
        text: typeof s.text === "string" ? s.text : null,
        outputUrl: typeof s.outputUrl === "string" ? s.outputUrl : null,
        status: typeof s.status === "string" ? s.status : "planned",
      }))
      .filter((s) => s.prompt.length > 0);
  } catch {
    return [];
  }
}

function ts(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const ms = Math.round((totalSeconds - Math.floor(totalSeconds)) * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}

export function scenesToSrt(scenes: StoryScene[]): string {
  let t = 0;
  const blocks: string[] = [];
  scenes.forEach((scene, i) => {
    const start = t;
    const end = t + scene.seconds;
    t = end;
    const caption = (scene.text?.trim() || scene.prompt.trim()).slice(0, 90);
    blocks.push(`${i + 1}\n${ts(start)} --> ${ts(end - 0.2)}\n${caption}\n`);
  });
  return blocks.join("\n");
}

/** The narration script a TTS provider reads: scene texts in order. */
export function scenesToNarration(title: string, scenes: StoryScene[]): string {
  const lines = scenes.map((s) => s.text?.trim() || "").filter(Boolean);
  return [title, ...lines].join(". ").replace(/\.\./g, ".");
}
