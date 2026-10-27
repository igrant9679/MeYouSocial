import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { runBlogChecks, requiredChecksPass, type CheckResult } from "@/lib/blog-checks";
import { loadAssetGate } from "@/lib/blog-images";
import { loadEditorialContext } from "@/lib/blog-slop";
import { writeAudit } from "@/lib/governance";

/**
 * The gates, with a person in charge of them (the owner, 2026-09-08: "When
 * I click Dismiss, the article should move to the next step even if I
 * haven't addressed the issue. Let me override the recommendation.").
 *
 * Two things this file makes true:
 *
 *  1. A person's clearing act moves the article NOW. Answering or dismissing
 *     a question, verifying or dropping a claim, approving an image — each
 *     calls advanceIfReadyCore, which re-runs the checks and advances the
 *     article the moment they pass, instead of leaving it for the next sweep.
 *
 *  2. An admin can override the checks. "Advance anyway" records who, when
 *     and why on the post and in the audit log, and every gate — the manual
 *     advance, the sweep's auto-advance, and publishing — treats an overridden
 *     post as passing. Recorded, never silent: the override is the admin's
 *     decision on the record, which is what a gate is for.
 *
 *  ⚠ The override covers the words the admin saw (audit ART-09). It used to
 *     survive Back, Regenerate and every edit, so a re-drafted article with
 *     new [NEEDS SOURCE] markers sailed through on a decision about other
 *     text. Now it's pinned to a hash of the body: change the body and the
 *     checks apply again. Leaving final approval, or Clear, drops it outright.
 */

export type GateSubject = { gateOverrideAt?: Date | null; gateOverrideHash?: string | null; body?: string | null };

/** md5 of the body — the same value Postgres's md5() gives (the migration back-fill relies on it). */
export function bodyHash(body: string | null | undefined): string {
  return createHash("md5").update(body ?? "", "utf8").digest("hex");
}

/** An admin's override is on record AND still covers the article's current body. */
export function overrideHolds(post: GateSubject): boolean {
  return !!post.gateOverrideAt && post.gateOverrideHash === bodyHash(post.body);
}

/** The required checks pass, or an admin's override covers this exact body. */
export function gatesSatisfied(post: GateSubject, checks: CheckResult[]): boolean {
  return overrideHolds(post) || requiredChecksPass(checks);
}

/** What leaving the approved state wipes: the publish date and any override. */
export const CLEAR_APPROVAL = {
  scheduledAt: null, gateOverrideAt: null, gateOverrideById: null, gateOverrideReason: null, gateOverrideHash: null,
} as const;

async function checksFor(workspaceId: string, postId: string) {
  const post = await db.blogPost.findFirst({ where: { id: postId, workspaceId } });
  if (!post) return null;
  const [unverified, assets, editorial] = await Promise.all([
    db.blogCitation.count({ where: { postId, verified: false } }),
    loadAssetGate(workspaceId, postId),
    loadEditorialContext(workspaceId, post),
  ]);
  return { post, checks: runBlogChecks(post, unverified, assets, editorial) };
}

/**
 * If the article is at review and its gates are satisfied, advance it to
 * final approval now. Returns true when it moved. Safe to call after any
 * clearing act; a no-op otherwise.
 */
export async function advanceIfReadyCore(workspaceId: string, postId: string, via: string): Promise<boolean> {
  let loaded = await checksFor(workspaceId, postId);
  if (!loaded || loaded.post.status !== "draft_review") return false;
  // A claim a person verified before the hand-verify fix still has its marker
  // in the body; link those first (exact sentence matches only), so clearing
  // the article's last blocker isn't defeated by an invisible one. Dynamic
  // import: blog-autoreview depends on modules that depend on this one.
  const { linkVerifiedMarkers } = await import("@/lib/blog-autoreview");
  if (await linkVerifiedMarkers(postId).catch(() => 0)) loaded = await checksFor(workspaceId, postId);
  if (!loaded || !gatesSatisfied(loaded.post, loaded.checks)) return false;
  await db.blogPost.update({ where: { id: postId }, data: { status: "final_approval" } });
  await writeAudit({
    workspaceId, action: "blog.auto_advanced", entityType: "blog_post", entityId: postId,
    meta: { from: "draft_review", to: "final_approval", via },
  });
  return true;
}

/**
 * An admin's override: record it on the post and in the audit log (with the
 * checks it overrode), then advance. Returns the labels that were failing.
 */
export async function overrideGateCore(workspaceId: string, postId: string, actorId: string, reason: string): Promise<{ failing: string[]; moved: boolean } | null> {
  const loaded = await checksFor(workspaceId, postId);
  if (!loaded) return null;
  const failing = loaded.checks.filter((c) => c.required && !c.pass).map((c) => c.label);
  await db.blogPost.update({
    where: { id: postId },
    data: {
      gateOverrideAt: new Date(), gateOverrideById: actorId, gateOverrideReason: reason.slice(0, 300) || null,
      gateOverrideHash: bodyHash(loaded.post.body),
    },
  });
  await writeAudit({
    workspaceId, actorId, action: "blog.gate_overridden", entityType: "blog_post", entityId: postId,
    meta: { failing, reason: reason.slice(0, 300) || null },
  });
  const moved = await advanceIfReadyCore(workspaceId, postId, "override");
  return { failing, moved };
}

/**
 * The required checks this article fails right now, by label — [] when it
 * passes or an override covers it, null when there's no such article. What
 * the publish step, /publish and the Inbox show for an article at final
 * approval that would no longer go out (audit ART-08).
 */
export async function blockingChecks(workspaceId: string, postId: string): Promise<string[] | null> {
  const loaded = await checksFor(workspaceId, postId);
  if (!loaded) return null;
  if (gatesSatisfied(loaded.post, loaded.checks)) return [];
  return loaded.checks.filter((c) => c.required && !c.pass).map((c) => c.label);
}

/**
 * An admin takes their override back. At final approval an article that only
 * got there on the override returns to review (with its publish date cleared),
 * so the checks decide again.
 */
export async function clearGateOverrideCore(workspaceId: string, postId: string, actorId: string): Promise<{ cleared: boolean; backToReview: boolean }> {
  const loaded = await checksFor(workspaceId, postId);
  if (!loaded || !loaded.post.gateOverrideAt) return { cleared: false, backToReview: false };
  const backToReview = loaded.post.status === "final_approval" && !requiredChecksPass(loaded.checks);
  await db.blogPost.update({
    where: { id: postId },
    data: backToReview ? { ...CLEAR_APPROVAL, status: "draft_review" } : { gateOverrideAt: null, gateOverrideById: null, gateOverrideReason: null, gateOverrideHash: null },
  });
  await writeAudit({
    workspaceId, actorId, action: "blog.gate_override_cleared", entityType: "blog_post", entityId: postId,
    meta: { backToReview },
  });
  return { cleared: true, backToReview };
}

/**
 * A person changed the words of an approved or live article (audit ART-21).
 * What was approved is no longer what would publish, so:
 *   · at final approval it goes back to review, and its publish date and any
 *     override go with it — approving it again is a fresh decision;
 *   · live on WordPress through the app, it becomes a refresh: the live page
 *     stays as it is until this revision passes review and publishes in place
 *     (publishCore, `refreshStartedAt`).
 * Anywhere else — drafting, review, or published by hand off the app — nothing
 * moves. Call it after the write, with the article's status from before it.
 */
export async function returnToReviewAfterEdit(
  workspaceId: string, postId: string, via: string, actorId?: string | null,
): Promise<"review" | "refresh" | null> {
  // Every edit path comes through here, so every marker it left gets its row
  // (and so its Inbox card) now, not only under full autonomy (ART-19).
  const { syncMarkerRows } = await import("@/lib/citation-rows");
  await syncMarkerRows(postId).catch(() => 0);
  const back = await db.blogPost.updateMany({
    where: { id: postId, workspaceId, status: "final_approval" },
    data: { ...CLEAR_APPROVAL, status: "draft_review" },
  });
  if (back.count) {
    await writeAudit({ workspaceId, actorId: actorId ?? null, action: "blog.returned_to_review", entityType: "blog_post", entityId: postId, meta: { via } });
    return "review";
  }
  const revise = await db.blogPost.updateMany({
    where: { id: postId, workspaceId, status: "published", wpPostId: { not: null } },
    data: { ...CLEAR_APPROVAL, status: "draft_review", refreshStartedAt: new Date() },
  });
  if (revise.count) {
    await writeAudit({ workspaceId, actorId: actorId ?? null, action: "blog.refresh_started", entityType: "blog_post", entityId: postId, meta: { via } });
    return "refresh";
  }
  return null;
}
