import { db } from "@/lib/db";
import { keyTokens } from "@/lib/blog-idea-scoring";

/**
 * Duplicates across formats (E-IDE-03): the same idea arriving as an article
 * idea, a video idea and a social idea — or as an idea when it's already being
 * written. One index of the workspace's open work (ideas still to be made, and
 * articles and scripts in progress), compared on the meaningful words of the
 * title (the Jaccard overlap the idea scoring already uses). It only points;
 * nothing is merged or hidden without a person.
 */

/** Title overlap at or above this reads as "the same idea". */
export const DUP_THRESHOLD = 0.5;

export type WorkKind = "article" | "video" | "social" | "article_draft" | "script";
export type OpenWork = { kind: WorkKind; id: string; title: string; status: string; href: string; sourceVideoId: string | null; tokens: Set<string> };
export type Match = { kind: WorkKind; id: string; title: string; status: string; href: string; sim: number };

export const KIND_LABEL: Record<WorkKind, string> = {
  article: "article idea", video: "video idea", social: "social idea", article_draft: "article being written", script: "script being written",
};

export async function openWorkIndex(workspaceId: string): Promise<OpenWork[]> {
  const [articles, videos, socials, drafts, scripts] = await Promise.all([
    db.blogIdea.findMany({ where: { workspaceId, status: { in: ["discovered", "approved"] } }, select: { id: true, title: true, status: true, sourceVideoId: true }, take: 500 }),
    db.idea.findMany({ where: { channel: { workspaceId }, status: { in: ["new", "approved", "in_progress"] } }, select: { id: true, title: true, status: true, sourceVideoId: true }, take: 500 }),
    db.socialIdea.findMany({ where: { workspaceId, status: { in: ["discovered", "approved"] } }, select: { id: true, hook: true, status: true, sourceVideoId: true }, take: 500 }),
    db.blogPost.findMany({ where: { workspaceId, status: { in: ["drafting", "draft_review", "final_approval"] } }, select: { id: true, title: true, status: true }, take: 300 }),
    db.script.findMany({ where: { channel: { workspaceId }, status: "draft" }, select: { id: true, title: true, status: true }, take: 300 }),
  ]);
  const row = (kind: WorkKind, id: string, title: string, status: string, href: string, sourceVideoId: string | null = null): OpenWork =>
    ({ kind, id, title, status, href, sourceVideoId, tokens: keyTokens(title) });
  return [
    ...articles.map((i) => row("article", i.id, i.title, i.status, `/ideas/article/${i.id}`, i.sourceVideoId)),
    ...videos.map((i) => row("video", i.id, i.title, i.status, `/ideas?format=video&q=${encodeURIComponent(i.title.slice(0, 60))}`, i.sourceVideoId)),
    ...socials.map((i) => row("social", i.id, i.hook, i.status, `/ideas/social/${i.id}`, i.sourceVideoId)),
    ...drafts.map((p) => row("article_draft", p.id, p.title, p.status, `/blog/${p.id}`)),
    ...scripts.map((s) => row("script", s.id, s.title, s.status, `/scripts/${s.id}`)),
  ];
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

const strip = (w: OpenWork, sim: number): Match => ({ kind: w.kind, id: w.id, title: w.title, status: w.status, href: w.href, sim });

/**
 * The closest other piece of open work for each open idea, where one is close
 * enough. Keyed `${kind}:${id}`. An idea never matches itself; ties go to work
 * further along (a draft beats an idea).
 */
export function duplicatesAmong(index: OpenWork[]): Map<string, Match> {
  const out = new Map<string, Match>();
  const order: Record<WorkKind, number> = { article_draft: 0, script: 0, article: 1, video: 1, social: 1 };
  const ideas = index.filter((w) => w.kind === "article" || w.kind === "video" || w.kind === "social");
  for (const a of ideas) {
    let best: { w: OpenWork; sim: number } | null = null;
    for (const b of index) {
      if (a === b) continue;
      const sim = jaccard(a.tokens, b.tokens);
      if (sim < DUP_THRESHOLD) continue;
      if (!best || sim > best.sim || (sim === best.sim && order[b.kind] < order[best.w.kind])) best = { w: b, sim };
    }
    if (best) out.set(`${a.kind}:${a.id}`, strip(best.w, best.sim));
  }
  return out;
}

/**
 * Is this piece of research already an idea? First, ideas made FROM it (they
 * keep `sourceVideoId`); then open work whose title is close to its title.
 */
export function alreadyAnIdea(index: OpenWork[], video: { id: string; title: string }): Match | null {
  const made = index.find((w) => w.sourceVideoId === video.id);
  if (made) return strip(made, 1);
  const tokens = keyTokens(video.title);
  let best: Match | null = null;
  for (const w of index) {
    const sim = jaccard(tokens, w.tokens);
    if (sim >= DUP_THRESHOLD && (!best || sim > best.sim)) best = strip(w, sim);
  }
  return best;
}
