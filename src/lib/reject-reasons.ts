import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";

/**
 * Why an idea was rejected (E-IDE-18): one click after rejecting, kept on the
 * idea, and fed back into discovery so the same KIND of idea isn't proposed
 * again — "the team rejected these" with the reason beside each title.
 */
export const REJECT_REASONS = {
  off_brand: "Off-brand",
  duplicate: "Already covered",
  too_broad: "Too broad",
  wrong_audience: "Wrong audience",
} as const;
export type RejectReason = keyof typeof REJECT_REASONS;
export const isRejectReason = (v: unknown): v is RejectReason => typeof v === "string" && Object.prototype.hasOwnProperty.call(REJECT_REASONS, v);

/** The discovery prompt's line about rejected ideas, newest first — or null when there are none. */
export function rejectedLine(rows: Array<{ title: string; rejectReason: string | null }>): string | null {
  if (!rows.length) return null;
  const items = rows.map((r) => `${r.title}${isRejectReason(r.rejectReason) ? ` [${REJECT_REASONS[r.rejectReason].toLowerCase()}]` : ""}`);
  return `The team rejected these — propose nothing like them (a reason in brackets says what to steer away from): ${items.join(" | ")}`;
}

export type JustRejected = { format: "article" | "social"; id: string; title: string; from: "discovered" | "approved"; reason: RejectReason | null };

/**
 * What THIS person rejected in the last two minutes and is still rejected —
 * the board's "just rejected" bar with Undo and the reasons. Read from the
 * audit rows every reject path writes (a card, a key press, the bulk bar),
 * so none of them needs to redirect to offer it.
 */
export async function justRejected(workspaceId: string, actorId: string): Promise<JustRejected[]> {
  const rows = await db.auditLog.findMany({
    where: { workspaceId, actorId, action: { in: ["ideas.rejected", "social.idea_rejected"] }, createdAt: { gte: new Date(Date.now() - 2 * 60_000) } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { action: true, entityId: true, meta: true },
  });
  const seen = new Map<string, { format: "article" | "social"; id: string; from: "discovered" | "approved" }>();
  for (const r of rows) {
    if (!r.entityId) continue;
    const format = r.action.startsWith("social.") ? "social" : "article";
    const key = `${format}:${r.entityId}`;
    if (seen.has(key)) continue;
    const from = readJson<{ from?: string }>(r.meta, {}).from === "approved" ? "approved" : "discovered";
    seen.set(key, { format, id: r.entityId, from });
  }
  const want = [...seen.values()];
  const articleIds = want.filter((w) => w.format === "article").map((w) => w.id);
  const socialIds = want.filter((w) => w.format === "social").map((w) => w.id);
  const [articles, socials] = await Promise.all([
    articleIds.length ? db.blogIdea.findMany({ where: { id: { in: articleIds }, workspaceId, status: "rejected" }, select: { id: true, title: true, rejectReason: true } }) : Promise.resolve([]),
    socialIds.length ? db.socialIdea.findMany({ where: { id: { in: socialIds }, workspaceId, status: "rejected" }, select: { id: true, hook: true, rejectReason: true } }) : Promise.resolve([]),
  ]);
  const a = new Map(articles.map((x) => [x.id, { title: x.title, reason: x.rejectReason }]));
  const s = new Map(socials.map((x) => [x.id, { title: x.hook, reason: x.rejectReason }]));
  return want.flatMap((w) => {
    const row = (w.format === "article" ? a : s).get(w.id);
    return row ? [{ ...w, title: row.title, reason: isRejectReason(row.reason) ? row.reason : null }] : [];
  });
}
