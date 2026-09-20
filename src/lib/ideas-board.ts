import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ensureMotifDirectives } from "@/lib/motifs";

/**
 * The one Ideas board (One-Loop step 4, the owner's decision "merge the
 * boards"). Article ideas (BlogIdea, workspace-scoped, drafted by the
 * autopilot) and video ideas (Idea, channel-scoped, written by a person on
 * the script canvas) stay two tables — a script's foreign key, the intel
 * source-video link, the onboarding and growth jobs, the public API and the
 * delete registry all point at the video table, and the autopilot, scoring,
 * assistant, metrics and reports at the article one; re-pointing all of that
 * would put the live tenants' drafting at risk for nothing a person can see.
 * What a person sees is ONE board with ONE vocabulary, and that is this file.
 */

export type BoardState = "discovered" | "approved" | "drafted" | "rejected";

// `empty` is the column's own sentence when it has nothing in it. Four columns
// all reading "Empty" said nothing about which of them mattered (audit B6);
// there is deliberately no button here — the board has ONE primary action, not
// four competing ones.
export const STATES: { state: BoardState; title: string; hue: string; blurb: string; empty: string }[] = [
  { state: "discovered", title: "Discovered", hue: "amber", blurb: "waiting for a yes or no", empty: "Nothing waiting on a yes or no." },
  { state: "approved", title: "Approved", hue: "blue", blurb: "next to be written", empty: "Nothing approved yet — say yes to one on the left and the engine writes it." },
  { state: "drafted", title: "Drafted", hue: "green", blurb: "an article or script exists", empty: "Approved ideas land here once they have been written." },
  { state: "rejected", title: "Rejected", hue: "rose", blurb: "won't come back", empty: "Nothing rejected." },
];

/** Video-idea statuses (the table's own vocabulary) → the board's four states. */
export const VIDEO_STATE: Record<string, BoardState> = {
  new: "discovered",
  approved: "approved", // added in step 4 so a video idea can be chosen before anyone writes
  in_progress: "drafted",
  scripted: "drafted",
  archived: "rejected",
};
export const ARTICLE_STATE: Record<string, BoardState> = {
  discovered: "discovered",
  approved: "approved",
  drafted: "drafted",
  rejected: "rejected",
  merged: "rejected",
};

export type ArticleRow = Prisma.BlogIdeaGetPayload<{ include: { topic: { select: { name: true } } } }>;
export type VideoRow = Prisma.IdeaGetPayload<{
  include: {
    workspaceTopic: { select: { name: true } };
    channel: { select: { id: true; name: true } };
    scripts: { select: { id: true; workflow: true }; orderBy: { createdAt: "desc" }; take: 1 };
  };
}>;

export type BoardCard =
  | { format: "article"; state: BoardState; rank: number; createdAt: Date; row: ArticleRow }
  | { format: "video"; state: BoardState; rank: number; createdAt: Date; row: VideoRow };

export type BoardFilter = { format?: string; channel?: string };

export async function loadIdeasBoard(workspaceId: string, f: BoardFilter) {
  const wantArticles = !f.channel && (!f.format || f.format === "article");
  const wantVideo = !f.format || f.format === "video";

  const [articles, videos, channels, topics, pages, directives, aCounts, vCounts] = await Promise.all([
    wantArticles
      ? db.blogIdea.findMany({
          where: { workspaceId },
          orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
          take: 200,
          include: { topic: { select: { name: true } } },
        })
      : Promise.resolve([] as ArticleRow[]),
    wantVideo
      ? db.idea.findMany({
          where: { channel: { workspaceId, ...(f.channel ? { id: f.channel } : {}) } },
          orderBy: [{ outlierScore: "desc" }, { createdAt: "desc" }],
          take: 200,
          include: {
            workspaceTopic: { select: { name: true } },
            channel: { select: { id: true, name: true } },
            scripts: { select: { id: true, workflow: true }, orderBy: { createdAt: "desc" }, take: 1 },
          },
        })
      : Promise.resolve([] as VideoRow[]),
    db.channel.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
    db.topic.findMany({ where: { workspaceId, status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.sitePage.findMany({ where: { workspaceId }, select: { url: true, title: true }, take: 60 }),
    ensureMotifDirectives(workspaceId),
    db.blogIdea.groupBy({ by: ["status"], where: { workspaceId }, _count: { _all: true } }),
    db.idea.groupBy({ by: ["status"], where: { channel: { workspaceId } }, _count: { _all: true } }),
  ]);

  // Within a column, articles rank by their explained priority and videos by
  // their measured outlier — not comparable numbers, so this is a DISPLAY
  // heuristic only (a 5× outlier sits near a priority of 50); nothing shows it.
  const cards: BoardCard[] = [
    ...articles.map((r) => ({
      format: "article" as const,
      state: ARTICLE_STATE[r.status] ?? "discovered",
      rank: r.priority ?? -1,
      createdAt: r.createdAt,
      row: r,
    })),
    ...videos.map((r) => ({
      format: "video" as const,
      state: VIDEO_STATE[r.status] ?? "discovered",
      rank: (r.outlierScore ?? 0) * 10,
      createdAt: r.createdAt,
      row: r,
    })),
  ].sort((a, b) => b.rank - a.rank || b.createdAt.getTime() - a.createdAt.getTime());

  // Header counts ignore the filter — they describe the whole board.
  const counts: Record<BoardState, number> = { discovered: 0, approved: 0, drafted: 0, rejected: 0 };
  let articlesTotal = 0;
  let videosTotal = 0;
  for (const c of aCounts) { counts[ARTICLE_STATE[c.status] ?? "discovered"] += c._count._all; articlesTotal += c._count._all; }
  for (const c of vCounts) { counts[VIDEO_STATE[c.status] ?? "discovered"] += c._count._all; videosTotal += c._count._all; }

  return { cards, counts, channels, topics, pages, directives, articlesTotal, videosTotal };
}
