import { db } from "@/lib/db";
import { RAIL } from "@/lib/nav";
import { STAGES, STAGE_HREFS } from "@/lib/stages";
import { NAV_TIPS } from "@/lib/help-tips";
import { HELP_CATEGORIES } from "@/lib/help";
import { canFollow } from "@/lib/role-links";
import type { Role } from "@prisma/client";

/**
 * One box for everything (E-SHL-06, Ctrl+K): the pages this person can open,
 * the workspace's articles, ideas of every format, social posts and Topics,
 * and the Help answers — each a link to where it lives.
 *
 * Pages come from the rail and the stages' own tabs (lib/nav.ts,
 * lib/stages.ts), filtered by `canFollow` — the same gate the rail uses —
 * so the box never offers a page the person would be refused. Content is
 * this workspace's only, a few of each kind, newest first.
 */

export type SearchHit = {
  kind: "page" | "article" | "idea" | "post" | "topic" | "help";
  title: string;
  detail?: string | null;
  href: string;
};

export const MIN_QUERY = 2;
const EACH = 5;

/** Every page reachable from the rail and the stage strips, with what it's for. */
export function searchablePages(role: Role, studio: boolean, channelId: string | null): Array<{ title: string; detail: string; href: string }> {
  const out = new Map<string, { title: string; detail: string; href: string }>();
  const ctx = { channelId, studio, admin: role === "ADMIN", operator: false };
  for (const n of RAIL) out.set(n.href, { title: n.label, detail: NAV_TIPS[n.href] ?? "", href: n.href });
  for (const h of STAGE_HREFS) {
    const stage = STAGES[h];
    for (const t of stage.tabs(ctx)) if (!out.has(t.href)) out.set(t.href, { title: `${stage.label} › ${t.label}`, detail: "", href: t.href });
  }
  return [...out.values()].filter((p) => canFollow(p.href, role));
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
/** Words that carry no meaning in a search ("how do I publish" is about publishing). */
const STOP = new Set(["a", "an", "the", "i", "my", "me", "do", "does", "how", "what", "where", "why", "can", "to", "of", "in", "on", "for", "is", "it", "and", "or", "with"]);
/** The words to look for — every one must appear somewhere; at most five. */
export function queryWords(q: string): string[] {
  const all = norm(q).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
  const meaningful = all.filter((w) => !STOP.has(w));
  return (meaningful.length ? meaningful : all).slice(0, 5);
}
/**
 * Every word must be in the title or the detail. The whole phrase at the
 * start of the title ranks first, then the phrase anywhere in it, then every
 * word in the title, then words found only in the detail.
 */
function score(q: string, title: string, detail = ""): number {
  const t = norm(title), d = norm(detail), words = queryWords(q), n = norm(q).trim();
  if (!words.length || !words.every((w) => t.includes(w) || d.includes(w))) return 0;
  if (t.startsWith(n)) return 4;
  if (t.includes(n)) return 3;
  if (words.every((w) => t.includes(w))) return 2;
  return 1;
}

export async function globalSearch(input: { workspaceId: string; role: Role; q: string; studio: boolean; channelId: string | null }): Promise<SearchHit[]> {
  const q = input.q.trim().slice(0, 100);
  if (q.length < MIN_QUERY) return [];
  // Every meaningful word, each anywhere in the text ("donor webinar" finds "our donor retention webinar").
  const words = queryWords(q);
  if (!words.length) return [];
  const all = (field: string) => ({ AND: words.map((w) => ({ [field]: { contains: w, mode: "insensitive" as const } })) });
  const ws = input.workspaceId;

  const pages = searchablePages(input.role, input.studio, input.channelId)
    .map((p) => ({ p, s: score(q, p.title, p.detail) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 6)
    .map(({ p }): SearchHit => ({ kind: "page", title: p.title, detail: p.detail.slice(0, 120) || null, href: p.href }));

  const [articles, blogIdeas, socialIdeas, videoIdeas, posts, topics] = await Promise.all([
    db.blogPost.findMany({ where: { workspaceId: ws, ...all("title") }, orderBy: { updatedAt: "desc" }, take: EACH, select: { id: true, title: true, status: true } }),
    db.blogIdea.findMany({ where: { workspaceId: ws, ...all("title") }, orderBy: { updatedAt: "desc" }, take: EACH, select: { id: true, title: true, status: true } }),
    db.socialIdea.findMany({ where: { workspaceId: ws, ...all("hook") }, orderBy: { updatedAt: "desc" }, take: EACH, select: { id: true, hook: true, status: true } }),
    db.idea.findMany({ where: { channel: { workspaceId: ws }, ...all("title") }, orderBy: { createdAt: "desc" }, take: EACH, select: { id: true, title: true, status: true, channelId: true } }),
    db.socialPost.findMany({ where: { workspaceId: ws, ...all("text") }, orderBy: { updatedAt: "desc" }, take: EACH, select: { id: true, text: true, status: true } }),
    db.topic.findMany({ where: { workspaceId: ws, ...all("name") }, orderBy: { name: "asc" }, take: EACH, select: { id: true, name: true, status: true } }),
  ]);
  const snippet = (s: string) => (s.length > 90 ? `${s.slice(0, 88)}…` : s);

  const help: SearchHit[] = HELP_CATEGORIES.flatMap((c) => c.entries.map((f) => ({ c, f })))
    .map(({ c, f }) => ({ c, f, s: score(q, f.q, f.a) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 4)
    .map(({ c, f }) => ({ kind: "help" as const, title: f.q, detail: `Help · ${c.label}`, href: `/help?q=${encodeURIComponent(f.q.slice(0, 80))}` }));

  return [
    ...pages,
    ...articles.map((a): SearchHit => ({ kind: "article", title: a.title, detail: a.status.replace(/_/g, " "), href: `/blog/${a.id}` })),
    ...blogIdeas.map((i): SearchHit => ({ kind: "idea", title: i.title, detail: `article idea · ${i.status}`, href: `/ideas/article/${i.id}` })),
    ...socialIdeas.map((i): SearchHit => ({ kind: "idea", title: snippet(i.hook), detail: `social idea · ${i.status}`, href: `/ideas/social/${i.id}` })),
    ...videoIdeas.map((i): SearchHit => ({ kind: "idea", title: i.title, detail: `video idea · ${i.status}`, href: `/channels/${i.channelId}/ideas/${i.id}` })),
    ...posts.map((p): SearchHit => ({ kind: "post", title: snippet(p.text.replace(/\s+/g, " ")), detail: `post · ${p.status}`, href: p.status === "draft" || p.status === "scheduled" ? `/social/${p.id}/edit` : `/social/${p.id}` })),
    ...topics.map((t): SearchHit => ({ kind: "topic", title: t.name, detail: t.status === "active" ? "Topic" : "Topic · archived", href: `/ideas/topics/${t.id}` })),
    ...help,
  ];
}
