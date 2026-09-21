import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ensureMotifDirectives } from "@/lib/motifs";

/**
 * The one Ideas board (One-Loop step 4, the owner's decision "merge the
 * boards"), grouped by Topic since 2026-09-21 ("Topics as the spine").
 *
 * Three formats, three tables. Article ideas (BlogIdea, workspace-scoped,
 * drafted by the autopilot), video ideas (Idea, channel-scoped, written by a
 * person on the script canvas) and social ideas (SocialIdea, drafted into the
 * queue by the autopilot) stay separate — a script's foreign key, the intel
 * source-video link, the onboarding and growth jobs, the public API and the
 * delete registry all point at the video table, and the autopilot, scoring,
 * assistant, metrics and reports at the article one; re-pointing all of that
 * would put the live tenants' drafting at risk for nothing a person can see.
 * A third table beside two was smaller than merging two. What a person sees
 * is ONE board with ONE vocabulary, in lanes per Topic, and that is this file.
 *
 * ⚠ The "No topic yet" lane is `topicId: null` EXPLICITLY. Prisma's NOT/notIn
 * drops NULL rows (CLAUDE.md), so "ideas not in these topics" would silently
 * lose every untagged idea — which today is all 92 legacy ones.
 */

export type BoardState = "discovered" | "approved" | "drafted" | "rejected";
export type IdeaFormat = "article" | "video" | "social";

// `empty` is the column's own sentence when it has nothing in it. Four columns
// all reading "Empty" said nothing about which of them mattered (audit B6);
// there is deliberately no button here — the board has ONE primary action, not
// four competing ones.
export const STATES: { state: BoardState; title: string; hue: string; blurb: string; empty: string }[] = [
  { state: "discovered", title: "Discovered", hue: "amber", blurb: "waiting for a yes or no", empty: "Nothing waiting on a yes or no." },
  { state: "approved", title: "Approved", hue: "blue", blurb: "next to be made", empty: "Nothing approved yet — say yes to one on the left and the engine makes it." },
  { state: "drafted", title: "Drafted", hue: "green", blurb: "an article, script or post exists", empty: "Approved ideas land here once they have been made." },
  { state: "rejected", title: "Rejected", hue: "rose", blurb: "won't come back", empty: "Nothing rejected." },
];

/** The three columns a lane shows; Rejected folds under a disclosure. */
export const LANE_STATES = STATES.filter((s) => s.state !== "rejected");

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
export const SOCIAL_STATE: Record<string, BoardState> = {
  discovered: "discovered",
  approved: "approved",
  drafted: "drafted",
  rejected: "rejected",
};

export type ArticleRow = Prisma.BlogIdeaGetPayload<{ include: { topic: { select: { name: true } } } }>;
export type VideoRow = Prisma.IdeaGetPayload<{
  include: {
    workspaceTopic: { select: { name: true } };
    channel: { select: { id: true; name: true } };
    scripts: { select: { id: true; workflow: true }; orderBy: { createdAt: "desc" }; take: 1 };
  };
}>;
export type SocialRow = Prisma.SocialIdeaGetPayload<{
  include: {
    topic: { select: { name: true } };
    sourceBlogPost: { select: { id: true; title: true } };
    sourceVideo: { select: { id: true; title: true } };
    socialPost: { select: { id: true; status: true; scheduledAt: true } };
  };
}>;

export type BoardCard =
  | { format: "article"; state: BoardState; rank: number; createdAt: Date; row: ArticleRow }
  | { format: "video"; state: BoardState; rank: number; createdAt: Date; row: VideoRow }
  | { format: "social"; state: BoardState; rank: number; createdAt: Date; row: SocialRow };

export type BoardFilter = { format?: string; channel?: string };

export type LaneTopic = { id: string; name: string; priority: number; status: string; description: string | null };
/** One Topic's slice of the board. `topic: null` is the "No topic yet" lane. */
export type Lane = { topic: LaneTopic | null; cards: BoardCard[] };

export function cardTopicId(c: BoardCard): string | null {
  return c.row.topicId ?? null;
}
export function cardId(c: BoardCard): string {
  return c.row.id;
}
export function cardTitle(c: BoardCard): string {
  return c.format === "social" ? c.row.hook : c.row.title;
}

const FORMATS: IdeaFormat[] = ["article", "video", "social"];
export function isIdeaFormat(v: unknown): v is IdeaFormat {
  return typeof v === "string" && (FORMATS as string[]).includes(v);
}

export async function loadIdeasBoard(workspaceId: string, f: BoardFilter) {
  const wantArticles = !f.channel && (!f.format || f.format === "article");
  const wantVideo = !f.format || f.format === "video";
  const wantSocial = !f.channel && (!f.format || f.format === "social");

  const [articles, videos, socials, channels, topics, pages, directives, aCounts, vCounts, sCounts] = await Promise.all([
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
    wantSocial
      ? db.socialIdea.findMany({
          where: { workspaceId },
          orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
          take: 200,
          include: {
            topic: { select: { name: true } },
            sourceBlogPost: { select: { id: true, title: true } },
            sourceVideo: { select: { id: true, title: true } },
            socialPost: { select: { id: true, status: true, scheduledAt: true } },
          },
        })
      : Promise.resolve([] as SocialRow[]),
    db.channel.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
    // Every topic, archived included: an archived Topic that still has ideas
    // keeps its lane (marked), so nothing silently drops off the board.
    db.topic.findMany({
      where: { workspaceId },
      orderBy: [{ status: "asc" }, { priority: "desc" }, { name: "asc" }],
      select: { id: true, name: true, priority: true, status: true, description: true },
    }),
    db.sitePage.findMany({ where: { workspaceId }, select: { url: true, title: true }, take: 60 }),
    ensureMotifDirectives(workspaceId),
    db.blogIdea.groupBy({ by: ["status"], where: { workspaceId }, _count: { _all: true } }),
    db.idea.groupBy({ by: ["status"], where: { channel: { workspaceId } }, _count: { _all: true } }),
    db.socialIdea.groupBy({ by: ["status"], where: { workspaceId }, _count: { _all: true } }),
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
    ...socials.map((r) => ({
      format: "social" as const,
      state: SOCIAL_STATE[r.status] ?? "discovered",
      rank: r.priority ?? -1,
      createdAt: r.createdAt,
      row: r,
    })),
  ].sort((a, b) => b.rank - a.rank || b.createdAt.getTime() - a.createdAt.getTime());

  // Lanes: every active Topic (empty ones too — an empty lane is the honest
  // "nothing about this yet"), archived Topics only when they still hold
  // cards, then the untagged lane last, only when non-empty.
  const byTopic = new Map<string, BoardCard[]>();
  const untagged: BoardCard[] = [];
  for (const c of cards) {
    const t = cardTopicId(c);
    if (!t) { untagged.push(c); continue; }
    const list = byTopic.get(t) ?? [];
    list.push(c);
    byTopic.set(t, list);
  }
  const lanes: Lane[] = [];
  for (const t of topics) {
    const list = byTopic.get(t.id) ?? [];
    if (t.status !== "active" && list.length === 0) continue;
    lanes.push({ topic: t, cards: list });
    byTopic.delete(t.id);
  }
  // A card whose topic row is gone (cannot happen with SetNull, but a stale
  // include would rather show than vanish).
  for (const list of byTopic.values()) untagged.push(...list);
  if (untagged.length) lanes.push({ topic: null, cards: untagged });

  // Header counts ignore the filter — they describe the whole board.
  const counts: Record<BoardState, number> = { discovered: 0, approved: 0, drafted: 0, rejected: 0 };
  const totals: Record<IdeaFormat, number> = { article: 0, video: 0, social: 0 };
  for (const c of aCounts) { counts[ARTICLE_STATE[c.status] ?? "discovered"] += c._count._all; totals.article += c._count._all; }
  for (const c of vCounts) { counts[VIDEO_STATE[c.status] ?? "discovered"] += c._count._all; totals.video += c._count._all; }
  for (const c of sCounts) { counts[SOCIAL_STATE[c.status] ?? "discovered"] += c._count._all; totals.social += c._count._all; }

  const activeTopics = topics.filter((t) => t.status === "active");
  return {
    cards,
    lanes,
    counts,
    channels,
    topics: activeTopics,
    pages,
    directives,
    totals,
    untaggedTotal: untagged.length,
    // Kept for callers that still read the old names.
    articlesTotal: totals.article,
    videosTotal: totals.video,
  };
}
