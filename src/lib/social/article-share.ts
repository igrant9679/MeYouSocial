import { db } from "@/lib/db";
import { jobs } from "@/lib/jobs";
import { getSetting } from "@/lib/settings";
import { isGloballyPaused, writeAudit } from "@/lib/governance";
import {
  ARTICLE_SHARE_KEY, AUTO_SHARE_WINDOW_DAYS, SHARE_SOURCE, parseShareMode,
  type ShareMode,
} from "@/lib/social/article-share-options";

/**
 * Article Social Share (2026-11-23, the owner's "an Article Social Share function that, optionally, shares out blog
 * articles after they're posted/published on the websites").
 *
 * When an article gets its live link — published to WordPress (by the autopilot, a person or the draft hand-off),
 * marked published with its link, given one with Add live link, or by Elsie — `queueArticleShare` puts a durable job
 * on the queue, and `autoShareArticle` (the job) writes ONE post announcing it, as the workspace's dial says
 * (`social:article_share`: off · draft · queue · now).
 *
 * The record is a social IDEA with source "share" and the article as its source, so the post is written by the one
 * social writer (lib/social/drafting.ts: brand voice, guardrails, hashtags, the link at the end, the auto-image with
 * the article's title as the frame's headline) and every share shows on the Ideas board like other ideas. One per
 * article, whatever became of it: a share that was drafted, sent, rejected or skipped is never made again by itself.
 *
 * ⚠ Only articles that went live in the last AUTO_SHARE_WINDOW_DAYS are shared by themselves — Add live link on a
 * months-old article must not announce it as new. A person's "Share it now" has no window.
 * ⚠ It never goes round the approval workflow: under Require approval the post waits for an admin whatever the dial.
 */

export type ShareState =
  | { state: "none" }
  /** The post is being written this minute (the idea exists, its post doesn't yet). */
  | { state: "writing"; ideaId: string }
  | { state: "skipped"; ideaId: string; reason: string | null }
  | { state: "shared"; ideaId: string; socialPostId: string | null; postStatus: string | null; scheduledAt: Date | null; approval: string | null };

/** Longer than any write takes (a model call and two inserts); past it, an idea with no post was abandoned. */
const WRITE_STALL_MS = 15 * 60_000;

/** What became of an article's share, for its page. */
export async function shareStateFor(workspaceId: string, blogPostId: string): Promise<ShareState> {
  const idea = await db.socialIdea.findFirst({
    where: { workspaceId, sourceBlogPostId: blogPostId, source: SHARE_SOURCE },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, rejectReason: true, socialPostId: true, createdAt: true, socialPost: { select: { status: true, scheduledAt: true, approval: true } } },
  });
  if (!idea) return { state: "none" };
  if (idea.status === "rejected") return { state: "skipped", ideaId: idea.id, reason: idea.rejectReason };
  // Approved with no post: being written — or, past WRITE_STALL_MS, a write that stopped part-way (a killed
  // container). That one reads as skipped, so the engine leaves it and a person's Share it now replaces it.
  if (idea.status === "approved" && !idea.socialPostId) {
    return Date.now() - idea.createdAt.getTime() > WRITE_STALL_MS
      ? { state: "skipped", ideaId: idea.id, reason: "the post couldn't be written (it stopped part-way). Press Share it now to try again." }
      : { state: "writing", ideaId: idea.id };
  }
  return {
    state: "shared", ideaId: idea.id, socialPostId: idea.socialPostId,
    postStatus: idea.socialPost?.status ?? null, scheduledAt: idea.socialPost?.scheduledAt ?? null, approval: idea.socialPost?.approval ?? null,
  };
}

type ShareResult = { ok: true; socialPostId: string } | { ok: false; message: string };

/**
 * Write the share post for one published article, now. `actor` null = the engine (the job). Refuses an article that
 * isn't published with a live http(s) link, and one that already has a share (unless it was skipped and a person is
 * asking — a person may change their mind; the engine may not).
 */
export async function shareArticle(
  workspaceId: string,
  blogPostId: string,
  opts: { mode: Exclude<ShareMode, "off">; actor: { id: string; role: string } | null },
): Promise<ShareResult> {
  const post = await db.blogPost.findFirst({
    where: { id: blogPostId, workspaceId },
    select: { id: true, title: true, status: true, publishedUrl: true, metaDescription: true, topicId: true },
  });
  if (!post) return { ok: false, message: "That article isn't in this workspace." };
  if (post.status !== "published" || !post.publishedUrl || !/^https?:\/\//i.test(post.publishedUrl)) {
    return { ok: false, message: "Only a published article with its live link can be shared — add the link first." };
  }
  const existing = await shareStateFor(workspaceId, post.id);
  if (existing.state === "shared") return { ok: false, message: "This article has already been shared." };
  if (existing.state === "writing") return { ok: false, message: "The post sharing this article is being written right now — look again in a moment." };
  if (existing.state === "skipped" && !opts.actor) return { ok: false, message: "Someone chose not to share this article." };

  // The idea is the record. Approved at once: the dial (or the person) already decided it should be posted.
  const idea = await db.socialIdea.create({
    data: {
      workspaceId,
      topicId: post.topicId,
      hook: `New article: ${post.title}`.slice(0, 240),
      angle: (post.metaDescription?.trim() || "Tell followers the article is live, what it covers and why it's worth reading.").slice(0, 300),
      status: "approved",
      approvedAt: new Date(),
      source: SHARE_SOURCE,
      sourceBlogPostId: post.id,
      createdById: opts.actor?.id ?? null,
    },
  });
  if (existing.state === "skipped") {
    // The person changed their mind: the skip is superseded, not left beside a share.
    await db.socialIdea.delete({ where: { id: existing.ideaId } }).catch(() => {});
  }
  const { writeArticleShare } = await import("@/lib/social/drafting");
  const res = await writeArticleShare(workspaceId, idea.id, { placement: opts.mode, actor: opts.actor, headline: post.title });
  if (!res.ok) {
    // Nothing was posted: the idea goes back to the board as a plain approved idea would, so the record says what
    // happened and a person can try again (the job won't, it sees the idea).
    await db.socialIdea.update({ where: { id: idea.id }, data: { status: "rejected", rejectReason: `Couldn't be written: ${res.message}`.slice(0, 300) } }).catch(() => {});
    await writeAudit({ workspaceId, actorId: opts.actor?.id ?? null, action: "social.article_share_failed", entityType: "blog_post", entityId: post.id, meta: { reason: res.message.slice(0, 300), mode: opts.mode } });
    return res;
  }
  return { ok: true, socialPostId: res.postId };
}

/** A person's "Don't share this one": the article gets a skipped share, so the dial leaves it alone. */
export async function skipArticleShare(workspaceId: string, blogPostId: string, actorId: string): Promise<{ ok: boolean; message: string }> {
  const post = await db.blogPost.findFirst({ where: { id: blogPostId, workspaceId }, select: { id: true, title: true, topicId: true } });
  if (!post) return { ok: false, message: "That article isn't in this workspace." };
  const existing = await shareStateFor(workspaceId, post.id);
  if (existing.state === "shared") return { ok: false, message: "It has already been shared — delete or edit the post under Social posts instead." };
  if (existing.state === "writing") return { ok: false, message: "The post sharing it is being written right now — delete it under Social posts if you don't want it." };
  if (existing.state === "skipped") return { ok: true, message: "It's already set not to be shared." };
  await db.socialIdea.create({
    data: {
      workspaceId, topicId: post.topicId, hook: `New article: ${post.title}`.slice(0, 240), status: "rejected",
      rejectReason: "Not shared — a person chose to skip it.", source: SHARE_SOURCE, sourceBlogPostId: post.id, createdById: actorId,
    },
  });
  await writeAudit({ workspaceId, actorId, action: "social.article_share_skipped", entityType: "blog_post", entityId: post.id, meta: {} });
  return { ok: true, message: `"${post.title.slice(0, 60)}" won't be shared by itself.` };
}

/** Undo "Don't share this one" before the article goes live: its skip is removed, so the dial shares it as usual. */
export async function unskipArticleShare(workspaceId: string, blogPostId: string, actorId: string): Promise<{ ok: boolean; message: string }> {
  const existing = await shareStateFor(workspaceId, blogPostId);
  if (existing.state !== "skipped") return { ok: false, message: "It isn't set to be skipped." };
  await db.socialIdea.deleteMany({ where: { workspaceId, sourceBlogPostId: blogPostId, source: SHARE_SOURCE, status: "rejected" } });
  await writeAudit({ workspaceId, actorId, action: "social.article_share_unskipped", entityType: "blog_post", entityId: blogPostId, meta: {} });
  return { ok: true, message: "It will be shared when it goes live, as Settings → Automation says." };
}

/**
 * The job: share an article that just got its live link, if the dial says so. Quiet when it shouldn't: dial off,
 * workspace paused, article not published or not recent, already shared or skipped.
 */
export async function autoShareArticle(workspaceId: string, blogPostId: string): Promise<{ shared: boolean; why: string }> {
  const mode = parseShareMode(await getSetting(ARTICLE_SHARE_KEY, workspaceId).catch(() => ""));
  if (mode === "off") return { shared: false, why: "sharing is off" };
  if (await isGloballyPaused(workspaceId)) return { shared: false, why: "workspace paused" };
  const post = await db.blogPost.findFirst({ where: { id: blogPostId, workspaceId }, select: { status: true, publishedAt: true, publishedUrl: true } });
  if (!post || post.status !== "published" || !post.publishedUrl) return { shared: false, why: "not published with a link" };
  const cutoff = Date.now() - AUTO_SHARE_WINDOW_DAYS * 86_400_000;
  if (!post.publishedAt || post.publishedAt.getTime() < cutoff) return { shared: false, why: `went live more than ${AUTO_SHARE_WINDOW_DAYS} days ago` };
  if ((await shareStateFor(workspaceId, blogPostId)).state !== "none") return { shared: false, why: "already shared or skipped" };
  const res = await shareArticle(workspaceId, blogPostId, { mode, actor: null });
  return res.ok ? { shared: true, why: mode } : { shared: false, why: res.message };
}

/**
 * Called where an article gets its live link. Best effort and never throws: a publish must not fail because the
 * share couldn't be queued. The job itself decides whether anything is shared.
 */
export async function queueArticleShare(workspaceId: string, blogPostId: string): Promise<void> {
  try {
    const mode = parseShareMode(await getSetting(ARTICLE_SHARE_KEY, workspaceId).catch(() => ""));
    if (mode === "off") return;
    // The queue runs a job at once in the process that queued it; register here too, so that works even where the
    // boot-time worker (which registers every handler) isn't running — AUTOPILOT=off, a script.
    registerArticleShareJobs();
    await jobs.enqueue("social.article_share", { workspaceId, blogPostId }, { refId: blogPostId, workspaceId });
  } catch (e) {
    console.warn(`[article-share] ${workspaceId}: couldn't queue the share of ${blogPostId}:`, e instanceof Error ? e.message : e);
  }
}

let registered = false;

/** The job handler, registered with every other (lib/jobs registerAllJobs). */
export function registerArticleShareJobs() {
  if (registered) return;
  registered = true;
  jobs.register<{ workspaceId: string; blogPostId: string }>("social.article_share", async ({ workspaceId, blogPostId }, ctx) => {
    await ctx.progress(0.1);
    // Once per job: a retry after the post was written must not write a second one.
    await ctx.once("share", async () => autoShareArticle(workspaceId, blogPostId));
    await ctx.progress(1);
  });
}
