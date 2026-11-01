import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * The Articles list (E-ART-08): filters by status, Topic, reviewer and a
 * title-or-keyword search, in pages. Everything lives in the URL so a filtered
 * view can be shared or bookmarked; anything unknown reads as "no filter".
 */

export const ARTICLE_STATUSES = ["drafting", "draft_review", "final_approval", "published"] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];
export const ARTICLES_PER_PAGE = 50;

export type ArticleQuery = {
  status: ArticleStatus | null;
  topic: string | null;
  /** A member's id, "none" for unassigned, or null for anyone. */
  reviewer: string | null;
  q: string;
  page: number;
};

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseArticleQuery(sp: Params): ArticleQuery {
  const status = one(sp.status);
  const page = Math.floor(Number(one(sp.page)));
  return {
    status: (ARTICLE_STATUSES as readonly string[]).includes(status) ? (status as ArticleStatus) : null,
    topic: one(sp.topic).trim() || null,
    reviewer: one(sp.reviewer).trim() || null,
    q: one(sp.q).trim().slice(0, 120),
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
}

/** The list's own URL for a query — always the list view, defaults left out. */
export function articlesHref(q: ArticleQuery, patch: Partial<ArticleQuery> = {}): string {
  const next = { ...q, ...patch };
  const sp = new URLSearchParams({ view: "list" });
  if (next.status) sp.set("status", next.status);
  if (next.topic) sp.set("topic", next.topic);
  if (next.reviewer) sp.set("reviewer", next.reviewer);
  if (next.q) sp.set("q", next.q);
  if (next.page > 1) sp.set("page", String(next.page));
  return `/blog?${sp.toString()}`;
}

function whereFor(workspaceId: string, q: ArticleQuery, withStatus = true): Prisma.BlogPostWhereInput {
  return {
    workspaceId,
    ...(withStatus && q.status ? { status: q.status } : {}),
    ...(q.topic ? { topicId: q.topic } : {}),
    ...(q.reviewer === "none" ? { reviewerId: null } : q.reviewer ? { reviewerId: q.reviewer } : {}),
    ...(q.q ? { OR: [{ title: { contains: q.q, mode: "insensitive" as const } }, { focusKeyword: { contains: q.q, mode: "insensitive" as const } }] } : {}),
  };
}

export async function listArticles(workspaceId: string, q: ArticleQuery) {
  const where = whereFor(workspaceId, q);
  const [items, total, byStatus] = await Promise.all([
    db.blogPost.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (q.page - 1) * ARTICLES_PER_PAGE,
      take: ARTICLES_PER_PAGE,
      select: {
        id: true, title: true, status: true, focusKeyword: true, updatedAt: true, scheduledAt: true, reviewerId: true,
        topic: { select: { name: true } },
        citations: { where: { verified: false }, select: { id: true } },
      },
    }),
    db.blogPost.count({ where }),
    // The status chips count within the other filters, not the status itself.
    db.blogPost.groupBy({ by: ["status"], where: whereFor(workspaceId, q, false), _count: { _all: true } }),
  ]);
  const counts = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])) as Record<string, number>;
  return { items, total, pages: Math.max(1, Math.ceil(total / ARTICLES_PER_PAGE)), counts };
}

/** Ids from a bulk form: unique, a sane number of them. Scoping to the workspace is the action's job. */
export function bulkIds(formData: FormData): string[] {
  return [...new Set(formData.getAll("ids").map(String).filter((s) => /^[a-z0-9]{10,40}$/i.test(s)))].slice(0, ARTICLES_PER_PAGE);
}
