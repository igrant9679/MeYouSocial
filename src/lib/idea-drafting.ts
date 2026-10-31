import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import type { BlogIdea } from "@prisma/client";

/**
 * The one way an article idea becomes an article — shared by the four doors:
 * the autopilot sweep, "Draft this", "Auto-draft approved" and the
 * assistant's draft_article.
 *
 * ⚠ Each door used to do this itself, and every one of them got two things
 * wrong (audit IDE-01, IDE-02, IDE-06, 2026-10-25):
 *   · Nothing claimed the idea, so a click racing the sweep (or a second tab)
 *     drafted it twice. The claim below is a conditional update on the idea's
 *     status; exactly one caller wins.
 *   · Every idea became a NEW post. "Refresh: X" and an audit's "Rewrite: X"
 *     wrote a competing article at a new URL that then published under
 *     autonomy; "Retire: X" and "Merge: X" did the same, which is the opposite
 *     of what they say. Now a refresh revises the post it names, and a
 *     retire/merge is a change on the live site that only a person makes.
 *   · Only the title and keyword travelled, so the Topic, tier, audience,
 *     motif blend and angle never reached the writer.
 */

export type IdeaChange = "new" | "refresh" | "site_change";

const VERB = /^(Refresh|Rewrite|Retire|Merge)\s*:/i;

/**
 * What approving this idea means. A refresh needs a post in this app to revise
 * (`refreshPostId`, or one `linkRefreshTargets` found for it); a refresh or
 * rewrite of a page the app didn't write, and every retire or merge, is a site
 * change: redirects and edits a person makes on the site, never a new article.
 */
export function ideaChange(idea: Pick<BlogIdea, "title" | "source" | "refreshPostId">): IdeaChange {
  const verb = idea.title.match(VERB)?.[1]?.toLowerCase();
  if (verb === "retire" || verb === "merge") return "site_change";
  if (idea.refreshPostId) return "refresh";
  if (verb || idea.source === "refresh") return "site_change";
  return "new";
}

/**
 * A post a refresh can revise in place: published, and live at a place the app
 * knows — on WordPress through the app (`wpPostId`), or published by hand at
 * its recorded link (`publishedUrl`: Download HTML, then Mark as published).
 */
export function refreshableLive(post: { status: string; wpPostId: number | null; publishedUrl: string | null }): boolean {
  return post.status === "published" && (post.wpPostId != null || !!post.publishedUrl);
}

const bareTitle = (s: string) =>
  s.replace(VERB, "").replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, "").replace(/\s+/g, " ").toLowerCase();

/**
 * Refresh ideas that don't name their article get it here: a "Refresh: <title>"
 * or "Rewrite: <title>" a person typed names a post only by its title, so it
 * was turned away as a site change while that very article was in the app.
 * The title after the verb must equal exactly one published article's title
 * (case and quotes aside); a match is stored on the idea, so the board and the
 * sweep's filter see a refresh from then on. Returns the ideas, updated.
 */
export async function linkRefreshTargets<T extends Pick<BlogIdea, "id" | "title" | "source" | "refreshPostId">>(
  workspaceId: string,
  ideas: T[],
): Promise<T[]> {
  const open = ideas.filter((i) => {
    if (i.refreshPostId) return false;
    const verb = i.title.match(VERB)?.[1]?.toLowerCase();
    return verb === "refresh" || verb === "rewrite" || (!verb && i.source === "refresh");
  });
  if (!open.length) return ideas;
  const published = await db.blogPost.findMany({
    where: { workspaceId, status: "published" },
    select: { id: true, title: true },
  });
  const byTitle = new Map<string, string[]>();
  for (const p of published) {
    const key = bareTitle(p.title);
    byTitle.set(key, [...(byTitle.get(key) ?? []), p.id]);
  }
  const found = new Map<string, string>();
  for (const idea of open) {
    const ids = byTitle.get(bareTitle(idea.title));
    if (ids?.length !== 1) continue;
    // only an idea still without a post: a person's own choice is never replaced
    const set = await db.blogIdea.updateMany({ where: { id: idea.id, workspaceId, refreshPostId: null }, data: { refreshPostId: ids[0] } });
    if (set.count) found.set(idea.id, ids[0]);
  }
  return ideas.map((i) => (found.has(i.id) ? { ...i, refreshPostId: found.get(i.id)! } : i));
}

export const SITE_CHANGE_MESSAGE =
  "This idea is a change to a page on the live site, not a new article — the app won't draft it. Make it in WordPress: rewrite the page in place, or 301-redirect it to the page that replaces it (never delete the URL). Then reject the idea here to clear it.";

export type IdeaDraftResult =
  | { ok: true; change: "new" | "refresh"; postId: string; finished: { imagesGenerated: number; seoOptimized: number } | null }
  | { ok: false; reason: "not_found" | "taken" | "site_change" | "protected" | "refused" | "error"; message: string; postId?: string };

/**
 * Draft one idea. `from` is the idea statuses this door may draft (the sweep:
 * approved; a person's click: discovered or approved). `finish` decides who
 * parks the draft at review: the caller inline (the sweep and the assistant
 * wait for it) or the blog.finishdraft job (a click shouldn't wait on images).
 */
export async function draftIdeaCore(
  workspaceId: string,
  ideaId: string,
  opts: { from: string[]; actorId?: string | null; finish: "inline" | "job" },
): Promise<IdeaDraftResult> {
  const found = await db.blogIdea.findFirst({ where: { id: ideaId, workspaceId } });
  if (!found) return { ok: false, reason: "not_found", message: "No such idea." };
  const [idea] = await linkRefreshTargets(workspaceId, [found]);
  if (!opts.from.includes(idea.status)) {
    return { ok: false, reason: "taken", message: idea.postId ? "That idea was already drafted." : `That idea is ${idea.status}.`, postId: idea.postId ?? undefined };
  }

  const change = ideaChange(idea);
  if (change === "site_change") return { ok: false, reason: "site_change", message: SITE_CHANGE_MESSAGE };

  let target: { id: string; body: string | null } | null = null;
  if (change === "refresh") {
    const post = await db.blogPost.findFirst({
      where: { id: idea.refreshPostId!, workspaceId },
      select: { id: true, status: true, body: true, protectedFromRewrite: true, wpPostId: true, publishedUrl: true },
    });
    if (!post || !post.body) return { ok: false, reason: "site_change", message: SITE_CHANGE_MESSAGE };
    if (post.protectedFromRewrite) {
      return { ok: false, reason: "protected", message: "The article this would refresh is protected from rewrites. Lift the protection on the article first, or reject the idea.", postId: post.id };
    }
    if (post.status !== "published") {
      return { ok: false, reason: "taken", message: "The article this would refresh isn't live (it is in review or being revised already). Let it finish first.", postId: post.id };
    }
    if (!refreshableLive(post)) {
      return { ok: false, reason: "site_change", message: "The article this would refresh was marked published without its live link, so the app can't tell which page to update. Reject the idea, or start a new article.", postId: post.id };
    }
    target = post;
  }

  // ⚠ The claim. Exactly one caller moves the idea out of `from`.
  const previousStatus = idea.status;
  const claim = await db.blogIdea.updateMany({
    where: { id: idea.id, workspaceId, status: { in: opts.from } },
    data: { status: "drafted" },
  });
  if (claim.count !== 1) return { ok: false, reason: "taken", message: "That idea is already being drafted." };

  const { generateDraftCore, completeFreshDraftCore, revertRefusedDraft } = await import("@/lib/blog-autopilot");
  let postId: string;
  if (target) {
    // Take the live post back through review. The live page keeps its version
    // until the revision is published: on WordPress that publish updates the
    // same post in place (publishCore, `refreshStartedAt`); an article published
    // by hand goes out the way it did — Download HTML, replace the page at its
    // link, Mark as published, which keeps the link and the first-published date.
    const moved = await db.blogPost.updateMany({
      where: { id: target.id, workspaceId, status: "published" },
      data: { status: "drafting", refreshStartedAt: new Date() },
    });
    if (!moved.count) {
      await db.blogIdea.update({ where: { id: idea.id }, data: { status: previousStatus } });
      return { ok: false, reason: "taken", message: "The article this would refresh changed state just now; try again.", postId: target.id };
    }
    postId = target.id;
    await writeAudit({
      workspaceId, actorId: opts.actorId ?? null, action: "blog.refresh_started", entityType: "blog_post", entityId: postId,
      meta: { ideaId: idea.id, title: idea.title },
    });
  } else {
    const post = await db.blogPost.create({
      data: {
        workspaceId,
        title: idea.title,
        focusKeyword: idea.keyword,
        status: "drafting",
        // What the idea knew follows it into the draft (IDE-02).
        topicId: idea.topicId,
        audience: idea.audience,
        contentTier: idea.tier,
        motifs: idea.motifs && idea.motifs !== "[]" ? idea.motifs : "[]",
        createdById: opts.actorId ?? null,
      },
    });
    postId = post.id;
  }
  await db.blogIdea.update({ where: { id: idea.id }, data: { postId } });

  // A throw is treated like a refusal (ENG-21): it used to leave an empty
  // post and the idea marked drafted, and abort the whole cycle.
  let ok = false;
  let failure: string | null = null;
  try {
    ok = await generateDraftCore(workspaceId, postId, { angle: idea.angle, refreshOf: target?.body ?? null, actorId: opts.actorId ?? null });
  } catch (e) {
    failure = (e instanceof Error ? e.message : String(e)).slice(0, 300);
  }
  if (!ok) {
    // Nothing was stored. A refresh goes back to being the live post; a new
    // post is deleted (revertRefusedDraft only deletes an empty one). Either
    // way the idea returns to where it was.
    if (target) {
      await db.blogPost.updateMany({ where: { id: target.id, workspaceId, status: "drafting" }, data: { status: "published", refreshStartedAt: null } });
    }
    await revertRefusedDraft(workspaceId, postId, idea, previousStatus);
    return failure
      ? { ok: false, reason: "error", message: `Drafting failed (${failure}), so nothing was stored. The idea is back on the board.` }
      : { ok: false, reason: "refused", message: "The writer didn't answer (paused, or the AI provider is down), so nothing was stored. The idea is back on the board." };
  }

  let finished: { imagesGenerated: number; seoOptimized: number } | null = null;
  if (opts.finish === "inline") {
    try {
      finished = await completeFreshDraftCore(workspaceId, postId);
    } catch (e) {
      // The prose is stored; images and SEO are the part that failed. The job
      // finishes it with retries rather than leaving the post in "drafting".
      console.error(`[idea-drafting] finishing ${postId} failed, queued as a job:`, e instanceof Error ? e.message : e);
      const { jobs } = await import("@/lib/jobs");
      await jobs.enqueue("blog.finishdraft", { workspaceId, postId }, { refId: postId, workspaceId });
    }
  } else {
    const { jobs } = await import("@/lib/jobs");
    await jobs.enqueue("blog.finishdraft", { workspaceId, postId }, { refId: postId, workspaceId });
  }
  return { ok: true, change: target ? "refresh" : "new", postId, finished };
}
