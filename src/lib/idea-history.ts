import { db } from "@/lib/db";

/**
 * An idea's history (E-IDE-16), from the audit rows its actions already write:
 * approvals, rejections, "not yet", restores, merges, where it was made from.
 * Read-only and oldest first; a person's name where a person acted, "the
 * engine" where nobody did.
 */

export type HistoryRow = { at: Date; label: string; who: string };

const LABELS: Record<string, string> = {
  "ideas.approved": "Approved",
  "ideas.rejected": "Rejected",
  "ideas.restored": "Restored",
  "ideas.snoozed": "Back to Discovered (not yet)",
  "ideas.decay_refresh": "Made from Measure → Losing clicks",
  "blog.finding_added_to_ideas": "Made from an article's finding",
  "social.idea_approved": "Approved",
  "social.idea_rejected": "Rejected",
  "social.idea_restored": "Restored",
  "social.idea_snoozed": "Back to Discovered (not yet)",
};

export async function ideaHistory(workspaceId: string, entityType: "blog_idea" | "social_idea", id: string): Promise<HistoryRow[]> {
  const [own, merges] = await Promise.all([
    db.auditLog.findMany({ where: { workspaceId, entityType, entityId: id }, orderBy: { createdAt: "asc" }, take: 100, select: { action: true, actorId: true, createdAt: true, meta: true } }),
    // A merge is recorded on the idea kept; the one folded in finds it by its id in the meta.
    db.auditLog.findMany({ where: { workspaceId, action: "ideas.merged", meta: { contains: id } }, select: { action: true, actorId: true, createdAt: true, meta: true, entityId: true } }),
  ]);
  const actors = [...new Set([...own, ...merges].map((r) => r.actorId).filter((v): v is string => !!v))];
  const names = new Map((actors.length ? await db.user.findMany({ where: { id: { in: actors } }, select: { id: true, name: true, email: true } }) : []).map((u) => [u.id, u.name ?? u.email ?? "someone"]));
  const who = (actorId: string | null) => (actorId ? names.get(actorId) ?? "a former member" : "the engine");
  const rows: HistoryRow[] = [];
  for (const r of own) {
    if (r.action === "ideas.merged") { rows.push({ at: r.createdAt, label: "Another idea was merged into this one", who: who(r.actorId) }); continue; }
    const label = LABELS[r.action];
    if (label) rows.push({ at: r.createdAt, label, who: who(r.actorId) });
  }
  for (const r of merges) {
    if (r.entityId === id) continue;
    let from: string | null = null;
    try { from = (JSON.parse(r.meta) as { mergedFrom?: string }).mergedFrom ?? null; } catch { /* ignore */ }
    if (from === id) rows.push({ at: r.createdAt, label: "Merged into another idea", who: who(r.actorId) });
  }
  return rows.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Where an idea came from, in words. */
export const SOURCE_LABEL: Record<string, string> = {
  manual: "added by a person",
  ai: "found by discovery",
  discovered: "found by discovery",
  refresh: "a refresh of a live article",
  seasonal: "a seasonal suggestion",
  research: "made from research",
  article: "an angle from a published article",
  rss: "from a feed",
  import: "imported from a spreadsheet",
  finding: "made from an article's finding",
};
