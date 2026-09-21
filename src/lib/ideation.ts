import { db } from "@/lib/db";
import type { IdeaFormat } from "@/lib/ideas-board";

/**
 * Ideation per Topic, per format ("Topics as the spine", 2026-09-21).
 *
 * Before this, discovery ran workspace-wide: "top up when fewer than three
 * ideas are open" — so one busy Topic starved the rest, and an unfocused run
 * stamped no Topic at all (0 of 14 discovered ideas carried one on either
 * tenant). Now the unit of work is a CELL — one Topic × one format — and the
 * engine fills the emptiest cells first. Every idea a cell produces carries
 * its Topic, which is the invariant the board, the badge and Measure rely on.
 *
 * Bounded on purpose: `maxCells` per call, because each cell is one paid
 * generation and a workspace with eight Topics and three formats could
 * otherwise spend the whole daily budget in one sweep. The sweep rotates —
 * the emptiest cells are different next time, because this time filled them.
 *
 * Formats actually generated here: article (blog-autopilot.discoverIdeasCore)
 * and social (social/ideation.discoverSocialIdeasCore). Video ideas stay a
 * background job per channel (onboarding.ideas) and are tagged by keyword
 * match at birth (lib/topic-match.ts), not planned here.
 */

export type IdeationCell = { topicId: string; topicName: string; format: IdeaFormat; open: number };

/** Every Topic × format with its open (discovered + approved) count, emptiest first. */
export async function ideationCells(workspaceId: string, formats: IdeaFormat[]): Promise<IdeationCell[]> {
  const topics = await db.topic.findMany({
    where: { workspaceId, status: "active" },
    orderBy: [{ priority: "desc" }, { name: "asc" }],
    select: { id: true, name: true, priority: true },
  });
  if (topics.length === 0) return [];
  const [a, s] = await Promise.all([
    formats.includes("article")
      ? db.blogIdea.groupBy({ by: ["topicId"], where: { workspaceId, status: { in: ["discovered", "approved"] }, topicId: { not: null } }, _count: { _all: true } })
      : Promise.resolve([]),
    formats.includes("social")
      ? db.socialIdea.groupBy({ by: ["topicId"], where: { workspaceId, status: { in: ["discovered", "approved"] }, topicId: { not: null } }, _count: { _all: true } })
      : Promise.resolve([]),
  ]);
  const openA = new Map(a.map((r) => [r.topicId, r._count._all]));
  const openS = new Map(s.map((r) => [r.topicId, r._count._all]));
  const cells: IdeationCell[] = [];
  for (const t of topics) {
    if (formats.includes("article")) cells.push({ topicId: t.id, topicName: t.name, format: "article", open: openA.get(t.id) ?? 0 });
    if (formats.includes("social")) cells.push({ topicId: t.id, topicName: t.name, format: "social", open: openS.get(t.id) ?? 0 });
  }
  // Emptiest first; ties keep the priority order the query gave.
  return cells.sort((x, y) => x.open - y.open);
}

export type IdeationRun = { created: number; cells: Array<IdeationCell & { created: number }>; untargeted: boolean };

/**
 * Fill the emptiest cells. `floor` is the open count a cell must be BELOW to
 * be worth filling (the sweep's "low" — per Topic, per format); pass
 * Infinity to fill regardless (a person pressing the button). With no active
 * Topics at all, falls back to one untargeted run, as before, and says so.
 */
export async function runIdeation(
  workspaceId: string,
  opts: { formats: IdeaFormat[]; maxCells?: number; floor?: number; perCell?: number; topicId?: string | null },
): Promise<IdeationRun> {
  const maxCells = opts.maxCells ?? 4;
  const floor = opts.floor ?? Infinity;
  const { discoverIdeasCore } = await import("@/lib/blog-autopilot");
  const { discoverSocialIdeasCore } = await import("@/lib/social/ideation");

  let cells = await ideationCells(workspaceId, opts.formats);
  if (opts.topicId) cells = cells.filter((c) => c.topicId === opts.topicId);
  const run: IdeationRun = { created: 0, cells: [], untargeted: false };

  if (cells.length === 0) {
    // No Topics: the old workspace-wide run, untagged. The board's empty
    // state names the fix (add a Topic).
    run.untargeted = true;
    if (opts.formats.includes("article")) run.created += await discoverIdeasCore(workspaceId, null, opts.perCell ?? 6);
    return run;
  }

  for (const cell of cells.filter((c) => c.open < floor).slice(0, maxCells)) {
    const created =
      cell.format === "article"
        ? await discoverIdeasCore(workspaceId, cell.topicId, opts.perCell ?? 4)
        : cell.format === "social"
          ? await discoverSocialIdeasCore(workspaceId, cell.topicId, opts.perCell ?? 4)
          : 0;
    run.cells.push({ ...cell, created });
    run.created += created;
  }
  return run;
}
