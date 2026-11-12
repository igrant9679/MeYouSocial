/**
 * What an idea was drawn from (Reach): the live discussions and pages discovery
 * listed and the model said the idea answers. The same JSON on every idea table
 * — BlogIdea (part da), SocialIdea and Idea (part dc) — as [{title, url, source}].
 * Pure, so the board and every idea page read it the same way.
 */
export type IdeaEvidence = { title: string; url: string; source: string };

/** Stored evidence, read safely: http(s) links only, at most `max`; anything else is dropped. */
export function parseEvidence(raw: string | null | undefined, max = 8): IdeaEvidence[] {
  if (!raw) return [];
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(v)) return [];
  const out: IdeaEvidence[] = [];
  for (const e of v) {
    const url = (e as { url?: unknown })?.url;
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) continue;
    const title = (e as { title?: unknown }).title;
    const source = (e as { source?: unknown }).source;
    out.push({ title: typeof title === "string" ? title : "", url, source: typeof source === "string" ? source : "web" });
    if (out.length >= max) break;
  }
  return out;
}

/** How many sources a board card's chip counts. */
export const evidenceCount = (raw: string | null | undefined) => parseEvidence(raw).length;
