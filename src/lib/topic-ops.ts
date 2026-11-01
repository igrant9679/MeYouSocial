import { db } from "@/lib/db";
import { readJson, writeJson } from "@/lib/db/json";

/**
 * Merging one Topic into another (E-IDE-06): everything tagged with `fromId`
 * — articles, ideas in every format, renders, production projects, social
 * posts and RSS feeds — is re-tagged `intoId`, the related phrases are
 * unioned, the higher priority is kept, and `fromId` is deleted. One
 * transaction, so a failure part-way re-tags nothing. Both must be the
 * workspace's own Topics (the caller checks).
 */
export async function mergeTopics(fromId: string, intoId: string): Promise<{ retagged: number }> {
  const [from, into] = await Promise.all([
    db.topic.findUniqueOrThrow({ where: { id: fromId } }),
    db.topic.findUniqueOrThrow({ where: { id: intoId } }),
  ]);
  const phrases = [...new Set([...readJson<string[]>(into.keywords, []), from.name, ...readJson<string[]>(from.keywords, [])])]
    .filter((p) => p.trim() && p.trim().toLowerCase() !== into.name.trim().toLowerCase())
    .slice(0, 30);
  const move = { where: { topicId: fromId }, data: { topicId: intoId } };
  const counts = await db.$transaction([
    db.blogPost.updateMany(move),
    db.blogIdea.updateMany(move),
    db.socialIdea.updateMany(move),
    db.idea.updateMany(move),
    db.videoRender.updateMany(move),
    db.contentProject.updateMany(move),
    db.socialPost.updateMany(move),
    db.rssFeed.updateMany(move),
    db.topic.update({ where: { id: intoId }, data: { keywords: writeJson(phrases), priority: Math.max(into.priority, from.priority) } }),
    db.topic.delete({ where: { id: fromId } }),
  ]);
  const retagged = counts.slice(0, 8).reduce((n, c) => n + ("count" in c ? c.count : 0), 0);
  return { retagged };
}
