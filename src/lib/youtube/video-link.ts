/**
 * A project's own YouTube upload (E-MEA-17). Until a project carried its video
 * id, a Topic's video numbers were its channel's videos MATCHED BY KEYWORD to
 * the Topic's name — a title that happened to mention the phrase counted, and
 * the video the team actually made for it could be missed. A linked video is
 * the real thing; keyword matching stays only for videos no project claims.
 */

const ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * The video id in whatever someone pastes: the id itself, a watch, share,
 * Shorts, live or embed link, or the Studio edit page. Null when there isn't
 * one — never a guess.
 */
export function youtubeVideoIdFrom(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  if (ID.test(raw)) return raw;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.split("/")[1] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = u.searchParams.get("v") ?? u.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/?#]+)/)?.[1] ?? null;
  } else if (host === "studio.youtube.com") {
    id = u.pathname.match(/^\/video\/([^/?#]+)/)?.[1] ?? null;
  }
  return id && ID.test(id) ? id : null;
}

export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "how", "why", "what", "your", "you", "is", "are", "my", "our", "this", "that", "it"]);
const words = (s: string) => new Set(s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));

/**
 * Uploads that look like this project — by shared title words, at least half
 * of the project title's — for one-click linking. A suggestion only: the
 * person picks, nothing is linked by itself.
 */
export function suggestUploads<V extends { id: string; title: string }>(projectTitle: string, videos: V[], taken: ReadonlySet<string>, max = 3): V[] {
  const mine = words(projectTitle);
  if (!mine.size) return [];
  return videos
    .filter((v) => !taken.has(v.id))
    .map((v) => {
      const theirs = words(v.title);
      let shared = 0;
      for (const w of mine) if (theirs.has(w)) shared++;
      return { v, score: shared / mine.size };
    })
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.v);
}
