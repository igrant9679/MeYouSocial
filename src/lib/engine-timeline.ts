import { db } from "@/lib/db";
import type { CycleReport } from "@/lib/blog-autopilot";

/**
 * A week of engine cycles (E-ENG-04). Every cycle that runs writes a row —
 * idle and paused ones too — so Automation can show what the engine did, fold
 * the quiet stretches, and show where it didn't check in at all (a gap is a
 * dead sweep, not a quiet hour). Rows older than 7 days go when the next
 * cycle writes.
 */

export const KEEP_DAYS = 7;

// The counts worth naming, in the order a person reads them.
const COUNTS: Array<[keyof CycleReport, string, string]> = [
  ["ideasCreated", "idea found", "ideas found"],
  ["drafted", "article drafted", "articles drafted"],
  ["seoOptimized", "SEO pass", "SEO passes"],
  ["imagesGenerated", "image made", "images made"],
  ["imagesAutoApproved", "image approved", "images approved"],
  ["citationsAutoVerified", "citation verified", "citations verified"],
  ["findingsAutoApplied", "finding applied", "findings applied"],
  ["autoAdvanced", "draft advanced", "drafts advanced"],
  ["published", "article published", "articles published"],
  ["postsGenerated", "social post written", "social posts written"],
  ["variantPosts", "post from an article", "posts from articles"],
  ["autoQueued", "post queued", "posts queued"],
  ["videosPackaged", "video packaged", "videos packaged"],
  ["videosRendered", "video rendered", "videos rendered"],
];

export function activityOf(r: CycleReport): number {
  return r.ideasCreated + r.drafted + r.variantPosts + r.postsGenerated + r.imagesGenerated + r.seoOptimized
    + r.autoAdvanced + r.autoQueued + r.published + r.videosPackaged + r.videosRendered;
}

export async function recordCycle(workspaceId: string, r: CycleReport): Promise<void> {
  const activity = activityOf(r);
  const failed = r.failedSteps?.length ?? 0;
  const report = activity || failed || r.imagesAutoApproved || r.citationsAutoVerified || r.findingsAutoApplied
    ? JSON.stringify(Object.fromEntries([...COUNTS.map(([k]) => [k, r[k]]).filter(([, v]) => v), ["failedSteps", r.failedSteps ?? []]]))
    : null;
  await db.engineCycle.create({ data: { workspaceId, skipped: r.skipped === "paused" ? "paused" : null, budgetReached: !!r.budgetReached, activity, failed, report } });
  await db.engineCycle.deleteMany({ where: { workspaceId, at: { lt: new Date(Date.now() - KEEP_DAYS * 86_400_000) } } });
}

export type CycleRow = { at: Date; skipped: string | null; budgetReached: boolean; activity: number; failed: number; report: string | null };
export type TimelineItem =
  | { kind: "cycle"; at: Date; did: string[]; failures: Array<{ step: string; message: string }>; budgetReached: boolean }
  | { kind: "quiet" | "paused" | "budget"; from: Date; to: Date; count: number }
  | { kind: "gap"; from: Date; to: Date };

/** What one cycle's report says it did, in words: "2 articles drafted", … */
export function describeCounts(report: Record<string, unknown>): string[] {
  return COUNTS.flatMap(([k, one, many]) => {
    const n = Number(report[k] ?? 0);
    return n > 0 ? [`${n} ${n === 1 ? one : many}`] : [];
  });
}

/**
 * Newest-first rows → newest-first items. Consecutive quiet, paused or
 * allowance-spent cycles fold into one item; any cycle that did something or
 * failed stands alone; a silence longer than twice the sweep interval between
 * two cycles is a gap.
 */
export function timeline(rows: CycleRow[], intervalMin: number): TimelineItem[] {
  const items: TimelineItem[] = [];
  const gapMs = 2 * intervalMin * 60_000;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const newer = rows[i - 1];
    if (newer && newer.at.getTime() - r.at.getTime() > gapMs) items.push({ kind: "gap", from: r.at, to: newer.at });
    let report: Record<string, unknown> = {};
    try { report = r.report ? JSON.parse(r.report) : {}; } catch { /* unreadable — counts as quiet */ }
    const did = describeCounts(report);
    const failures = Array.isArray(report.failedSteps) ? (report.failedSteps as Array<{ step: string; message: string }>) : [];
    if (did.length || failures.length) {
      items.push({ kind: "cycle", at: r.at, did, failures, budgetReached: r.budgetReached });
      continue;
    }
    const kind = r.skipped === "paused" ? "paused" : r.budgetReached ? "budget" : "quiet";
    const last = items[items.length - 1];
    // Rows are newest first, so a fold grows backwards in time.
    if (last && (last.kind === "quiet" || last.kind === "paused" || last.kind === "budget") && last.kind === kind) { last.from = r.at; last.count++; }
    else items.push({ kind, from: r.at, to: r.at, count: 1 });
  }
  return items;
}
