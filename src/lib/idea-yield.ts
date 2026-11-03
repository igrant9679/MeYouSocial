import { db } from "@/lib/db";
import type { IdeaFormat } from "@/lib/ideas-board";

/**
 * How ideas fare, by where they came from and which Topic they're about
 * (E-IDE-19) — and the one place discovery learns from it.
 *
 * For every (format, Topic, source) over the last YIELD_WINDOW_DAYS of ideas:
 * how many there were, how many a person decided, how many of those were a
 * yes, and how many of the yeses reached the audience (an article published,
 * a post sent). Shown on Ideas → Topics; and `cellTuning` turns the engine's
 * own rate per Topic into how many ideas that Topic's next run asks for —
 * a lane whose ideas are mostly rejected gets fewer, one whose ideas are
 * mostly approved gets more.
 *
 * ⚠ Bounded and evidence-gated on purpose: under MIN_DECIDED decisions a cell
 * gets the base count (a run of two rejections is not a verdict), the rate is
 * smoothed toward the workspace's own, and the factor stays within
 * TUNE_MIN..TUNE_MAX — so tuning can halve a lane, never starve it, and
 * never more than one-and-a-half times a busy one. A merged idea is neither
 * yes nor no: merging says it was a duplicate, not whether it was good.
 */

export const YIELD_WINDOW_DAYS = 90;
export const MIN_DECIDED = 5;
export const TUNE_MIN = 0.5;
export const TUNE_MAX = 1.5;

/** The source each format's engine stamps on what it discovers. */
export const ENGINE_SOURCE: Partial<Record<IdeaFormat, string>> = { article: "ai", social: "discovered" };

export type YieldRow = {
  format: "article" | "social";
  topicId: string | null;
  source: string;
  ideas: number;
  approved: number;
  rejected: number;
  /** Of the approved, how many went out: articles published, posts sent. */
  published: number;
};

export type Yield = {
  ideas: number;
  decided: number;
  approved: number;
  rejected: number;
  published: number;
  /** approved / decided — null with nothing decided. */
  approvalRate: number | null;
  /** published / approved — null with nothing approved. */
  publishRate: number | null;
};

/** Sum rows into one yield, with its rates. */
export function summarize(rows: YieldRow[]): Yield {
  const s = rows.reduce(
    (a, r) => ({ ideas: a.ideas + r.ideas, approved: a.approved + r.approved, rejected: a.rejected + r.rejected, published: a.published + r.published }),
    { ideas: 0, approved: 0, rejected: 0, published: 0 },
  );
  const decided = s.approved + s.rejected;
  return { ...s, decided, approvalRate: decided ? s.approved / decided : null, publishRate: s.approved ? s.published / s.approved : null };
}

export type CellTuning = {
  /** How many ideas this cell's run asks for. */
  count: number;
  factor: number;
  /** The engine's ideas in this Topic and format. */
  cell: Yield;
  /** The engine's ideas in this format across the workspace — what the cell is compared to. */
  baseline: Yield;
  /** Plain words, no leading capital: why the count is what it is. */
  reason: string;
};

const pct = (r: number) => `${Math.round(r * 100)}%`;

/**
 * How many ideas one Topic × format should ask for, from the engine's own
 * approval rate there against the workspace's for that format. Pure.
 */
export function cellTuning(rows: YieldRow[], topicId: string, format: IdeaFormat, base: number): CellTuning {
  const source = ENGINE_SOURCE[format];
  const ofFormat = rows.filter((r) => r.format === format && r.source === source);
  const baseline = summarize(ofFormat);
  const cell = summarize(ofFormat.filter((r) => r.topicId === topicId));
  const keep = (reason: string): CellTuning => ({ count: base, factor: 1, cell, baseline, reason });
  if (!source) return keep("not tuned for this format");
  if (cell.decided < MIN_DECIDED) return keep(`${cell.decided === 0 ? "none" : `only ${cell.decided}`} of its discovered ideas decided yet — ${MIN_DECIDED} are needed before its rate counts`);
  if (!baseline.approvalRate) return keep("nothing discovered has been approved yet anywhere, so there's no rate to compare with");
  // Smoothed toward the workspace's own rate, as if MIN_DECIDED more ideas had
  // been decided at it — a small lane can't swing far on a few decisions.
  const smoothed = (cell.approved + baseline.approvalRate * MIN_DECIDED) / (cell.decided + MIN_DECIDED);
  const factor = Math.min(TUNE_MAX, Math.max(TUNE_MIN, smoothed / baseline.approvalRate));
  const count = Math.max(1, Math.round(base * factor));
  const rates = `${pct(cell.approvalRate!)} of its discovered ideas were approved, against ${pct(baseline.approvalRate)} across the workspace`;
  return { count, factor, cell, baseline, reason: count === base ? `${rates} — close enough to keep the usual count` : rates };
}

/** Every (format, Topic, source) yield over the window. Article and social ideas; video ideas are per channel. */
export async function ideaYield(workspaceId: string, now = new Date()): Promise<YieldRow[]> {
  const since = new Date(now.getTime() - YIELD_WINDOW_DAYS * 86_400_000);
  const where = { workspaceId, createdAt: { gte: since } };
  const [aStatus, sStatus, aMade, sMade] = await Promise.all([
    db.blogIdea.groupBy({ by: ["topicId", "source", "status"], where, _count: { _all: true } }),
    db.socialIdea.groupBy({ by: ["topicId", "source", "status"], where, _count: { _all: true } }),
    db.blogIdea.findMany({ where: { ...where, postId: { not: null } }, select: { topicId: true, source: true, postId: true }, take: 5000 }),
    db.socialIdea.findMany({ where: { ...where, socialPostId: { not: null } }, select: { topicId: true, source: true, socialPostId: true }, take: 5000 }),
  ]);
  const [posts, sent] = await Promise.all([
    aMade.length
      ? db.blogPost.findMany({ where: { workspaceId, id: { in: aMade.map((i) => i.postId!) }, status: "published" }, select: { id: true } })
      : Promise.resolve([]),
    sMade.length
      ? db.socialPost.findMany({ where: { workspaceId, id: { in: sMade.map((i) => i.socialPostId!) }, status: { in: ["posted", "partial"] } }, select: { id: true } })
      : Promise.resolve([]),
  ]);
  const out = new Map<string, YieldRow>();
  const at = (format: YieldRow["format"], topicId: string | null, source: string) => {
    const k = `${format}|${topicId ?? ""}|${source}`;
    let r = out.get(k);
    if (!r) { r = { format, topicId, source, ideas: 0, approved: 0, rejected: 0, published: 0 }; out.set(k, r); }
    return r;
  };
  for (const [format, rows] of [["article", aStatus], ["social", sStatus]] as const) {
    for (const g of rows) {
      const r = at(format, g.topicId, g.source);
      const n = g._count._all;
      r.ideas += n;
      if (g.status === "rejected") r.rejected += n;
      else if (g.status === "approved" || g.status === "drafted") r.approved += n;
    }
  }
  const live = new Set(posts.map((p) => p.id));
  for (const i of aMade) if (live.has(i.postId!)) at("article", i.topicId, i.source).published += 1;
  const gone = new Set(sent.map((p) => p.id));
  for (const i of sMade) if (gone.has(i.socialPostId!)) at("social", i.topicId, i.source).published += 1;
  return [...out.values()];
}
