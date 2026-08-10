import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { getSocialOverview, type AttentionItem, type SocialOverview } from "@/lib/social/overview";
import { readingsForWorkspace } from "@/lib/social/performance";

/**
 * The Home page's data: one decision queue and one pipeline, across every
 * module.
 *
 * The problem this solves is navigational, not informational. The app is three
 * merged products (CreateUp's YouTube tooling, Spark's blog engine, the Social
 * engine) and its nav answers "where does X live" — but the question a person
 * opens the app with is "what needs me right now", and until this file nothing
 * answered it anywhere. The engine is autonomous; the human's job is decisions.
 * So Home leads with the decisions and draws the pipeline those decisions sit
 * inside, and everything else on the page is secondary.
 *
 * Rules inherited from `social/overview.ts`, because they're why that panel
 * works:
 *   - Only things a person can ACT ON go in the queue. Conditions nobody can
 *     fix train people to ignore the panel.
 *   - Every count is measured, never estimated. Where a number can't be known
 *     the caller renders a dash and the reason.
 *
 * ⚠ NOTHING HERE CALLS ZERNIO (or any external API). Home renders on every
 * visit; its data comes from our own tables. That's why the queue counts
 * drafted review replies (ours) but not unanswered reviews (a live Zernio
 * listing) — Engage owns the live view.
 */

export type HomeDecision = AttentionItem & {
  /** Which product area the decision belongs to — rendered as a chip. */
  module: "Social" | "Blog" | "Engage" | "Setup";
};

export type PipelinePart = { label: string; n: number; href: string };

export type PipelineStage = {
  key: string;
  label: string;
  /** Null = genuinely unknown (never zero-in-disguise); renders as a dash. */
  total: number | null;
  /** Reason shown when total is null. */
  reason?: string;
  /** Per-module breakdown, each its own link. */
  parts: PipelinePart[];
  href: string;
};

export type HomeData = {
  decisions: HomeDecision[];
  pipeline: PipelineStage[];
  social: SocialOverview;
  blogIdeasOpen: number;
};

const DAY = 24 * 60 * 60 * 1000;

export async function getHomeData(workspaceId: string): Promise<HomeData> {
  const now = new Date();
  const last7 = new Date(now.getTime() - 7 * DAY);
  const last30 = new Date(now.getTime() - 30 * DAY);

  const [
    social,
    blogByStatus,
    ideasDiscovered,
    ideasApproved,
    blogReviewPosts,
    unseenInbox,
    replyDrafts,
    publishedBlog7,
    publishedSocial7,
    readings,
    gscSite,
    ga4Property,
  ] = await Promise.all([
    getSocialOverview(workspaceId),
    db.blogPost.groupBy({ by: ["status"], where: { workspaceId }, _count: { _all: true } }),
    db.blogIdea.count({ where: { workspaceId, status: "discovered" } }),
    db.blogIdea.count({ where: { workspaceId, status: "approved" } }),
    db.blogPost.count({ where: { workspaceId, status: { in: ["draft_review", "final_approval"] } } }),
    db.socialInboxEvent.count({ where: { workspaceId, readAt: null } }),
    db.inboxReplyDraft.count({ where: { workspaceId } }),
    db.blogPost.count({ where: { workspaceId, status: "published", publishedAt: { gte: last7 } } }),
    db.socialPost.count({
      where: { workspaceId, status: { in: ["posted", "partial"] }, publishedAt: { gte: last7 } },
    }),
    readingsForWorkspace(workspaceId, last30).catch(() => []),
    getSetting("gsc:site_url", workspaceId).catch(() => ""),
    getSetting("ga4:property_id", workspaceId).catch(() => ""),
  ]);

  const blogCount = (s: string) => blogByStatus.find((b) => b.status === s)?._count._all ?? 0;

  // ── Decision queue ─────────────────────────────────────────────────────────
  // Social's attention list already follows the act-on-it-or-leave-it-out rule;
  // adopt it wholesale and add what it can't see.
  const decisions: HomeDecision[] = social.attention.map((a) => ({ ...a, module: "Social" as const }));

  if (blogReviewPosts > 0) {
    decisions.push({
      module: "Blog",
      kind: "blog-review",
      severity: "warn",
      title: `${blogReviewPosts} blog post${blogReviewPosts === 1 ? "" : "s"} waiting for your review`,
      detail: "Drafted and stopped at the review gate. Nothing publishes until you've read it.",
      href: "/blog/board",
      cta: "Review",
    });
  }

  if (ideasDiscovered > 0) {
    decisions.push({
      module: "Blog",
      kind: "blog-ideas",
      severity: "info",
      title: `${ideasDiscovered} blog idea${ideasDiscovered === 1 ? "" : "s"} to approve or dismiss`,
      detail:
        ideasApproved > 0
          ? `Approved ideas are drafted by autopilot on its weekly budget — ${ideasApproved} already waiting in that line.`
          : "Approved ideas are drafted by autopilot on its weekly budget; dismissed ones stop coming back.",
      href: "/blog/ideas",
      cta: "Triage",
    });
  }

  if (unseenInbox > 0) {
    // Warn, not info: Meta's 24-hour reply window makes an unread DM the one
    // item on this page that genuinely expires.
    decisions.push({
      module: "Engage",
      kind: "inbox-unseen",
      severity: "warn",
      title: `${unseenInbox} new message${unseenInbox === 1 ? "" : "s"} or comment${unseenInbox === 1 ? "" : "s"}`,
      detail: "Arrived since anyone last looked. DMs on Facebook and Instagram can only be answered within 24 hours of the person's message.",
      href: "/social/engage",
      cta: "Open Engage",
    });
  }

  if (replyDrafts > 0) {
    decisions.push({
      module: "Engage",
      kind: "reply-drafts",
      severity: "info",
      title: `${replyDrafts} review repl${replyDrafts === 1 ? "y" : "ies"} drafted, not sent`,
      detail: "Written and waiting in the reply box. Nothing sends until you press Send.",
      href: "/social/engage",
      cta: "Read them",
    });
  }

  if (!gscSite || !ga4Property) {
    const missing = [!gscSite && "Search Console site", !ga4Property && "GA4 property"].filter(Boolean);
    decisions.push({
      module: "Setup",
      kind: "analytics-unconfigured",
      severity: "info",
      title: "Analytics isn't fully configured",
      detail: `${missing.join(" and ")} not set for this workspace, so the Measure end of the pipeline is dark.`,
      href: "/admin/analytics",
      cta: "Set up",
    });
  }

  // Warn before info; within a band, keep insertion order (Social's own
  // ordering is already deliberate).
  decisions.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "warn" ? -1 : 1));

  // ── Pipeline ───────────────────────────────────────────────────────────────
  const socialDrafts = social.counts.drafts;
  const blogDrafting = blogCount("drafting");
  const approveBlog = blogReviewPosts;
  const approveSocial = social.counts.awaitingApproval + social.counts.changesRequested;

  // Engagement: cumulative impressions across targets published in the last 30
  // days. Only readings that actually carry a number count — X legs report
  // nothing (`adsStatus: not_connected`) and null + null is not 0. No measured
  // reading at all = a dash, not a 0.
  const measured = readings.filter((r) => typeof r.stats.impressions === "number");
  const impressions30 = measured.length
    ? measured.reduce((n, r) => n + (r.stats.impressions ?? 0), 0)
    : null;

  const pipeline: PipelineStage[] = [
    {
      key: "ideas",
      label: "Ideas",
      total: ideasDiscovered + ideasApproved,
      parts: [{ label: "blog", n: ideasDiscovered + ideasApproved, href: "/blog/ideas" }],
      href: "/blog/ideas",
    },
    {
      key: "drafting",
      label: "Drafting",
      total: blogDrafting + socialDrafts,
      parts: [
        { label: "blog", n: blogDrafting, href: "/blog/board" },
        { label: "social", n: socialDrafts, href: "/social/calendar" },
      ],
      href: "/blog/board",
    },
    {
      key: "approve",
      label: "Approve",
      total: approveBlog + approveSocial,
      parts: [
        { label: "blog", n: approveBlog, href: "/blog/board" },
        { label: "social", n: approveSocial, href: "/social/approvals" },
      ],
      href: "/social/approvals",
    },
    {
      key: "schedule",
      label: "Scheduled",
      total: social.counts.scheduled,
      parts: [{ label: "social", n: social.counts.scheduled, href: "/social/calendar" }],
      href: "/social/calendar",
    },
    {
      key: "publish",
      label: "Published (7d)",
      total: publishedBlog7 + publishedSocial7,
      parts: [
        { label: "blog", n: publishedBlog7, href: "/blog" },
        { label: "social", n: publishedSocial7, href: "/social/performance" },
      ],
      href: "/social/performance",
    },
    {
      key: "measure",
      label: "Impressions (30d)",
      total: impressions30,
      reason: "no engagement measured yet — it syncs a few times a day once posts are out",
      parts: [],
      href: "/social/performance",
    },
  ];

  return { decisions, pipeline, social, blogIdeasOpen: ideasDiscovered + ideasApproved };
}
