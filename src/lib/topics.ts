import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";

/**
 * Topics are the spine (2026-09-21): the one tag Research, all three idea
 * formats, the things made from them and the results measured share. This
 * module is the per-Topic ledger every Topics surface reads — the management
 * tab under Ideas, the per-Topic page, the board's lane headers — so the same
 * number means the same thing everywhere.
 *
 * Counts only. "Made" = an article, a script or a social post exists for an
 * idea of this Topic (or was tagged with it directly); "out" = published or
 * posted. What a Topic EARNED lives in lib/metrics (Measure → Topics), not
 * here: a count is a fact, a result is a measurement, and the two must never
 * be confused for each other.
 */

export type TopicLedger = {
  id: string;
  name: string;
  description: string | null;
  phrases: string[];
  priority: number;
  status: string;
  ideas: { article: number; video: number; social: number; discovered: number; approved: number };
  made: { articles: number; scripts: number; posts: number };
  out: { articles: number; posts: number };
};

export async function topicLedgers(workspaceId: string): Promise<TopicLedger[]> {
  const topics = await db.topic.findMany({
    where: { workspaceId },
    orderBy: [{ status: "asc" }, { priority: "desc" }, { name: "asc" }],
  });
  if (topics.length === 0) return [];

  const [aIdeas, vIdeas, sIdeas, articles, scripts, posts] = await Promise.all([
    db.blogIdea.groupBy({ by: ["topicId", "status"], where: { workspaceId, topicId: { not: null } }, _count: { _all: true } }),
    db.idea.groupBy({ by: ["topicId", "status"], where: { channel: { workspaceId }, topicId: { not: null } }, _count: { _all: true } }),
    db.socialIdea.groupBy({ by: ["topicId", "status"], where: { workspaceId, topicId: { not: null } }, _count: { _all: true } }),
    db.blogPost.groupBy({ by: ["topicId", "status"], where: { workspaceId, topicId: { not: null } }, _count: { _all: true } }),
    // A script has no topic of its own; it inherits its idea's.
    db.script.groupBy({ by: ["ideaId"], where: { channel: { workspaceId }, ideaId: { not: null }, idea: { topicId: { not: null } } }, _count: { _all: true } }),
    db.socialPost.groupBy({ by: ["topicId", "status"], where: { workspaceId, topicId: { not: null } }, _count: { _all: true } }),
  ]);
  // Script → topic needs the idea's topic; one small lookup for the ideas involved.
  const scriptIdeaIds = scripts.map((s) => s.ideaId).filter((v): v is string => Boolean(v));
  const scriptIdeas = scriptIdeaIds.length
    ? await db.idea.findMany({ where: { id: { in: scriptIdeaIds } }, select: { id: true, topicId: true } })
    : [];
  const ideaTopic = new Map(scriptIdeas.map((i) => [i.id, i.topicId]));

  const blank = (): TopicLedger["ideas"] => ({ article: 0, video: 0, social: 0, discovered: 0, approved: 0 });
  const ledgers = new Map<string, TopicLedger>(
    topics.map((t) => [
      t.id,
      {
        id: t.id,
        name: t.name,
        description: t.description,
        phrases: readJson<string[]>(t.keywords, []),
        priority: t.priority,
        status: t.status,
        ideas: blank(),
        made: { articles: 0, scripts: 0, posts: 0 },
        out: { articles: 0, posts: 0 },
      },
    ]),
  );
  const at = (id: string | null) => (id ? ledgers.get(id) : undefined);

  for (const r of aIdeas) {
    const l = at(r.topicId); if (!l) continue;
    l.ideas.article += r._count._all;
    if (r.status === "discovered") l.ideas.discovered += r._count._all;
    if (r.status === "approved") l.ideas.approved += r._count._all;
  }
  for (const r of vIdeas) {
    const l = at(r.topicId); if (!l) continue;
    l.ideas.video += r._count._all;
    if (r.status === "new") l.ideas.discovered += r._count._all;
    if (r.status === "approved") l.ideas.approved += r._count._all;
  }
  for (const r of sIdeas) {
    const l = at(r.topicId); if (!l) continue;
    l.ideas.social += r._count._all;
    if (r.status === "discovered") l.ideas.discovered += r._count._all;
    if (r.status === "approved") l.ideas.approved += r._count._all;
  }
  for (const r of articles) {
    const l = at(r.topicId); if (!l) continue;
    l.made.articles += r._count._all;
    if (r.status === "published") l.out.articles += r._count._all;
  }
  for (const r of scripts) {
    const l = at(ideaTopic.get(r.ideaId ?? "") ?? null); if (!l) continue;
    l.made.scripts += r._count._all;
  }
  for (const r of posts) {
    const l = at(r.topicId); if (!l) continue;
    l.made.posts += r._count._all;
    if (r.status === "posted" || r.status === "partial") l.out.posts += r._count._all;
  }
  return [...ledgers.values()];
}

/** Ideas with no Topic at all, across the three formats — the "No topic yet" lane's size. */
export async function untaggedIdeaCount(workspaceId: string): Promise<number> {
  const [a, v, s] = await Promise.all([
    db.blogIdea.count({ where: { workspaceId, topicId: null } }),
    db.idea.count({ where: { channel: { workspaceId }, topicId: null } }),
    db.socialIdea.count({ where: { workspaceId, topicId: null } }),
  ]);
  return a + v + s;
}

/** Resolve a topic id the caller received from a form to one this workspace owns, or null. */
export async function ownTopicId(workspaceId: string, raw: unknown): Promise<string | null> {
  const id = typeof raw === "string" ? raw.trim() : "";
  if (!id) return null;
  const t = await db.topic.findFirst({ where: { id, workspaceId }, select: { id: true } });
  return t?.id ?? null;
}
