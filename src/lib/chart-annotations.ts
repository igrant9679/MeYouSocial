import { db } from "@/lib/db";
import { FUNCTION_LABELS } from "@/lib/governance";
import { placeEvents, type ChartBucket, type ChartEvent, type PlacedMark } from "@/lib/chart-marks";

/**
 * Chart annotations (E-MEA-04), the reader: what happened in a window that a
 * chart of search numbers should show — articles published, social posts
 * sent, the automation changes people made, and their own notes. Placement
 * and drawing are `lib/chart-marks.ts`.
 *
 * Everything comes from rows that already record it (publishedAt, the audit
 * log) except notes, which are `ChartNote`. Workspace-wide: a note or a
 * switch flipped shows on every chart that spans it, an article's included.
 */

const TAKE = 200;

/** Audit actions that change what the engine is allowed to do. */
const AUTONOMY_ACTIONS = [
  "autonomy.enabled", "autonomy.disabled", "governance.mode_set",
  "governance.global_pause_on", "governance.global_pause_off", "governance.paused", "governance.resumed",
  "social.queue_paused", "social.queue_resumed",
] as const;

function autonomyText(action: string, metaRaw: string): string {
  let meta: { function?: string; mode?: string; via?: string } = {};
  try { meta = JSON.parse(metaRaw); } catch { /* keep empty */ }
  switch (action) {
    case "autonomy.enabled": return "Full autonomy turned on";
    case "autonomy.disabled": return "Full autonomy turned off";
    case "governance.mode_set": return `${FUNCTION_LABELS[meta.function as keyof typeof FUNCTION_LABELS] ?? meta.function ?? "A function"} set to ${meta.mode ?? "?"}`;
    case "governance.global_pause_on": case "governance.paused": return "Everything paused";
    case "governance.global_pause_off": case "governance.resumed": return "Automation resumed";
    case "social.queue_paused": return "Social queue paused";
    case "social.queue_resumed": return "Social queue resumed";
    default: return action;
  }
}

const quote = (s: string, n = 60) => `“${s.length > n ? `${s.slice(0, n - 1)}…` : s}”`;

export type AnnotationScope = {
  /** Only this article's publish (an article's own chart). */
  blogPostId?: string;
  /** Only these social posts' sends (an article's chart: the posts that pointed at it). */
  socialPostIds?: string[];
};

export async function chartEvents(workspaceId: string, from: Date, to: Date, scope: AnnotationScope = {}): Promise<ChartEvent[]> {
  const at = { gte: from, lt: to };
  const [published, sent, changes, notes] = await Promise.all([
    db.blogPost.findMany({
      where: { workspaceId, publishedAt: at, status: "published", ...(scope.blogPostId ? { id: scope.blogPostId } : {}) },
      orderBy: { publishedAt: "asc" }, take: TAKE, select: { id: true, title: true, publishedAt: true },
    }),
    scope.socialPostIds && !scope.socialPostIds.length
      ? Promise.resolve([])
      : db.socialPost.findMany({
          where: { workspaceId, status: { in: ["posted", "partial"] }, publishedAt: at, ...(scope.socialPostIds ? { id: { in: scope.socialPostIds } } : {}) },
          orderBy: { publishedAt: "asc" }, take: TAKE, select: { id: true, text: true, publishedAt: true },
        }),
    db.auditLog.findMany({
      where: { workspaceId, action: { in: [...AUTONOMY_ACTIONS] }, createdAt: at },
      orderBy: { createdAt: "asc" }, take: TAKE, select: { action: true, meta: true, actorId: true, createdAt: true },
    }),
    db.chartNote.findMany({ where: { workspaceId, at }, orderBy: { at: "asc" }, take: TAKE, select: { id: true, at: true, text: true, createdById: true } }),
  ]);

  const ids = [...new Set([...changes.map((c) => c.actorId), ...notes.map((n) => n.createdById)].filter((x): x is string => !!x))];
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const who = new Map(users.map((u) => [u.id, u.name ?? u.email ?? "a member"]));
  const person = (id: string | null) => (id ? who.get(id) ?? "a former member" : undefined);

  return [
    ...published.map((p): ChartEvent => ({ at: p.publishedAt!, kind: "publish", text: `Published ${quote(p.title)}`, href: `/blog/${p.id}` })),
    ...sent.map((p): ChartEvent => ({ at: p.publishedAt!, kind: "social", text: `Sent ${quote(p.text.replace(/\s+/g, " ").trim(), 48)}`, href: `/social/${p.id}` })),
    ...changes.map((c): ChartEvent => {
      let via: string | undefined;
      try { via = (JSON.parse(c.meta) as { via?: string }).via; } catch { /* none */ }
      return { at: c.createdAt, kind: "autonomy", text: autonomyText(c.action, c.meta), by: via === "assistant" ? `${person(c.actorId) ?? "someone"}, through the assistant` : person(c.actorId) };
    }),
    ...notes.map((n): ChartEvent => ({ at: n.at, kind: "note", text: n.text, by: person(n.createdById), noteId: n.id })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** The marks for a chart whose points have spans (Measure's weeks, an article's readings). */
export async function marksFor(workspaceId: string, buckets: ChartBucket[], scope: AnnotationScope = {}): Promise<PlacedMark[]> {
  if (!buckets.length) return [];
  const events = await chartEvents(workspaceId, buckets[0].from, buckets[buckets.length - 1].to, scope).catch(() => []);
  return placeEvents(events, buckets);
}

/** A note's text: one line, trimmed, at most this long. */
export const NOTE_MAX = 140;
