import type { StoryScene } from "@/lib/captions";

/**
 * Where a render board is (E-VID-07), read from the board's status and its
 * scenes' own status — processRenderCore marks a scene "rendering" before it
 * pays the provider for it and "done" once the clip is kept, so a page that
 * refreshes shows the board moving scene by scene.
 */

export type SceneState = "done" | "rendering" | "next" | "waiting" | "interrupted";

/** A scene left "rendering" on a board that isn't rendering any more was cut off mid-scene. */
export function sceneState(boardStatus: string, scene: StoryScene, index: number, scenes: StoryScene[]): SceneState {
  if (scene.status === "done" && scene.outputUrl) return "done";
  if (scene.status === "rendering" && boardStatus === "rendering") return "rendering";
  if (scene.status === "rendering" && boardStatus !== "queued") return "interrupted";
  // Queued again after a stop: the cut-off scene is simply the next one to render.
  if (boardStatus === "queued" || boardStatus === "rendering") {
    const first = scenes.findIndex((s) => !(s.status === "done" && s.outputUrl));
    const live = boardStatus === "rendering" && scenes.some((s) => s.status === "rendering");
    return first === index && !live ? "next" : "waiting";
  }
  return "waiting";
}

export const SCENE_STATE_LABEL: Record<SceneState, string> = {
  done: "done",
  rendering: "rendering now…",
  next: "next to render",
  waiting: "not rendered yet",
  interrupted: "interrupted",
};

export type BoardProgress = { done: number; total: number; current: number | null; line: string };

/** One line for the board's header and the Videos list. */
export function boardProgress(boardStatus: string, scenes: StoryScene[]): BoardProgress {
  const total = Math.max(1, scenes.length);
  const done = scenes.filter((s) => s.status === "done" && s.outputUrl).length;
  const at = scenes.findIndex((s) => s.status === "rendering");
  const current = at >= 0 ? at : null;
  const clips = scenes.length > 1 ? ` · ${done} of ${total} clips done` : "";
  if (boardStatus === "rendering") {
    return { done, total, current, line: scenes.length > 1 ? `Rendering scene ${(current ?? Math.min(done, total - 1)) + 1} of ${total}${clips}` : "Rendering…" };
  }
  if (boardStatus === "queued") {
    return { done, total, current, line: done > 0 ? `Queued — ${total - done} scene${total - done === 1 ? "" : "s"} left to render${clips}` : "Queued" };
  }
  if (boardStatus === "failed" && scenes.length > 1) {
    const left = total - done;
    return { done, total, current, line: left > 0 ? `Stopped${clips} — Retry renders the ${left} that didn't finish` : `Stopped${clips}` };
  }
  return { done, total, current, line: "" };
}
