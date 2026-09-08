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
 */

export type GateSubject = { gateOverrideAt?: Date | null };

/** The required checks pass, or an admin has overridden them for this post. */
export function gatesSatisfied(post: GateSubject, checks: CheckResult[]): boolean {
  return !!post.gateOverrideAt || requiredChecksPass(checks);
}

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
  const loaded = await checksFor(workspaceId, postId);
  if (!loaded || loaded.post.status !== "draft_review") return false;
  if (!gatesSatisfied(loaded.post, loaded.checks)) return false;
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
    data: { gateOverrideAt: new Date(), gateOverrideById: actorId, gateOverrideReason: reason.slice(0, 300) || null },
  });
  await writeAudit({
    workspaceId, actorId, action: "blog.gate_overridden", entityType: "blog_post", entityId: postId,
    meta: { failing, reason: reason.slice(0, 300) || null },
  });
  const moved = await advanceIfReadyCore(workspaceId, postId, "override");
  return { failing, moved };
}
