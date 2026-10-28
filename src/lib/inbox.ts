import { db } from "@/lib/db";
import { runBlogChecks } from "@/lib/blog-checks";
import { blockingChecks } from "@/lib/blog-gates";
import { loadAssetGate } from "@/lib/blog-images";
import { loadEditorialContext } from "@/lib/blog-slop";
import { isFullyAutonomous } from "@/lib/autonomy";
import { getHomeData, type HomeData, type HomeDecision } from "@/lib/home";
import type { FindingQuestion } from "@/lib/blog-findings";

/**
 * The Inbox (One-Loop redesign, step 2): every item waiting on a PERSON, as
 * one card each with its action inline — promoted from Home's category-level
 * "Needs you" queue.
 *
 * Home said "3 posts waiting for approval → Open approvals". The Inbox lists
 * the three posts, each with Approve / Request changes on the card. Same for
 * held articles (which required check is failing), open knowledge findings
 * (the questions themselves), images auto-review gave up on, claims no source
 * could be found for, and invitations (with their join link).
 *
 * Two rules carried over from home.ts and social/overview.ts, because they are
 * why those queues work:
 *   · only things a person can act on — under full autonomy the engine tries
 *     first, so an unverified citation shows up only once live search has
 *     failed it, and a pending image only once two renders were rejected;
 *   · every count is measured; nothing here calls an external API.
 */

export type InboxSocialPost = {
  id: string;
  text: string;
  submittedBy: string | null;
  createdAt: Date;
  scheduledAt: Date | null;
  providers: string[];
  approval: string;
};

export type InboxArticle = {
  id: string;
  title: string;
  status: string;
  /** Required checks currently failing, by label. Empty = passing (waits on a cycle). */
  failing: string[];
  openQuestions: number;
  unverifiedCitations: number;
};

export type InboxQuestion = {
  findingId: string;
  postId: string;
  postTitle: string;
  title: string;
  detail: string | null;
  questions: FindingQuestion[];
};

export type InboxImage = {
  id: string;
  postId: string;
  postTitle: string;
  role: string;
  url: string;
  altText: string | null;
  rejections: number;
};

export type InboxCitation = {
  id: string;
  postId: string;
  postTitle: string;
  claim: string;
  unsourceable: boolean;
};

export type InboxInvitation = { id: string; email: string; role: string; token: string; expiresAt: Date };

export type InboxData = {
  home: HomeData;
  socialPosts: InboxSocialPost[];
  articles: InboxArticle[];
  questions: InboxQuestion[];
  images: InboxImage[];
  citations: InboxCitation[];
  invitations: InboxInvitation[];
  /** Category-level conditions the item cards don't replace (connections, slots, analytics…). */
  conditions: HomeDecision[];
  /** Items a person can act on right now, across every group. */
  total: number;
  /** Full autonomy is on: articles that pass every check move on by themselves. */
  autonomous: boolean;
};

const WEEK = 7 * 24 * 3600_000;

/** Category decisions that the item cards above now render one-by-one. */
const REPLACED_KINDS = new Set(["awaiting-approval", "blog-review"]);

export async function getInboxData(workspaceId: string, opts: { admin: boolean; editor?: boolean }): Promise<InboxData> {
  const [home, autonomous] = await Promise.all([getHomeData(workspaceId), isFullyAutonomous(workspaceId)]);

  // ── Social posts awaiting approval — each one, with its targets ─────────
  const pendingPosts = await db.socialPost.findMany({
    where: { workspaceId, approval: "pending" },
    orderBy: { createdAt: "asc" },
    take: 12,
    include: { targets: { select: { provider: true } } },
  });
  const authorIds = [...new Set(pendingPosts.map((p) => p.createdById).filter((x): x is string => !!x))];
  const authors = authorIds.length
    ? await db.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true, email: true } })
    : [];
  const authorName = new Map(authors.map((u) => [u.id, u.name ?? u.email]));
  const socialPosts: InboxSocialPost[] = pendingPosts.map((p) => ({
    id: p.id,
    text: p.text,
    submittedBy: p.createdById ? authorName.get(p.createdById) ?? null : null,
    createdAt: p.createdAt,
    scheduledAt: p.scheduledAt,
    providers: [...new Set(p.targets.map((t) => t.provider))],
    approval: p.approval ?? "pending",
  }));

  // ── Articles held at review — with the check that holds them ────────────
  const held = await db.blogPost.findMany({
    where: { workspaceId, status: "draft_review" },
    orderBy: { updatedAt: "asc" },
    take: 10,
  });
  const articles: InboxArticle[] = [];
  for (const post of held) {
    const [unverified, assets, editorial, openQuestions] = await Promise.all([
      db.blogCitation.count({ where: { postId: post.id, verified: false } }),
      loadAssetGate(workspaceId, post.id),
      loadEditorialContext(workspaceId, post),
      db.blogFinding.count({ where: { postId: post.id, kind: "knowledge", status: "open" } }),
    ]);
    const failing = runBlogChecks(post, unverified, assets, editorial)
      .filter((c) => c.required && !c.pass)
      .map((c) => c.label);
    articles.push({ id: post.id, title: post.title, status: post.status, failing, openQuestions, unverifiedCitations: unverified });
  }
  // …and articles at final approval that no longer pass (an edit, a new
  // marker): publishing re-checks and won't send them, so a person has to
  // know which check (audit ART-08). An override that covers the text counts.
  const finals = await db.blogPost.findMany({
    where: { workspaceId, status: "final_approval" },
    orderBy: { updatedAt: "asc" },
    take: 10,
    select: { id: true, title: true, status: true },
  });
  for (const post of finals) {
    const failing = await blockingChecks(workspaceId, post.id);
    if (!failing?.length) continue;
    const [unverified, openQuestions] = await Promise.all([
      db.blogCitation.count({ where: { postId: post.id, verified: false } }),
      db.blogFinding.count({ where: { postId: post.id, kind: "knowledge", status: "open" } }),
    ]);
    articles.push({ id: post.id, title: post.title, status: post.status, failing, openQuestions, unverifiedCitations: unverified });
  }

  // ── Questions only the author can answer (knowledge findings) ───────────
  const openFindings = await db.blogFinding.findMany({
    where: { workspaceId, kind: "knowledge", status: "open", post: { status: { in: ["draft_review", "final_approval", "drafting"] } } },
    orderBy: { createdAt: "asc" },
    take: 8,
    include: { post: { select: { id: true, title: true } } },
  });
  const questions: InboxQuestion[] = openFindings.map((f) => {
    let qs: FindingQuestion[] = [];
    try { qs = JSON.parse(f.questions) as FindingQuestion[]; } catch { qs = []; }
    return { findingId: f.id, postId: f.post.id, postTitle: f.post.title, title: f.title, detail: f.detail, questions: qs };
  });

  // ── Images a person has to look at ──────────────────────────────────────
  // Under full autonomy the vision review approves clean renders itself; only
  // a render it has rejected twice (and stopped paying for) reaches here.
  const pendingImages = await db.blogImage.findMany({
    where: { status: "pending", source: "ai", post: { workspaceId, status: { in: ["draft_review", "final_approval"] } } },
    include: { post: { select: { id: true, title: true } } },
    take: 12,
  });
  const images: InboxImage[] = [];
  for (const img of pendingImages) {
    const rejections = await db.auditLog.count({
      where: { workspaceId, action: "blog.image_auto_rejected", entityId: img.id, createdAt: { gte: new Date(Date.now() - WEEK) } },
    });
    if (!autonomous || rejections >= 2) {
      images.push({ id: img.id, postId: img.post.id, postTitle: img.post.title, role: img.role, url: img.url, altText: img.altText, rejections });
    }
  }

  // ── Claims without a source ─────────────────────────────────────────────
  // Under autonomy, live search gets the first try; a claim shows up here once
  // it has been searched and nothing supports it.
  const unverifiedCits = await db.blogCitation.findMany({
    where: { verified: false, post: { workspaceId, status: "draft_review" } },
    include: { post: { select: { id: true, title: true } } },
    take: 12,
  });
  const citations: InboxCitation[] = [];
  for (const c of unverifiedCits) {
    const unsourceable =
      (await db.auditLog.count({
        where: { workspaceId, action: "blog.citation_unsourceable", entityId: c.postId, meta: { contains: c.id }, createdAt: { gte: new Date(Date.now() - WEEK) } },
      })) > 0;
    if (!autonomous || unsourceable) citations.push({ id: c.id, postId: c.post.id, postTitle: c.post.title, claim: c.claim, unsourceable });
  }

  // ── Invitations (admins), with the join link that email may never carry ──
  const invitations: InboxInvitation[] = opts.admin
    ? (await db.invitation.findMany({
        where: { workspaceId, acceptedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
        take: 6,
      })).map((i) => ({ id: i.id, email: i.email, role: i.role, token: i.token, expiresAt: i.expiresAt }))
    : [];

  const conditions = home.decisions.filter((d) => !REPLACED_KINDS.has(d.kind));
  // An article that passes every check needs nobody under full autonomy —
  // the next cycle moves it. Without autonomy it needs a click (SHL-06).
  const articlesNeedingYou = articles.filter((a) => a.failing.length > 0 || !autonomous).length;
  // Counted only where this person can act (SHL-07): approving a post is an
  // admin's, the article work an editor's; a viewer's count used to never
  // reach zero. The groups still show — read-only — for everyone.
  const editor = opts.editor ?? opts.admin;
  const total = (opts.admin ? socialPosts.length + invitations.length : 0)
    + (editor ? articlesNeedingYou + questions.length + images.length + citations.length : 0);

  return { home, socialPosts, articles, questions, images, citations, invitations, conditions, total, autonomous };
}
