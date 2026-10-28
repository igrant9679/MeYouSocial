import { db } from "@/lib/db";

// Facts the reports state, counted rather than asserted (audit MEA-02, MEA-03).
// Both used to be fixed strings: "100% of published posts passed WCAG + SEO
// gates" (false whenever "Advance anyway" was used, and for anything published
// before the gates), and "Search Console not connected" (on workspaces where it
// was connected and syncing).

export type ComplianceFacts = { published: number; overridden: number; citationsTotal: number; citationsVerified: number };

export async function complianceFacts(workspaceId: string): Promise<ComplianceFacts> {
  const [published, citationsTotal, citationsVerified] = await Promise.all([
    db.blogPost.findMany({ where: { workspaceId, status: "published" }, select: { id: true } }),
    db.blogCitation.count({ where: { post: { workspaceId } } }),
    db.blogCitation.count({ where: { verified: true, post: { workspaceId } } }),
  ]);
  // An override is cleared from the post when its text changes, so the audit
  // row is the record that one was used.
  const overridden = published.length
    ? (await db.auditLog.findMany({
        where: { workspaceId, action: "blog.gate_overridden", entityId: { in: published.map((p) => p.id) } },
        select: { entityId: true },
        distinct: ["entityId"],
      })).length
    : 0;
  return { published: published.length, overridden, citationsTotal, citationsVerified };
}

/** One sentence: how many published posts went out under an admin override. */
export function overrideSentence(f: ComplianceFacts): string {
  if (!f.published) return "Nothing published yet.";
  if (!f.overridden) return `None of the ${f.published} published post${f.published === 1 ? "" : "s"} went out under an admin override of the required checks.`;
  return `${f.overridden} of ${f.published} published post${f.published === 1 ? "" : "s"} went out under an admin override of the required checks (“Advance anyway”); the other ${f.published - f.overridden} without one.`;
}

/** Search Console as a report should state it: from the config and the last sync. */
export async function searchConsoleLine(workspaceId: string): Promise<string> {
  const [{ getGscConfig }, { readSyncStatus }] = await Promise.all([import("@/lib/analytics/gsc"), import("@/lib/analytics/sync")]);
  const [cfg, status] = await Promise.all([getGscConfig(workspaceId).catch(() => null), readSyncStatus(workspaceId).catch(() => ({}) as Record<string, never>)]);
  if (!cfg) return "Search Console not connected";
  const gsc = (status as { gsc?: { ok: boolean; at: string; lastOkAt: string | null } }).gsc;
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  if (!gsc) return "Search Console connected — not synced yet";
  if (gsc.ok) return `Search Console connected — last synced ${day(gsc.at)}`;
  return `Search Console connected — the last sync (${day(gsc.at)}) failed${gsc.lastOkAt ? `; last good ${day(gsc.lastOkAt)}` : ""}`;
}

/** A sum that stays null when nothing in it was measured (MEA-04: unmeasured shown as 0). */
export function sumMeasured(values: Array<number | null | undefined>): number | null {
  let seen = false;
  let total = 0;
  for (const v of values) {
    if (v == null) continue;
    seen = true;
    total += v;
  }
  return seen ? total : null;
}
