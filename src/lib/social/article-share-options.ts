/**
 * Article Social Share (2026-11-23, the owner's "an Article Social Share function that, optionally, shares out blog
 * articles after they're posted/published on the websites").
 *
 * One dial, `social:article_share`, under Settings → Automation: what happens when an article gets its live link.
 * Off by default — sharing is the owner's "optionally". Plain data: the Automation page and the article page read it.
 */

export type ShareMode = "off" | "draft" | "queue" | "now";

export const ARTICLE_SHARE_KEY = "social:article_share";

export const SHARE_MODES: Array<{ id: ShareMode; label: string; blurb: string }> = [
  { id: "off", label: "Off", blurb: "Articles aren't shared by themselves. “Share it now” on an article still works." },
  { id: "draft", label: "Draft it for a person", blurb: "A post announcing the article waits under Drafts for someone to read and send." },
  { id: "queue", label: "Queue it", blurb: "The post takes the next free posting slot." },
  { id: "now", label: "Post it right away", blurb: "The post goes out within a few minutes, once its picture is ready." },
];

export function parseShareMode(v: unknown): ShareMode {
  return v === "draft" || v === "queue" || v === "now" ? v : "off";
}

export function shareModeLabel(v: ShareMode): string {
  return SHARE_MODES.find((m) => m.id === v)?.label ?? "Off";
}

/**
 * Only articles that went live this recently are shared by themselves. Adding the live link to an article published
 * months ago (Add live link) must not announce it as new; a person can still press "Share it now".
 */
export const AUTO_SHARE_WINDOW_DAYS = 7;

/** The idea `source` that marks an article's share (one per article, whatever became of it). */
export const SHARE_SOURCE = "share";
