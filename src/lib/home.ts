import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { getSocialOverview, type AttentionItem, type SocialOverview } from "@/lib/social/overview";
import { readingsForWorkspace } from "@/lib/social/performance";
import { formatZonedMoment, formatDay } from "@/lib/zoned-dates";
import { getPostingTimeZone } from "@/lib/social/slots";

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
  // Measure's own 28-day window, so the Inbox's impressions match the page they link to (tracker #26).
  const last28 = new Date(now.getTime() - 28 * DAY);

  const [
    social,
    blogByStatus,
    ideasDiscovered,
    ideasApproved,
    videoIdeasNew,
    videoIdeasApproved,
    socialIdeasNew,
    socialIdeasApproved,
    blogReviewPosts,
    unseenInbox,
    replyDrafts,
    publishedBlog7,
    publishedSocial7,
    readings,
    gscSite,
    ga4Property,
    staleArticles,
    staleSocial,
    stuckArticles,
    stuckSocial,
  ] = await Promise.all([
    getSocialOverview(workspaceId),
    db.blogPost.groupBy({ by: ["status"], where: { workspaceId }, _count: { _all: true } }),
    db.blogIdea.count({ where: { workspaceId, status: "discovered" } }),
    db.blogIdea.count({ where: { workspaceId, status: "approved" } }),
    db.idea.count({ where: { channel: { workspaceId }, status: "new" } }),
    db.idea.count({ where: { channel: { workspaceId }, status: "approved" } }),
    db.socialIdea.count({ where: { workspaceId, status: "discovered" } }),
    db.socialIdea.count({ where: { workspaceId, status: "approved" } }),
    db.blogPost.count({ where: { workspaceId, status: { in: ["draft_review", "final_approval"] } } }),
    db.socialInboxEvent.count({ where: { workspaceId, readAt: null } }),
    db.inboxReplyDraft.count({ where: { workspaceId } }),
    db.blogPost.count({ where: { workspaceId, status: "published", publishedAt: { gte: last7 } } }),
    db.socialPost.count({
      where: { workspaceId, status: { in: ["posted", "partial"] }, publishedAt: { gte: last7 } },
    }),
    readingsForWorkspace(workspaceId, last28).catch(() => []),
    getSetting("gsc:site_url", workspaceId).catch(() => ""),
    getSetting("ga4:property_id", workspaceId).catch(() => ""),
    // Stale triage (E-IDE-23): undecided a week, or approved a week and not made.
    // From the last change, not birth: a "Not yet" is a decision and restarts it.
    db.blogIdea.count({ where: { workspaceId, status: "discovered", updatedAt: { lt: last7 } } }),
    db.socialIdea.count({ where: { workspaceId, status: "discovered", updatedAt: { lt: last7 } } }),
    // An article idea keeps no approval time; its last change is the nearest.
    db.blogIdea.count({ where: { workspaceId, status: "approved", updatedAt: { lt: last7 } } }),
    db.socialIdea.count({ where: { workspaceId, status: "approved", OR: [{ approvedAt: { lt: last7 } }, { approvedAt: null, createdAt: { lt: last7 } }] } }),
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
      href: "/blog?view=list",
      cta: "Review",
    });
  }

  // One card for the three formats (2026-09-21): a person triages the board,
  // not a table. The breakdown says where the work is.
  const toTriage = ideasDiscovered + videoIdeasNew + socialIdeasNew;
  if (toTriage > 0) {
    const parts = [
      ideasDiscovered ? `${ideasDiscovered} article` : "",
      videoIdeasNew ? `${videoIdeasNew} video` : "",
      socialIdeasNew ? `${socialIdeasNew} social` : "",
    ].filter(Boolean);
    // The line waiting is broken down the same way: one total read as "12
    // articles queued" on a workspace whose 12 were social ideas the gate had
    // approved, while no article had been approved for four weeks (2026-10-18).
    const waiting = [
      ideasApproved ? `${ideasApproved} article` : "",
      videoIdeasApproved ? `${videoIdeasApproved} video` : "",
      socialIdeasApproved ? `${socialIdeasApproved} social` : "",
    ].filter(Boolean);
    const noArticle = ideasDiscovered > 0 && ideasApproved === 0 ? " No article idea is approved, so the engine has no new article to write." : "";
    const stale = staleArticles + staleSocial;
    decisions.push({
      module: "Blog",
      kind: "blog-ideas",
      severity: "info",
      title: `${toTriage} idea${toTriage === 1 ? "" : "s"} to triage${parts.length > 1 ? ` — ${parts.join(", ")}` : ""}${stale ? ` · ${stale} waiting more than a week` : ""}`,
      detail:
        (waiting.length
          ? `Approved ideas are made by the engine on its weekly allowances — waiting in that line now: ${waiting.join(", ")}.`
          : "Approved ideas are made by the engine on its weekly allowances; rejected ones stop coming back.") + noArticle,
      href: "/ideas",
      cta: "Triage",
    });
  }

  // A paused social queue (E-SOC-06) holds every post until someone resumes it.
  {
    const { socialQueuePause } = await import("@/lib/social/queue-pause");
    const qp = await socialQueuePause(workspaceId).catch(() => null);
    if (qp) {
      decisions.push({
        module: "Social",
        kind: "social-queue-paused",
        severity: "warn",
        title: "The social queue is paused",
        detail: `Since ${formatDay(new Date(qp.since), await getPostingTimeZone(workspaceId).catch(() => "UTC"))}, by ${qp.by}${qp.note ? ` — “${qp.note}”` : ""}. Nothing scheduled goes out until an admin resumes it; articles carry on.`,
        href: "/setup/automation#social-queue",
        cta: "Resume it",
      });
    }
  }

  // Approved a week ago and still not made (E-IDE-23): the engine isn't taking
  // them — its allowance, a manual dial, the pause — so a person has to.
  const stuck = stuckArticles + stuckSocial;
  if (stuck > 0) {
    const { draftingBlockers } = await import("@/lib/idea-blockers");
    const blockers = await draftingBlockers(workspaceId).catch(() => ({ article: null, social: null }));
    const why = [stuckArticles ? blockers.article?.text : null, stuckSocial ? blockers.social?.text : null].filter((t, i, a): t is string => !!t && a.indexOf(t) === i);
    const which = [stuckArticles ? `${stuckArticles} article` : "", stuckSocial ? `${stuckSocial} social` : ""].filter(Boolean).join(", ");
    decisions.push({
      module: "Blog",
      kind: "ideas-approved-stuck",
      severity: "warn",
      title: `${stuck} approved idea${stuck === 1 ? " hasn't" : "s haven't"} been made in a week${stuckArticles && stuckSocial ? ` — ${which}` : ""}`,
      detail: why.length ? why.join(" ") : "The engine makes approved ideas within its weekly allowance, highest priority first — Draft now makes one straight away, Not yet sends it back to Discovered.",
      href: "/ideas",
      cta: "Open the board",
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

  // Times in these cards read in the posting timezone (E-SHL-16).
  const homeTz = await getPostingTimeZone(workspaceId).catch(() => "UTC");

  // An autopilot step that threw two cycles running (ENG-21) — the rest of the
  // cycle carries on now, so without this nobody would know.
  {
    const { readCycleStatus } = await import("@/lib/blog-autopilot");
    const cycle = await readCycleStatus(workspaceId).catch(() => null);
    for (const [name, st] of Object.entries(cycle?.steps ?? {})) {
      if (st.failures < 2) continue;
      decisions.push({
        module: "Setup",
        kind: `autopilot-step-failing-${name.replace(/\s+/g, "-")}`,
        severity: "warn",
        title: `The autopilot's ${name} step keeps failing`,
        detail: `${st.failures} cycles in a row since ${formatZonedMoment(new Date(st.since), homeTz)}: ${st.message}`.slice(0, 300),
        href: "/setup/automation",
        cta: "Open Automation",
      });
    }
  }

  // The engine stopped checking in (E-ENG-03): an idle engine still checks in
  // every sweep, so two hours without one means the sweep isn't running. Not
  // raised before the first check-in, while paused, or with AUTOPILOT=off.
  if (process.env.AUTOPILOT !== "off") {
    const { readHeartbeat, isSilent } = await import("@/lib/engine-heartbeat");
    const { isGloballyPaused } = await import("@/lib/governance");
    const hb = await readHeartbeat(workspaceId).catch(() => null);
    if (hb && isSilent(hb, Date.now()) && !(await isGloballyPaused(workspaceId).catch(() => false))) {
      const { getPostingTimeZone } = await import("@/lib/social/slots");
      const { formatZonedMoment } = await import("@/lib/zoned-dates");
      const tz = await getPostingTimeZone(workspaceId).catch(() => "UTC");
      const hours = Math.floor((Date.now() - Date.parse(hb.at)) / 3_600_000);
      decisions.push({
        module: "Setup",
        kind: "engine-silent",
        severity: "warn",
        title: `The engine hasn't checked in for ${hours} hours`,
        detail: `It sweeps every ${Math.max(5, parseInt(process.env.AUTOPILOT_INTERVAL_MIN ?? "30", 10) || 30)} minutes; the last check-in was ${formatZonedMoment(new Date(hb.at), tz)}. Nothing is drafted, published or posted until it runs again — the platform operator needs to look at the server.`,
        href: "/setup/automation",
        cta: "Open Automation",
      });
    }
  }

  // Today's AI allowance is used (E-ENG-06): the engine stops writing until
  // midnight in the posting zone; publishing and queueing carry on.
  {
    const { generationsToday, DAILY_AI_BUDGET } = await import("@/lib/blog-autopilot");
    const used = await generationsToday(workspaceId).catch(() => 0);
    if (used >= DAILY_AI_BUDGET) {
      const { getPostingTimeZone } = await import("@/lib/social/slots");
      const { zoneLabel } = await import("@/lib/zoned-dates");
      const tz = await getPostingTimeZone(workspaceId).catch(() => "UTC");
      decisions.push({
        module: "Setup",
        kind: "ai-allowance-used",
        severity: "info",
        title: "Today's AI allowance is used",
        detail: `The engine has made ${used} of its ${DAILY_AI_BUDGET} unattended AI runs today, so it writes nothing more until midnight ${zoneLabel(tz)}. Publishing, advancing and queueing carry on, and anything a person starts still runs.`,
        href: "/setup/automation",
        cta: "Open Automation",
      });
    }
  }

  // An AI provider refusing this workspace's calls (out of credits, over its
  // quota, a rejected key). The router falls back to a placeholder that the
  // guards won't store, so without this the engine just goes quiet.
  {
    const { providerRefusals } = await import("@/lib/llm/provider-health");
    const NAME: Record<string, string> = { anthropic: "Anthropic", google: "Google" };
    const WHERE: Record<string, string> = { anthropic: "console.anthropic.com", google: "ai.studio/projects" };
    for (const r of await providerRefusals(workspaceId).catch(() => [])) {
      const why = r.kind === "credits" ? "its prepaid credits are used up" : r.kind === "quota" ? "it's over its rate or quota limit" : "it rejected the key";
      decisions.push({
        module: "Setup",
        kind: `ai-provider-refusing-${r.provider}`,
        severity: "warn",
        title: `${NAME[r.provider] ?? r.provider} is refusing this workspace's AI calls`,
        detail: `Since ${formatZonedMoment(new Date(r.since), homeTz)} ${why}, so every ${NAME[r.provider] ?? r.provider} model call gets a placeholder and nothing is written.${r.kind === "key" ? " Check the key under Settings → Keys." : ` Fix it at ${WHERE[r.provider] ?? "the provider's console"}.`} Last reply: ${r.message}`.slice(0, 400),
        href: "/admin/api-keys",
        cta: "Open Keys",
      });
    }
  }

  // A connected source whose sync keeps failing (MEA-06). Two in a row, so one
  // Google blip doesn't page anyone; the sync runs every six hours.
  {
    const { readSyncStatus, SOURCE_LABEL } = await import("@/lib/analytics/sync");
    const status = await readSyncStatus(workspaceId).catch(() => ({}) as Awaited<ReturnType<typeof readSyncStatus>>);
    for (const src of ["gsc", "ga4"] as const) {
      const st = status[src];
      if (!st || st.ok || st.failures < 2) continue;
      decisions.push({
        module: "Setup",
        kind: `analytics-sync-failing-${src}`,
        severity: "warn",
        title: `${SOURCE_LABEL[src]} sync is failing`,
        detail: `${st.failures} attempts in a row${st.lastOkAt ? `, last good ${formatDay(new Date(st.lastOkAt), homeTz)}` : ", never succeeded"}: ${st.message}`.slice(0, 300),
        href: "/admin/analytics",
        cta: "See why",
      });
    }
  }

  // Measured anomalies (E-MEA-19): search clicks falling week on week, and
  // articles slipping off page one — silent on thin or stale data.
  {
    const { searchAnomalies } = await import("@/lib/search-anomalies");
    const { drop, fellOff } = await searchAnomalies(workspaceId).catch(() => ({ drop: null, fellOff: [] }));
    if (drop) {
      decisions.push({
        module: "Blog",
        kind: "search-clicks-drop",
        severity: "warn",
        title: `Search clicks fell ${Math.round(drop.drop * 100)}% week on week`,
        detail: `${drop.recent} clicks in the 7 days to ${formatDay(drop.end, homeTz)}, against ${drop.prior} the week before. Measure shows which articles moved.`,
        href: "/measure",
        cta: "Open Measure",
      });
    }
    if (fellOff.length > 3) {
      decisions.push({
        module: "Blog",
        kind: "fell-off-page-one",
        severity: "warn",
        title: `${fellOff.length} articles fell off page one this week`,
        detail: `Biggest first: ${fellOff.slice(0, 3).map((f) => `“${f.title.slice(0, 60)}” (${f.before.toFixed(1)} → ${f.after.toFixed(1)})`).join(", ")}.`,
        href: "/measure",
        cta: "Open Measure",
      });
    } else {
      for (const f of fellOff) {
        decisions.push({
          module: "Blog",
          kind: `fell-off-page-one-${f.postId}`,
          severity: "warn",
          title: `“${f.title.slice(0, 80)}” fell off page one`,
          detail: `Average position ${f.before.toFixed(1)} → ${f.after.toFixed(1)} week on week, over ${f.impressions} impressions. A refresh may win it back.`,
          href: `/blog/${f.postId}?tab=performance`,
          cta: "See its numbers",
        });
      }
    }
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
      total: ideasDiscovered + ideasApproved + videoIdeasNew + videoIdeasApproved + socialIdeasNew + socialIdeasApproved,
      parts: [
        { label: "article", n: ideasDiscovered + ideasApproved, href: "/ideas?format=article" },
        { label: "video", n: videoIdeasNew + videoIdeasApproved, href: "/ideas?format=video" },
        { label: "social", n: socialIdeasNew + socialIdeasApproved, href: "/ideas?format=social" },
      ],
      href: "/ideas",
    },
    {
      key: "drafting",
      label: "Drafting",
      total: blogDrafting + socialDrafts,
      parts: [
        { label: "blog", n: blogDrafting, href: "/blog?view=list" },
        { label: "social", n: socialDrafts, href: "/social/drafts" },
      ],
      href: blogDrafting >= socialDrafts ? "/blog?view=list" : "/social/drafts",
    },
    {
      key: "approve",
      label: "Approve",
      total: approveBlog + approveSocial,
      parts: [
        { label: "blog", n: approveBlog, href: "/blog?view=list" },
        { label: "social", n: approveSocial, href: "/social/approvals" },
      ],
      // The headline goes where most of the waiting is — it always went to social approvals.
      href: approveBlog > approveSocial ? "/blog?view=list" : "/social/approvals",
    },
    {
      key: "schedule",
      label: "Scheduled",
      total: social.counts.scheduled,
      parts: [{ label: "social", n: social.counts.scheduled, href: "/social/queue" }],
      href: "/social/queue",
    },
    {
      key: "publish",
      label: "Published (7d)",
      total: publishedBlog7 + publishedSocial7,
      parts: [
        { label: "blog", n: publishedBlog7, href: "/blog" },
        { label: "social", n: publishedSocial7, href: "/social/performance?range=7" },
      ],
      href: "/social/performance?range=7",
    },
    {
      key: "measure",
      // The latest reading of posts SENT in the last 28 days (their impressions so far), social only.
      label: "Impressions (28d posts)",
      total: impressions30,
      reason: "no engagement measured yet — it syncs a few times a day once posts are out",
      parts: [],
      href: "/social/performance?range=28",
    },
  ];

  return { decisions, pipeline, social, blogIdeasOpen: ideasDiscovered + ideasApproved };
}
