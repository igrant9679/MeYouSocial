import { db } from "@/lib/db";

/**
 * Count badges for the stage strip. Keyed by the tab's href (or a stage's
 * own href for its Overview). COUNT queries only — this runs on every page
 * render, like the badges on the retired Blog and Social bars did — and a
 * badge shows only when the number is above zero. `urgent` = a person has to
 * act (held for review, awaiting approval, a reply nobody has opened);
 * otherwise the number is just news (scheduled, discovered, pending).
 *
 * ⚠ Deliberately a LOWER BOUND where the Inbox knows more (posts over a
 * network's limit, for instance, need each post measured): under-counting is
 * the safe direction — a badge must never nag about something that isn't
 * there.
 */
export type StripCount = { n: number; urgent?: boolean };
export type StripCounts = Record<string, StripCount>;

export async function stripCounts(workspaceId: string): Promise<StripCounts> {
  const now = new Date();
  // The Ideas badge counts "discovered" across all three formats — a video
  // idea's own word for it is `new`, a social idea's is `discovered`.
  const [heldArticles, finalApproval, ideasDiscovered, videoIdeasNew, socialIdeasNew, auditOpen, awaiting, scheduled, unseen, invitations] = await Promise.all([
    db.blogPost.count({ where: { workspaceId, status: "draft_review" } }),
    db.blogPost.count({ where: { workspaceId, status: "final_approval" } }),
    db.blogIdea.count({ where: { workspaceId, status: "discovered" } }),
    db.idea.count({ where: { channel: { workspaceId }, status: "new" } }),
    db.socialIdea.count({ where: { workspaceId, status: "discovered" } }),
    db.contentAuditItem.count({ where: { workspaceId, status: "open", recommendation: { not: "keep" } } }),
    db.socialPost.count({ where: { workspaceId, approval: "pending" } }),
    db.socialPost.count({ where: { workspaceId, status: "scheduled", scheduledAt: { gte: now } } }),
    db.socialInboxEvent.count({ where: { workspaceId, readAt: null } }),
    db.invitation.count({ where: { workspaceId, acceptedAt: null, expiresAt: { gt: now } } }),
  ]);
  return {
    "/blog": { n: heldArticles, urgent: true },
    "/ideas": { n: ideasDiscovered + videoIdeasNew + socialIdeasNew },
    "/publish": { n: finalApproval },
    "/blog/audit": { n: auditOpen, urgent: true },
    "/social/approvals": { n: awaiting, urgent: true },
    "/social/calendar": { n: scheduled },
    "/social/engage": { n: unseen, urgent: true },
    "/setup/people": { n: invitations },
  };
}
