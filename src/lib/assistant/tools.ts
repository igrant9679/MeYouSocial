import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { APP_GUIDE, appGuide } from "@/lib/assistant/knowledge";
import { PRODUCT } from "@/lib/product";

/**
 * The assistant's tools — what it can do. Since 2026-09-08 that is nearly
 * everything a person can do in the app (the owner's ask: ideas, research,
 * keywords and topics, drafts, decisions and recommendations, review,
 * publishing, distribution, reports, settings, people).
 *
 * THE SAFETY MODEL moved from "no outward-facing tools" to three rules:
 *   1. `confirm` — anything outward-facing or hard to undo (publish, send,
 *      queue, approve, override, delete-like, a setting, an invitation) is
 *      PROPOSED to the person and runs only on their yes (run.ts holds the
 *      proposal on the thread). Approving stays a human act; the human now
 *      says it in the chat.
 *   2. `minRole` — an admin-only act refuses for an editor, as the page would.
 *   3. Every execution writes an audit row with the tool name and arguments.
 *
 * Still refused outright (REFUSED_INTENTS): secrets (API keys, connections'
 * credentials), deleting a workspace or a person's account, sending email.
 */

export type ToolContext = { workspaceId: string; userId: string; role: string; page?: string | null; channelId?: string | null };

export type Tool = {
  name: string;
  /** Shown to the model. Say what it does AND where the result lands. */
  description: string;
  /** Argument names → what they mean. Flat and small on purpose. */
  args: Record<string, string>;
  /** Read-only tools are free to call; the model is told to prefer them. */
  readOnly?: boolean;
  /** Propose to the person and run only on their yes. */
  confirm?: boolean;
  /** Refuse below this role. */
  minRole?: "ADMIN";
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
};

const str = (v: unknown, max = 300): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown, dflt: number, max: number): number => {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : dflt;
};
const bool = (v: unknown): boolean | null => {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").toLowerCase();
  if (["true", "on", "yes", "1"].includes(s)) return true;
  if (["false", "off", "no", "0"].includes(s)) return false;
  return null;
};
const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const when = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—");

/** Things people will ask for that this assistant deliberately cannot do. */
export const REFUSED_INTENTS = [
  "entering or changing API keys, passwords or connection credentials (Admin → API keys, Admin → Connections — a person pastes those)",
  "deleting a workspace, a channel or a person's account (Admin)",
  "sending email",
];

// ─────────────────────────────────────────────────────────────────────────────

export const TOOLS: Tool[] = [
  // ── Orientation ───────────────────────────────────────────────────────────
  {
    name: "next_steps",
    description: "The whole situation in one call — what is waiting on a person (Inbox), the pipeline by stage, what is missing in Settings → Connections, the dials — turned into a ranked list of recommended next moves with the tool that does each. Call this first whenever the person asks what to do, seems lost, or asks for a plan or a recommendation.",
    args: {},
    readOnly: true,
    async run(_a, ctx) {
      const [{ getInboxData }, { setupOverview }] = await Promise.all([import("@/lib/inbox"), import("@/lib/setup-status")]);
      const [inbox, o] = await Promise.all([getInboxData(ctx.workspaceId, { admin: ctx.role === "ADMIN" }), setupOverview(ctx.workspaceId)]);
      const [ideas, posts, social] = await Promise.all([
        db.blogIdea.groupBy({ by: ["status"], where: { workspaceId: ctx.workspaceId }, _count: { _all: true } }),
        db.blogPost.groupBy({ by: ["status"], where: { workspaceId: ctx.workspaceId }, _count: { _all: true } }),
        db.socialPost.groupBy({ by: ["status"], where: { workspaceId: ctx.workspaceId }, _count: { _all: true } }),
      ]);
      const n = (rows: Array<{ status: string; _count: { _all: number } }>, s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
      const lines: string[] = [];
      let rank = 1;
      const push = (s: string) => lines.push(`${rank++}. ${s}`);
      for (const p of inbox.socialPosts) push(`Approve or request changes on social post ${p.id} ("${p.text.slice(0, 60)}…") — approve_social_post / request_changes_social_post (admin). Page /social/approvals`);
      for (const q of inbox.questions) push(`Answer the question "${q.title}" for "${q.postTitle}" (finding ${q.findingId}) — answer_finding or dismiss_finding. Page /blog/${q.postId}?tab=optimize`);
      for (const c of inbox.citations) push(`Source or drop the claim "${c.claim.slice(0, 70)}…" in "${c.postTitle}" (citation ${c.id}) — verify_claim with a URL, or drop_claim. Page /blog/${c.postId}`);
      for (const i of inbox.images) push(`Approve or replace the ${i.role} image for "${i.postTitle}" (image ${i.id}) — approve_image. Page /blog/${i.postId}`);
      for (const a of inbox.articles) push(a.failing.length ? `Article "${a.title}" (${a.id}) is held by: ${a.failing.join("; ")} — fix it, or advance_article / override_gate (admin). Page /blog/${a.id}` : `Article "${a.title}" (${a.id}) passes every check — advance_article moves it to final approval now.`);
      const approved = n(ideas, "approved"), discovered = n(ideas, "discovered");
      if (approved === 0) push(discovered > 0 ? `The Approved pool is empty but ${discovered} idea(s) are discovered — approve the best (list_ideas, approve_idea) or nothing new gets drafted.` : "No ideas at all — discover_ideas, or add_idea from something the person knows.");
      const finals = n(posts, "final_approval");
      if (finals > 0) push(`${finals} article(s) at final approval — ${o.connections.find((c) => c.key === "wordpress")?.state === "ok" ? `they publish ${o.publishDayLabel ? `on ${o.publishDayLabel}s` : "on the next cycle"} (publish_article for now)` : "no WordPress: export_html_link, then mark_published"}.`);
      const drafts = n(social, "draft"), scheduled = n(social, "scheduled");
      if (drafts > 0 && scheduled === 0) push(`${drafts} social draft(s) and nothing queued — queue_social_post (or list_social_posts first).`);
      for (const m of o.missing.slice(0, 4)) push(`Missing: ${m.label} — ${m.detail}. Page ${m.href}`);
      if (!o.schedule.timeZoneConfigured) push("No posting timezone set (slots read as UTC) — set_timezone (admin).");
      if (o.schedule.slotsPerWeek === 0) push("No posting slots — add_posting_slots (admin) or nothing social can be queued.");
      if (!lines.length) push("Nothing needs a person right now. Good moves: discover_ideas to keep the pool full, or results_summary to see what is working.");
      return [
        `Situation: ideas discovered=${discovered} approved=${approved} · articles drafting=${n(posts, "drafting")} review=${n(posts, "draft_review")} final=${finals} published=${n(posts, "published")} · social drafts=${drafts} scheduled=${scheduled} · autonomy ${o.autonomy.on ? "ON" : "off"} · articles/week ${o.autonomy.weeklyArticles} · publish day ${o.publishDayLabel ?? "any"} · connections missing ${o.missing.length}`,
        "Recommended next moves, most important first:",
        ...lines,
      ].join("\n");
    },
  },
  {
    name: "pipeline_status",
    description: "Counts across the workspace: ideas by status, articles by status, social posts by status. Cheap; use for a quick check.",
    args: {},
    readOnly: true,
    async run(_a, ctx) {
      const [ideas, posts, social] = await Promise.all([
        db.blogIdea.groupBy({ by: ["status"], where: { workspaceId: ctx.workspaceId }, _count: { _all: true } }),
        db.blogPost.groupBy({ by: ["status"], where: { workspaceId: ctx.workspaceId }, _count: { _all: true } }),
        db.socialPost.groupBy({ by: ["status"], where: { workspaceId: ctx.workspaceId }, _count: { _all: true } }),
      ]);
      const fmt = (rows: Array<{ status: string; _count: { _all: number } }>) => (rows.length ? rows.map((r) => `${r.status}=${r._count._all}`).join(", ") : "none");
      return [`ideas: ${fmt(ideas)}`, `articles: ${fmt(posts)}`, `social posts: ${fmt(social)}`].join("\n");
    },
  },
  {
    name: "inbox_items",
    description: "Everything waiting on a person, one line each with the id a tool needs: posts awaiting approval, questions, unsourced claims, held images, held articles, pending invitations.",
    args: {},
    readOnly: true,
    async run(_a, ctx) {
      const { getInboxData } = await import("@/lib/inbox");
      const i = await getInboxData(ctx.workspaceId, { admin: ctx.role === "ADMIN" });
      const out = [
        ...i.socialPosts.map((p) => `post ${p.id} awaiting approval: "${p.text.slice(0, 80)}" (${p.providers.join(", ") || "no network"})`),
        ...i.questions.map((q) => `question (finding ${q.findingId}) for article ${q.postId}: ${q.title} — ${q.questions.map((x) => x.q).join(" / ")}`),
        ...i.citations.map((c) => `claim (citation ${c.id}) in article ${c.postId}: "${c.claim.slice(0, 100)}"${c.unsourceable ? " — live search found no support" : ""}`),
        ...i.images.map((m) => `image ${m.id} (${m.role}) for article ${m.postId} pending, ${m.rejections} rejection(s)`),
        ...i.articles.map((a) => `article ${a.id} "${a.title}" held by: ${a.failing.join("; ") || "nothing — advances next cycle"}`),
        ...i.invitations.map((v) => `invitation ${v.id} to ${v.email} (${v.role}) not accepted`),
      ];
      return out.length ? out.join("\n") : "nothing is waiting on a person";
    },
  },
  {
    name: "app_guide",
    description: "The app's own operator guide, one topic at a time: where a page or control is, the routines, the sweep, the gates, claims, images, social, publishing, ideas, research, settings, onboarding, troubleshooting. Call it before answering any how / where / why question, then answer naming the exact page and tab.",
    args: { topic: "what the person is asking about, in their words" },
    readOnly: true,
    async run(a) {
      const t = appGuide(str(a.topic, 200));
      if (!t) return "No matching topic. Topics: " + APP_GUIDE.map((g) => `${g.id} — ${g.title}`).join("; ");
      return `${t.title}\n\n${t.body}`;
    },
  },

  // ── Reading ───────────────────────────────────────────────────────────────
  {
    name: "list_ideas",
    description: "Article ideas with id, status, title, keyword. Statuses: discovered → approved → drafted (or rejected).",
    args: { status: "optional: discovered | approved | rejected | drafted", limit: "optional, default 20" },
    readOnly: true,
    async run(a, ctx) {
      const status = str(a.status, 20);
      const rows = await db.blogIdea.findMany({ where: { workspaceId: ctx.workspaceId, ...(status ? { status } : {}) }, orderBy: [{ priority: "desc" }, { createdAt: "desc" }], take: num(a.limit, 20, 50), select: { id: true, title: true, status: true, keyword: true, priority: true } });
      return rows.length ? rows.map((r) => `${r.id} [${r.status}${r.priority != null ? ` p${r.priority}` : ""}] ${r.title}${r.keyword ? ` (keyword: ${r.keyword})` : ""}`).join("\n") : "no ideas match";
    },
  },
  {
    name: "list_video_ideas",
    description: "Video ideas per channel with id, status (new | approved | in_progress | scripted | archived), title and outlier score.",
    args: { channelId: "optional channel id", limit: "optional, default 20" },
    readOnly: true,
    async run(a, ctx) {
      const channelId = str(a.channelId, 40);
      const rows = await db.idea.findMany({ where: { channel: { workspaceId: ctx.workspaceId, ...(channelId ? { id: channelId } : {}) } }, orderBy: [{ outlierScore: "desc" }, { createdAt: "desc" }], take: num(a.limit, 20, 50), select: { id: true, title: true, status: true, outlierScore: true, channel: { select: { id: true, name: true } } } });
      return rows.length ? rows.map((r) => `${r.id} [${r.status}${r.outlierScore != null ? ` ${r.outlierScore.toFixed(1)}×` : ""}] ${r.title} (channel ${r.channel.name} ${r.channel.id})`).join("\n") : "no video ideas";
    },
  },
  {
    name: "list_articles",
    description: "Articles with id, status and title. Statuses: drafting → draft_review → final_approval → published.",
    args: { status: "optional filter", limit: "optional, default 20" },
    readOnly: true,
    async run(a, ctx) {
      const status = str(a.status, 20);
      const rows = await db.blogPost.findMany({ where: { workspaceId: ctx.workspaceId, ...(status ? { status } : {}) }, orderBy: { updatedAt: "desc" }, take: num(a.limit, 20, 50), select: { id: true, title: true, status: true, metaTitle: true, scheduledAt: true, publishedUrl: true } });
      return rows.length ? rows.map((r) => `${r.id} [${r.status}] ${r.title}${r.metaTitle ? "" : " (no SEO meta yet)"}${r.scheduledAt ? ` (set for ${when(r.scheduledAt)})` : ""}${r.publishedUrl ? ` live: ${r.publishedUrl}` : ""}`).join("\n") : "no articles match";
    },
  },
  {
    name: "article_checks",
    description: "One article's required and optional checks — which pass, which fail — plus its open findings and citations. Use to explain why an article is held and what would clear it.",
    args: { articleId: "the article id" },
    readOnly: true,
    async run(a, ctx) {
      const id = str(a.articleId, 40);
      const post = await db.blogPost.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
      if (!post) return "no such article in this workspace";
      const [{ runBlogChecks }, { loadAssetGate }, { loadEditorialContext }] = await Promise.all([import("@/lib/blog-checks"), import("@/lib/blog-images"), import("@/lib/blog-slop")]);
      const [unverified, assets, editorial, findings, cites] = await Promise.all([
        db.blogCitation.count({ where: { postId: id, verified: false } }),
        loadAssetGate(ctx.workspaceId, id),
        loadEditorialContext(ctx.workspaceId, post),
        db.blogFinding.findMany({ where: { postId: id, status: "open" }, select: { id: true, kind: true, title: true } }),
        db.blogCitation.findMany({ where: { postId: id, verified: false }, select: { id: true, claim: true } }),
      ]);
      const checks = runBlogChecks(post, unverified, assets, editorial);
      return [
        `${post.title} — status ${post.status}${post.gateOverrideAt ? " (checks OVERRIDDEN by an admin)" : ""}`,
        `required failing: ${checks.filter((c) => c.required && !c.pass).map((c) => c.label).join("; ") || "none"}`,
        `optional failing: ${checks.filter((c) => !c.required && !c.pass).map((c) => c.label).join("; ") || "none"}`,
        `open findings: ${findings.map((f) => `${f.id} [${f.kind}] ${f.title}`).join("; ") || "none"}`,
        `unverified claims: ${cites.map((c) => `${c.id}: "${c.claim.slice(0, 80)}"`).join("; ") || "none"}`,
      ].join("\n");
    },
  },
  {
    name: "list_social_posts",
    description: "Social posts with id, status, approval state, scheduled time and text.",
    args: { status: "optional: draft | scheduled | posted | failed", limit: "optional, default 15" },
    readOnly: true,
    async run(a, ctx) {
      const status = str(a.status, 20);
      const rows = await db.socialPost.findMany({ where: { workspaceId: ctx.workspaceId, ...(status ? { status } : {}) }, orderBy: { updatedAt: "desc" }, take: num(a.limit, 15, 40), include: { targets: { select: { provider: true, status: true } } } });
      return rows.length ? rows.map((p) => `${p.id} [${p.status}${p.approval ? `, approval ${p.approval}` : ""}]${p.scheduledAt ? ` at ${when(p.scheduledAt)}` : ""} → ${[...new Set(p.targets.map((t) => t.provider))].join(", ") || "no network"}: "${p.text.slice(0, 90)}"`).join("\n") : "no social posts match";
    },
  },
  {
    name: "list_keywords",
    description: "The keyword strategy: phrase, tier (1 head … 4 long-tail), intent, cluster.",
    args: { limit: "optional, default 30" },
    readOnly: true,
    async run(a, ctx) {
      const rows = await db.keyword.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: [{ tier: "asc" }, { phrase: "asc" }], take: num(a.limit, 30, 100) });
      return rows.length ? rows.map((k) => `${k.phrase} (tier ${k.tier}${k.intent ? `, ${k.intent}` : ""}${k.cluster ? `, ${k.cluster}` : ""})`).join("\n") : "no keywords yet — discover_keywords or add_keyword";
    },
  },
  {
    name: "list_topics",
    description: "The workspace's Topics (what the autopilot writes about) with id and status.",
    args: {},
    readOnly: true,
    async run(_a, ctx) {
      const rows = await db.topic.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: { name: "asc" }, select: { id: true, name: true, status: true, description: true } });
      return rows.length ? rows.map((t) => `${t.id} [${t.status}] ${t.name}${t.description ? ` — ${t.description.slice(0, 80)}` : ""}`).join("\n") : "no topics yet — add_topic";
    },
  },
  {
    name: "list_channels",
    description: "The workspace's YouTube channels with id and name.",
    args: {},
    readOnly: true,
    async run(_a, ctx) {
      const rows = await db.channel.findMany({ where: { workspaceId: ctx.workspaceId }, select: { id: true, name: true, linkedYoutubeHandle: true } });
      return rows.length ? rows.map((c) => `${c.id} ${c.name}${c.linkedYoutubeHandle ? ` (${c.linkedYoutubeHandle})` : ""}`).join("\n") : "no channels";
    },
  },
  {
    name: "list_outliers",
    description: "Research: competitor videos that beat their own channel's average (2× strong, 5× exceptional), with id, score, title and channel — the raw material for ideas.",
    args: { minScore: "optional, default 2", limit: "optional, default 10" },
    readOnly: true,
    async run(a, ctx) {
      const rows = await db.intelVideo.findMany({ where: { intelChannel: { workspaceId: ctx.workspaceId }, outlierScore: { gte: num(a.minScore, 2, 50) } }, orderBy: { outlierScore: "desc" }, take: num(a.limit, 10, 30), include: { intelChannel: { select: { name: true } } } });
      return rows.length ? rows.map((v) => `${v.id} ${v.outlierScore?.toFixed(1)}× "${v.title}" — ${v.intelChannel.name} (/intel/videos/${v.id})`).join("\n") : "no outliers indexed yet — add competitors under /intel";
    },
  },
  {
    name: "research_competitor",
    description: "Look a YouTube channel up by @handle or name so it can be indexed as a competitor. Returns what YouTube found and the Intel page where one click indexes it.",
    args: { handle: "an @handle, channel name or keyword" },
    readOnly: true,
    async run(a, ctx) {
      const handle = str(a.handle, 120);
      if (!handle) return "no handle given";
      const { youtubeFor } = await import("@/lib/youtube");
      const found = await youtubeFor(ctx.workspaceId).findChannel(handle).catch(() => null);
      if (!found) return `YouTube has no channel matching "${handle}"`;
      return `found: ${JSON.stringify(found).slice(0, 300)} — index it from /intel?q=${encodeURIComponent(handle)} (one click), then list_outliers shows its outliers as videos index.`;
    },
  },
  {
    name: "connections_status",
    description: "Settings → Connections as data: each thing the loop needs, connected / partly / missing, with the page that fixes it.",
    args: {},
    readOnly: true,
    async run(_a, ctx) {
      const { connectionRows } = await import("@/lib/setup-status");
      const rows = await connectionRows(ctx.workspaceId);
      return rows.map((r) => `${r.state.toUpperCase().padEnd(7)} ${r.label}: ${r.detail} → ${r.href}`).join("\n");
    },
  },
  {
    name: "settings_status",
    description: "The dials: full autonomy, function modes, weekly article target, publish day, social auto-dials, require approval, slots, timezone, video studio.",
    args: {},
    readOnly: true,
    async run(_a, ctx) {
      const [{ setupOverview }, { studioState }, { getSetting }] = await Promise.all([import("@/lib/setup-status"), import("@/lib/studio"), import("@/lib/settings")]);
      const [o, studio, evergreen, autogen, autogenWeekly, autoImage, autoSeo] = await Promise.all([
        setupOverview(ctx.workspaceId), studioState(ctx.workspaceId),
        getSetting("social:evergreen_fill", ctx.workspaceId).catch(() => ""), getSetting("social:autogen", ctx.workspaceId).catch(() => ""),
        getSetting("social:autogen_weekly", ctx.workspaceId).catch(() => ""), getSetting("social:auto_image", ctx.workspaceId).catch(() => ""), getSetting("blog:auto_seo", ctx.workspaceId).catch(() => ""),
      ]);
      const a = o.autonomy;
      return [
        `full autonomy: ${a.on ? "ON" : "off"} · global pause: ${o.paused ? "ON" : "off"}`,
        `modes: ${a.modes.map((m) => `${m.fn}=${m.mode}`).join(", ")}`,
        `articles per week: ${a.weeklyArticles} · publish day: ${o.publishDayLabel ?? "any"} · SEO on drafts: ${autoSeo === "false" ? "off" : "on"}`,
        `social: require approval ${a.requireApproval ? "on" : "off"} · queue on approval ${a.autoqueue ? "on" : "off"} · evergreen ${evergreen === "true" ? "on" : "off"} · auto-image ${autoImage === "false" ? "off" : "on"} · auto-generate ${autogen === "true" ? `${autogenWeekly || 5}/week` : "off"}`,
        `schedule: ${o.schedule.slotsPerWeek} slot(s)/week in ${o.schedule.timeZone}${o.schedule.timeZoneConfigured ? "" : " (not set — UTC)"}; next free ${o.schedule.nextFree ?? "none"}`,
        `people: ${o.members.admins} admin(s), ${o.members.editors} editor(s), ${o.members.viewers} viewer(s), ${o.invitations} pending invitation(s)`,
        `video studio: ${studio.show ? "shown" : studio.channels === 0 ? "hidden (no channel)" : "hidden (switched off)"}`,
      ].join("\n");
    },
  },
  {
    name: "results_summary",
    description: "Measure: search impressions and clicks by week, the tracked posts with positions and deltas, social engagement by network. Measured numbers only; a dash means not measured.",
    args: {},
    readOnly: true,
    async run(_a, ctx) {
      const [{ weeklySeries, postPerformance, hasSeriesData }, { readingsForWorkspace, byNetwork }] = await Promise.all([import("@/lib/dashboard-data"), import("@/lib/social/performance")]);
      const [series, perf, readings] = await Promise.all([weeklySeries(ctx.workspaceId, 8), postPerformance(ctx.workspaceId, 12), readingsForWorkspace(ctx.workspaceId, new Date(Date.now() - 30 * 86_400_000)).catch(() => [])]);
      const nets = byNetwork(readings as never);
      return [
        hasSeriesData(series) ? `weekly impressions/clicks: ${series.map((w) => `${w.label} ${w.impressions}/${w.clicks}`).join(", ")}` : "search analytics: not measured (connect Search Console + GA4 under /admin/analytics)",
        perf.length ? `posts: ${perf.map((p) => `"${p.title.slice(0, 40)}" pos ${p.position?.toFixed(1) ?? "—"}${p.prevPosition != null && p.position != null ? ` (${p.prevPosition - p.position >= 0 ? "▲" : "▼"}${Math.abs(p.prevPosition - p.position).toFixed(1)})` : ""} clicks ${p.clicks ?? "—"}`).join("; ")}` : "posts: none tracked yet",
        Array.isArray(nets) && nets.length ? `social by network: ${JSON.stringify(nets).slice(0, 400)}` : "social engagement: not measured yet",
      ].join("\n");
    },
  },
  {
    name: "list_reports",
    description: "The reports available under Measure → Reports, with their keys and links (a PDF is at /reports/<key>/pdf).",
    args: {},
    readOnly: true,
    async run(_a, ctx) {
      const { listReports } = await import("@/lib/report-defs");
      const rows = await listReports(ctx.workspaceId);
      return rows.map((r) => `${r.key}: ${r.name} — /reports/${r.key} (PDF /reports/${r.key}/pdf)`).join("\n");
    },
  },
  {
    name: "best_time",
    description: "Best time to post, measured from real engagement — refuses to guess below its sample size.",
    args: {},
    readOnly: true,
    async run(_a, ctx) {
      const { analyseBestTimes } = await import("@/lib/social/best-time");
      const r = await analyseBestTimes(ctx.workspaceId);
      if (r.reason) return `not enough data: ${r.reason}`;
      return `baseline ${r.baseline?.toFixed(2)}% across ${r.measured} posts; best: ${r.best.map((b) => `${b.label} (${b.ratio.toFixed(1)}×)`).join(", ") || "none beats baseline"}; not yet in the schedule: ${r.suggestions.map((s) => s.label).join(", ") || "none"}`;
    },
  },
  {
    name: "search_web",
    description: "Search the live web and return titles, urls and snippets. Use for facts you would otherwise guess. Returns nothing useful if the workspace has no search key.",
    args: { query: "the search query", limit: "optional, default 5" },
    readOnly: true,
    async run(a, ctx) {
      const query = str(a.query, 300);
      if (!query) return "no query given";
      const { getSearchProvider } = await import("@/lib/search");
      const { provider, real, vendor } = await getSearchProvider(ctx.workspaceId);
      const results = await provider.search(query, num(a.limit, 5, 10));
      if (!real) return `NO REAL SEARCH KEY — these results are placeholders from the ${vendor} mock and must not be treated as facts.`;
      return results.map((r, i) => `${i + 1}. ${r.title} — ${r.url}\n   ${r.snippet}`).join("\n") || "no results";
    },
  },

  // ── Ideas, keywords, topics ───────────────────────────────────────────────
  {
    name: "add_idea",
    description: "Add one idea the person described — an article idea (default) or a video idea on a channel. Lands as discovered on the Ideas board.",
    args: { title: "the idea's title", format: "optional: article (default) | video", channelId: "video only: the channel id", angle: "optional: the hook / why it works", keyword: "optional focus keyword (articles)", topicId: "optional topic id" },
    async run(a, ctx) {
      const title = str(a.title, 200);
      if (!title) return "refused: an idea needs a title";
      const topicId = str(a.topicId, 40) ? (await db.topic.findFirst({ where: { id: str(a.topicId, 40), workspaceId: ctx.workspaceId }, select: { id: true } }))?.id ?? null : null;
      if (str(a.format, 10) === "video") {
        const channelId = str(a.channelId, 40);
        const ch = await db.channel.findFirst({ where: { id: channelId, workspaceId: ctx.workspaceId }, select: { id: true, name: true } });
        if (!ch) return "refused: a video idea needs a channelId from list_channels";
        const idea = await db.idea.create({ data: { channelId: ch.id, title, strategy: str(a.angle, 500) || null, topicId, status: "new" } });
        return `added video idea ${idea.id} ("${title}") on ${ch.name}, discovered — approve_video_idea or write_script next. Board: /ideas?channel=${ch.id}`;
      }
      const idea = await db.blogIdea.create({ data: { workspaceId: ctx.workspaceId, title, angle: str(a.angle, 500) || null, keyword: str(a.keyword, 100) || null, topicId, source: "manual" } });
      return `added article idea ${idea.id} ("${title}"), discovered — approve_idea then draft_article, or draft_article straight away. Board: /ideas`;
    },
  },
  {
    name: "approve_idea",
    description: "Approve an article idea (the autopilot drafts approved ideas on its weekly target).",
    args: { ideaId: "the idea id" },
    async run(a, ctx) {
      const id = str(a.ideaId, 40);
      const r = await db.blogIdea.updateMany({ where: { id, workspaceId: ctx.workspaceId, status: { in: ["discovered", "rejected"] } }, data: { status: "approved" } });
      return r.count ? `idea ${id} approved — it is next in line for the autopilot, or draft_article now` : "nothing changed (no such idea, or it is already approved / drafted)";
    },
  },
  {
    name: "reject_idea",
    description: "Reject an article idea so it stops coming back.",
    args: { ideaId: "the idea id" },
    async run(a, ctx) {
      const id = str(a.ideaId, 40);
      const r = await db.blogIdea.updateMany({ where: { id, workspaceId: ctx.workspaceId, status: { in: ["discovered", "approved"] } }, data: { status: "rejected" } });
      return r.count ? `idea ${id} rejected` : "nothing changed (no such idea, or it is already drafted)";
    },
  },
  {
    name: "approve_video_idea",
    description: "Approve (or archive) a video idea.",
    args: { ideaId: "the video idea id", status: "approved (default) | archived" },
    async run(a, ctx) {
      const id = str(a.ideaId, 40);
      const status = str(a.status, 20) === "archived" ? "archived" : "approved";
      const r = await db.idea.updateMany({ where: { id, channel: { workspaceId: ctx.workspaceId } }, data: { status } });
      return r.count ? `video idea ${id} is now ${status}` : "no such video idea";
    },
  },
  {
    name: "discover_ideas",
    description: "Generate new article ideas grounded in the workspace profile, topics and keywords. They land as discovered for approval.",
    args: { topicId: "optional topic id to focus on" },
    async run(a, ctx) {
      const { discoverIdeasCore } = await import("@/lib/blog-autopilot");
      const created = await discoverIdeasCore(ctx.workspaceId, str(a.topicId, 40) || null);
      return created ? `created ${created} idea(s), all discovered — list_ideas to see them, approve_idea for the good ones` : "created nothing (the model returned no usable ideas, or generation is paused)";
    },
  },
  {
    name: "generate_video_ideas",
    description: "Queue the channel's idea pipeline to generate ten video ideas (runs in the background; a minute or two).",
    args: { channelId: "the channel id" },
    async run(a, ctx) {
      const ch = await db.channel.findFirst({ where: { id: str(a.channelId, 40), workspaceId: ctx.workspaceId }, select: { id: true } });
      if (!ch) return "refused: no such channel";
      const { jobs } = await import("@/lib/jobs");
      await jobs.enqueue("onboarding.ideas", { channelId: ch.id }, { refId: ch.id, workspaceId: ctx.workspaceId });
      return `queued — ten video ideas will appear on /ideas?channel=${ch.id} within a couple of minutes`;
    },
  },
  {
    name: "rescore_ideas",
    description: "Recompute article-idea priorities from the keyword strategy, page map and published archive.",
    args: {},
    async run(_a, ctx) {
      const { rescoreIdeas } = await import("@/lib/blog-idea-scoring");
      await rescoreIdeas(ctx.workspaceId);
      return "priorities recomputed — list_ideas shows the new order";
    },
  },
  {
    name: "add_keyword",
    description: "Add a keyword to the strategy (tier 1 head term … 4 long-tail). Drives idea priority.",
    args: { phrase: "the keyword phrase", tier: "optional 1-4, default 3", cluster: "optional topical cluster name" },
    async run(a, ctx) {
      const phrase = str(a.phrase, 120).toLowerCase();
      if (!phrase) return "refused: no phrase";
      const tier = Math.min(4, Math.max(1, num(a.tier, 3, 4)));
      await db.keyword.upsert({ where: { workspaceId_phrase: { workspaceId: ctx.workspaceId, phrase } }, update: { tier }, create: { workspaceId: ctx.workspaceId, phrase, tier, cluster: str(a.cluster, 60) || null } });
      return `keyword "${phrase}" saved at tier ${tier} — /blog/keywords`;
    },
  },
  {
    name: "discover_keywords",
    description: "Have the strategist propose keywords (tier, intent, cluster) from the organisation profile; they are added to the strategy.",
    args: {},
    async run(_a, ctx) {
      const before = await db.keyword.count({ where: { workspaceId: ctx.workspaceId } });
      const { discoverKeywordsAction } = await import("@/app/actions/blog-keywords");
      await discoverKeywordsAction();
      const after = await db.keyword.count({ where: { workspaceId: ctx.workspaceId } });
      return `keywords: ${before} → ${after} (list_keywords to see them; /blog/keywords)`;
    },
  },
  {
    name: "add_topic",
    description: "Add a Topic — what the autopilot writes about.",
    args: { name: "the topic name", description: "optional one-line description" },
    async run(a, ctx) {
      const name = str(a.name, 80);
      if (!name) return "refused: no name";
      const t = await db.topic.create({ data: { workspaceId: ctx.workspaceId, name, description: str(a.description, 300) || null } });
      return `topic ${t.id} "${name}" added (active) — ideas can now be focused on it`;
    },
  },

  // ── Drafts ────────────────────────────────────────────────────────────────
  {
    name: "draft_article",
    description: "Write a full grounded article from an existing idea (or from a title you pass), then give it images and SEO and park it at review. A minute or two. Never publishes.",
    args: { ideaId: "id of the idea to draft (preferred)", title: "or a title, if there is no idea yet", keyword: "optional focus keyword when drafting from a title" },
    async run(a, ctx) {
      let idea = str(a.ideaId, 40) ? await db.blogIdea.findFirst({ where: { id: str(a.ideaId, 40), workspaceId: ctx.workspaceId } }) : null;
      if (!idea && str(a.title, 200)) idea = await db.blogIdea.create({ data: { workspaceId: ctx.workspaceId, title: str(a.title, 200), keyword: str(a.keyword, 100) || null, source: "manual", status: "approved" } });
      if (!idea) return "refused: give an ideaId (list_ideas) or a title";
      if (idea.status === "drafted" && idea.postId) return `that idea was already drafted as article ${idea.postId} (/blog/${idea.postId})`;
      const post = await db.blogPost.create({ data: { workspaceId: ctx.workspaceId, title: idea.title, focusKeyword: idea.keyword, topicId: idea.topicId, status: "drafting", createdById: ctx.userId } });
      await db.blogIdea.update({ where: { id: idea.id }, data: { status: "drafted", postId: post.id } });
      const { generateDraftCore, completeFreshDraftCore } = await import("@/lib/blog-autopilot");
      const ok = await generateDraftCore(ctx.workspaceId, post.id);
      if (!ok) return `article ${post.id} was created but drafting failed (paused, or the model returned nothing) — it sits at drafting (/blog/${post.id})`;
      const done = await completeFreshDraftCore(ctx.workspaceId, post.id);
      return `drafted article ${post.id} ("${idea.title}") — at draft_review, ${done.imagesGenerated} image(s) generated, SEO ${done.seoOptimized ? "written" : "unchanged"}. Auto-review takes it from here; article_checks says what is left. /blog/${post.id}`;
    },
  },
  {
    name: "generate_seo",
    description: "Fill an article's meta title, description and slug. Fill-only: never overwrites values a person wrote.",
    args: { articleId: "the article id" },
    async run(a, ctx) {
      const post = await db.blogPost.findFirst({ where: { id: str(a.articleId, 40), workspaceId: ctx.workspaceId }, select: { id: true } });
      if (!post) return "refused: no such article";
      const { generateSeoMetaCore } = await import("@/lib/blog-seo");
      const res = await generateSeoMetaCore(ctx.workspaceId, post.id, { onlyFillEmpty: true });
      return res.ok ? `wrote SEO metadata for ${post.id}` : `no metadata written (${res.reason ?? "unknown reason"})`;
    },
  },
  {
    name: "generate_images",
    description: "Generate the featured and Open Graph images for an article. They land pending for approval; a person's own images are never replaced.",
    args: { articleId: "the article id" },
    async run(a, ctx) {
      const post = await db.blogPost.findFirst({ where: { id: str(a.articleId, 40), workspaceId: ctx.workspaceId }, select: { id: true } });
      if (!post) return "refused: no such article";
      const { generateBlogImagesCore } = await import("@/lib/blog-images");
      const made = await generateBlogImagesCore(ctx.workspaceId, post.id);
      return made ? `generated ${made} image(s) for ${post.id}, pending approval (auto-review looks at them on the next sweep, or approve_image now)` : "generated nothing (AI images are off, or a person already owns both images)";
    },
  },
  {
    name: "set_article_fields",
    description: "Set an article's title, meta title, meta description, slug or focus keyword by hand — for when the person tells you the wording.",
    args: { articleId: "the article id", title: "optional", metaTitle: "optional", metaDescription: "optional", slug: "optional", focusKeyword: "optional" },
    async run(a, ctx) {
      const post = await db.blogPost.findFirst({ where: { id: str(a.articleId, 40), workspaceId: ctx.workspaceId }, select: { id: true } });
      if (!post) return "refused: no such article";
      const data: Record<string, string> = {};
      for (const k of ["title", "metaTitle", "metaDescription", "slug", "focusKeyword"] as const) { const v = str(a[k], 300); if (v) data[k] = k === "slug" ? v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") : v; }
      if (!Object.keys(data).length) return "nothing to set";
      await db.blogPost.update({ where: { id: post.id }, data });
      return `updated ${Object.keys(data).join(", ")} on ${post.id}`;
    },
  },
  {
    name: "generate_findings",
    description: "Run the Optimize analysis (E-E-A-T, entity coverage, content gaps) on an article; mechanical findings can then be applied, knowledge ones answered.",
    args: { articleId: "the article id" },
    async run(a, ctx) {
      const post = await db.blogPost.findFirst({ where: { id: str(a.articleId, 40), workspaceId: ctx.workspaceId }, select: { id: true } });
      if (!post) return "refused: no such article";
      const { generateFindingsCore } = await import("@/lib/blog-findings");
      const r = await generateFindingsCore(ctx.workspaceId, post.id, { via: "assistant" });
      return `created ${r.created} finding(s); ran ${r.ran.join(", ") || "nothing"}${r.skipped.length ? `; skipped ${r.skipped.map((s) => `${s.source} (${s.why})`).join(", ")}` : ""} — article_checks lists the open ones`;
    },
  },
  {
    name: "apply_finding",
    description: "Apply a mechanical finding to the article (weaves the change into the body).",
    args: { findingId: "the finding id" },
    async run(a, ctx) {
      const { applyFindingCore } = await import("@/lib/blog-findings");
      const r = await applyFindingCore(ctx.workspaceId, str(a.findingId, 40), { actorId: ctx.userId, via: "editor" });
      return r.ok ? "applied" : `not applied: ${r.reason}`;
    },
  },
  {
    name: "answer_finding",
    description: "Answer a knowledge question on the person's behalf WITH THEIR WORDS (ask them first if you don't have the answer); it is woven in and banked to the Experts profile. Then the article advances if that was the last thing holding it.",
    args: { findingId: "the finding id", answers: "the answers, one per question, separated by ' || '" },
    async run(a, ctx) {
      const answers = str(a.answers, 4000).split("||").map((s) => s.trim()).filter(Boolean);
      if (!answers.length) return "refused: no answers given — ask the person";
      const f = await db.blogFinding.findFirst({ where: { id: str(a.findingId, 40), workspaceId: ctx.workspaceId }, select: { id: true, postId: true } });
      if (!f) return "no such finding";
      const [{ answerFindingCore }, { advanceIfReadyCore }] = await Promise.all([import("@/lib/blog-findings"), import("@/lib/blog-gates")]);
      const u = await db.user.findUnique({ where: { id: ctx.userId }, select: { id: true, name: true, email: true } });
      await answerFindingCore(ctx.workspaceId, f.id, answers, { id: ctx.userId, name: u?.name ?? null, email: u?.email ?? "" });
      const moved = await advanceIfReadyCore(ctx.workspaceId, f.postId, "answered a question (assistant)");
      return `answered and woven in${moved ? "; the article advanced to final approval" : ""}`;
    },
  },
  {
    name: "dismiss_finding",
    description: "Dismiss a finding the person does not want (with their reason). The article advances if that was the last thing holding it.",
    args: { findingId: "the finding id", reason: "optional reason" },
    async run(a, ctx) {
      const f = await db.blogFinding.findFirst({ where: { id: str(a.findingId, 40), workspaceId: ctx.workspaceId }, select: { id: true, postId: true } });
      if (!f) return "no such finding";
      const [{ dismissFindingCore }, { advanceIfReadyCore }] = await Promise.all([import("@/lib/blog-findings"), import("@/lib/blog-gates")]);
      await dismissFindingCore(ctx.workspaceId, f.id, ctx.userId, str(a.reason, 300));
      const moved = await advanceIfReadyCore(ctx.workspaceId, f.postId, "dismissed a question (assistant)");
      return `dismissed${moved ? "; the article advanced to final approval" : ""}`;
    },
  },
  {
    name: "write_script",
    description: "Turn a video idea into a script on the canvas (creates the script and its planning chat).",
    args: { ideaId: "the video idea id" },
    async run(a, ctx) {
      const idea = await db.idea.findFirst({ where: { id: str(a.ideaId, 40), channel: { workspaceId: ctx.workspaceId } }, include: { channel: true } });
      if (!idea) return "no such video idea";
      const script = await db.script.create({ data: { channelId: idea.channelId, ideaId: idea.id, authorId: ctx.userId, title: idea.title, workflow: "canvas", language: idea.channel.defaultLanguage, templateId: idea.channel.defaultTemplateId, model: idea.channel.defaultModel } });
      await db.chat.create({ data: { channelId: idea.channelId, userId: ctx.userId, type: "canvas", scriptId: script.id, title: idea.title, messages: { create: { role: "assistant", content: `Pulled from idea: **${idea.title}**\n${idea.strategy ? `\nStrategy: ${idea.strategy}` : ""}\n\nWhen you're ready, head to the Plan tab, answer the planning questions, and generate an outline.` } } } });
      await db.idea.update({ where: { id: idea.id }, data: { status: "in_progress" } });
      return `script ${script.id} created on the canvas — /scripts/${script.id}`;
    },
  },

  // ── Review ────────────────────────────────────────────────────────────────
  {
    name: "approve_image",
    description: "Approve a pending article image — the person has looked at it. The article advances if that was the last thing holding it.",
    args: { imageId: "the image id" },
    confirm: true,
    async run(a, ctx) {
      const img = await db.blogImage.findFirst({ where: { id: str(a.imageId, 40), post: { workspaceId: ctx.workspaceId } } });
      if (!img) return "no such image";
      await db.blogImage.update({ where: { id: img.id }, data: { status: "approved" } });
      await writeAudit({ workspaceId: ctx.workspaceId, actorId: ctx.userId, action: "blog.image_approved", entityType: "blog_image", entityId: img.id, meta: { role: img.role, source: img.source, via: "assistant" } });
      const { advanceIfReadyCore } = await import("@/lib/blog-gates");
      const moved = await advanceIfReadyCore(ctx.workspaceId, img.postId, "approved an image (assistant)");
      return `approved the ${img.role} image${moved ? "; the article advanced to final approval" : ""}`;
    },
  },
  {
    name: "verify_claim",
    description: "Verify a claim against a source URL the person vouches for (or one search_web found that genuinely supports it). The article advances if that was the last thing holding it.",
    args: { citationId: "the citation id", sourceUrl: "https://… a source that actually supports the claim" },
    confirm: true,
    async run(a, ctx) {
      const url = str(a.sourceUrl, 500);
      if (!/^https?:\/\//i.test(url)) return "refused: a real http(s) URL is required";
      const cit = await db.blogCitation.findFirst({ where: { id: str(a.citationId, 40), post: { workspaceId: ctx.workspaceId } } });
      if (!cit) return "no such citation";
      await db.blogCitation.update({ where: { id: cit.id }, data: { verified: true, sourceUrl: url } });
      await writeAudit({ workspaceId: ctx.workspaceId, actorId: ctx.userId, action: "blog.citation_verified", entityType: "blog_post", entityId: cit.postId, meta: { citationId: cit.id, sourceUrl: url, via: "assistant" } });
      const { advanceIfReadyCore } = await import("@/lib/blog-gates");
      const moved = await advanceIfReadyCore(ctx.workspaceId, cit.postId, "verified a claim (assistant)");
      return `verified${moved ? "; the article advanced to final approval" : ""}`;
    },
  },
  {
    name: "drop_claim",
    description: "Drop a claim: removes its [NEEDS SOURCE] marker and record; the sentence stays. The article advances if that was the last thing holding it.",
    args: { citationId: "the citation id" },
    confirm: true,
    async run(a, ctx) {
      const cit = await db.blogCitation.findFirst({ where: { id: str(a.citationId, 40), post: { workspaceId: ctx.workspaceId } } });
      if (!cit) return "no such citation";
      await db.blogCitation.delete({ where: { id: cit.id } });
      const [{ removeMarkerForClaim }, { advanceIfReadyCore }] = await Promise.all([import("@/lib/blog-autoreview"), import("@/lib/blog-gates")]);
      const markerRemoved = await removeMarkerForClaim(cit.postId, cit.claim);
      await writeAudit({ workspaceId: ctx.workspaceId, actorId: ctx.userId, action: "blog.citation_dropped", entityType: "blog_post", entityId: cit.postId, meta: { citationId: cit.id, claim: cit.claim.slice(0, 200), markerRemoved, via: "assistant" } });
      const moved = await advanceIfReadyCore(ctx.workspaceId, cit.postId, "dropped a claim (assistant)");
      return `dropped${moved ? "; the article advanced to final approval" : ""}`;
    },
  },
  {
    name: "advance_article",
    description: "Move an article at review to final approval if its required checks pass; otherwise reports what is failing (then fix it, or override_gate).",
    args: { articleId: "the article id" },
    async run(a, ctx) {
      const id = str(a.articleId, 40);
      const { advanceIfReadyCore } = await import("@/lib/blog-gates");
      const moved = await advanceIfReadyCore(ctx.workspaceId, id, "advance requested (assistant)");
      if (moved) return `article ${id} advanced to final approval`;
      const checks = await TOOLS_BY_NAME.get("article_checks")!.run({ articleId: id }, ctx);
      return `not advanced — it is not at review, or checks fail:\n${checks}`;
    },
  },
  {
    name: "override_gate",
    description: "Admin override: move a held article to final approval despite failing checks ('Advance anyway'). Recorded with the person's name and reason; carries through publishing.",
    args: { articleId: "the article id", reason: "why (recorded)" },
    confirm: true,
    minRole: "ADMIN",
    async run(a, ctx) {
      const { overrideGateCore } = await import("@/lib/blog-gates");
      const r = await overrideGateCore(ctx.workspaceId, str(a.articleId, 40), ctx.userId, str(a.reason, 300));
      if (!r) return "no such article";
      return `override recorded (overrode: ${r.failing.join("; ") || "nothing was failing"})${r.moved ? "; advanced to final approval" : "; the article was not at review, so nothing moved"}`;
    },
  },
  {
    name: "approve_social_post",
    description: "Admin: approve a social post that is awaiting approval. With queue-on-approval on it takes the next free slot; otherwise it becomes an approved draft to queue.",
    args: { postId: "the social post id" },
    confirm: true,
    minRole: "ADMIN",
    async run(a, ctx) {
      const post = await db.socialPost.findFirst({ where: { id: str(a.postId, 40), workspaceId: ctx.workspaceId } });
      if (!post) return "no such post";
      if (post.approval !== "pending" && post.approval !== "changes") return "that post is not waiting for approval";
      const scheduleIt = !!post.scheduledAt && post.scheduledAt.getTime() > Date.now() - 60_000;
      let queuedAt: Date | null = null;
      if (!scheduleIt) {
        const { getSetting } = await import("@/lib/settings");
        if ((await getSetting("social:autoqueue", ctx.workspaceId).catch(() => "")) === "true") {
          const { nextFreeSlot } = await import("@/lib/social/slots");
          queuedAt = await nextFreeSlot(ctx.workspaceId, post.id, post.category);
        }
      }
      await db.socialPost.update({ where: { id: post.id }, data: { approval: "approved", approvedById: ctx.userId, approvedAt: new Date(), reviewNote: null, ...(queuedAt ? { scheduledAt: queuedAt } : {}), status: scheduleIt || queuedAt ? "scheduled" : "draft" } });
      await writeAudit({ workspaceId: ctx.workspaceId, actorId: ctx.userId, action: "social.approved", entityType: "social_post", entityId: post.id, meta: { via: "assistant", ...(queuedAt ? { autoQueuedAt: queuedAt.toISOString() } : {}) } });
      return scheduleIt ? "approved — it keeps its scheduled time" : queuedAt ? `approved and queued for ${when(queuedAt)}` : "approved — it is a draft; queue_social_post or send_social_post_now next";
    },
  },
  {
    name: "request_changes_social_post",
    description: "Admin: send a social post back to its author with a note.",
    args: { postId: "the social post id", note: "what to change" },
    minRole: "ADMIN",
    async run(a, ctx) {
      const post = await db.socialPost.findFirst({ where: { id: str(a.postId, 40), workspaceId: ctx.workspaceId } });
      if (!post) return "no such post";
      if (post.approval !== "pending") return "that post is not waiting for approval";
      const note = str(a.note, 500);
      await db.socialPost.update({ where: { id: post.id }, data: { approval: "changes", reviewNote: note || null, status: "draft" } });
      await writeAudit({ workspaceId: ctx.workspaceId, actorId: ctx.userId, action: "social.changes_requested", entityType: "social_post", entityId: post.id, meta: { note, via: "assistant" } });
      return "changes requested — the author sees the note on the post";
    },
  },

  // ── Publish ───────────────────────────────────────────────────────────────
  {
    name: "publish_article",
    description: "Admin: publish an article at final approval to WordPress now (ahead of the publish day). Needs a WordPress connection; otherwise use export_html_link and mark_published.",
    args: { articleId: "the article id" },
    confirm: true,
    minRole: "ADMIN",
    async run(a, ctx) {
      const post = await db.blogPost.findFirst({ where: { id: str(a.articleId, 40), workspaceId: ctx.workspaceId }, select: { id: true, status: true, title: true } });
      if (!post) return "no such article";
      if (post.status !== "final_approval") return `not at final approval (it is ${post.status}) — advance_article first`;
      const conn = await db.wordPressConnection.findUnique({ where: { workspaceId: ctx.workspaceId }, select: { id: true } });
      if (!conn) return "no WordPress connection — export_html_link then mark_published instead, or connect under /website";
      const { publishCore } = await import("@/lib/blog-autopilot");
      const ok = await publishCore(ctx.workspaceId, post.id).catch((e) => { throw e; });
      const after = await db.blogPost.findUnique({ where: { id: post.id }, select: { publishedUrl: true, status: true } });
      return ok ? `published "${post.title}" — ${after?.publishedUrl ?? "live"}` : `WordPress did not accept it; the article stays at ${after?.status}. Check /website.`;
    },
  },
  {
    name: "mark_published",
    description: "Admin: record an article at final approval as published by hand (after adding its HTML to a site), with the live URL.",
    args: { articleId: "the article id", url: "optional live URL" },
    confirm: true,
    minRole: "ADMIN",
    async run(a, ctx) {
      const post = await db.blogPost.findFirst({ where: { id: str(a.articleId, 40), workspaceId: ctx.workspaceId }, select: { id: true, status: true, title: true } });
      if (!post) return "no such article";
      if (post.status !== "final_approval") return `not at final approval (it is ${post.status})`;
      const raw = str(a.url, 500);
      let url: string | null = null;
      if (raw) { try { const u = new URL(raw); if (u.protocol === "http:" || u.protocol === "https:") url = u.toString(); } catch { /* ignore */ } if (!url) return "that live URL is not a web address"; }
      await db.blogPost.update({ where: { id: post.id }, data: { status: "published", publishedAt: new Date(), publishedUrl: url } });
      await writeAudit({ workspaceId: ctx.workspaceId, actorId: ctx.userId, action: "blog.published_manually", entityType: "blog_post", entityId: post.id, meta: { publishedUrl: url, via: "assistant" } });
      return `recorded "${post.title}" as published${url ? ` at ${url}` : ""}`;
    },
  },
  {
    name: "export_html_link",
    description: "The download link for an article's self-contained HTML (images embedded) — add ?fragment=1 for just the body.",
    args: { articleId: "the article id" },
    readOnly: true,
    async run(a, ctx) {
      const post = await db.blogPost.findFirst({ where: { id: str(a.articleId, 40), workspaceId: ctx.workspaceId }, select: { id: true, title: true } });
      if (!post) return "no such article";
      return `/blog/${post.id}/export (full page) · /blog/${post.id}/export?fragment=1 (body only) — "${post.title}"`;
    },
  },
  {
    name: "schedule_article",
    description: "Set the date an article at final approval publishes (honoured over the publish day), or clear it.",
    args: { articleId: "the article id", at: "ISO date-time, or 'clear'" },
    confirm: true,
    async run(a, ctx) {
      const post = await db.blogPost.findFirst({ where: { id: str(a.articleId, 40), workspaceId: ctx.workspaceId }, select: { id: true } });
      if (!post) return "no such article";
      const raw = str(a.at, 40);
      if (raw === "clear") { await db.blogPost.update({ where: { id: post.id }, data: { scheduledAt: null } }); return "publish date cleared — the publish day rules again"; }
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return "that is not a valid date-time";
      await db.blogPost.update({ where: { id: post.id }, data: { scheduledAt: d } });
      return `set to publish at ${when(d)}`;
    },
  },
  {
    name: "set_publish_day",
    description: "Admin: the weekday articles auto-publish on (0 Sunday … 6 Saturday, or 'any').",
    args: { day: "0-6 or any" },
    confirm: true,
    minRole: "ADMIN",
    async run(a, ctx) {
      const raw = str(a.day, 10).toLowerCase();
      const { setWorkspaceSetting } = await import("@/lib/settings");
      if (raw === "any" || raw === "") { await setWorkspaceSetting(ctx.workspaceId, "autopilot:publish_day", ""); return "publish day cleared — any day"; }
      const d = DAY.findIndex((n) => n.toLowerCase().startsWith(raw.slice(0, 3)));
      const day = /^[0-6]$/.test(raw) ? Number(raw) : d;
      if (day < 0) return "give 0-6, a weekday name, or any";
      await setWorkspaceSetting(ctx.workspaceId, "autopilot:publish_day", String(day));
      await writeAudit({ workspaceId: ctx.workspaceId, actorId: ctx.userId, action: "settings.saved", entityType: "setting", entityId: "autopilot:publish_day", meta: { value: day, via: "assistant" } });
      return `articles now publish on ${DAY[day]}s`;
    },
  },

  // ── Distribute ────────────────────────────────────────────────────────────
  {
    name: "draft_social_post",
    description: "Write a social post as a draft (from an article or a brief), optionally aimed at networks by name. Lands as a draft; queue_social_post, schedule_social_post or send_social_post_now moves it.",
    args: { text: "the post text (write it yourself, in the brand's voice)", networks: "optional comma-separated network names the workspace has connected (e.g. linkedin, x, facebook)" },
    async run(a, ctx) {
      const text = str(a.text, 3000);
      if (!text) return "refused: write the text";
      const wanted = str(a.networks, 200).toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
      const accounts = await db.zernioAccount.findMany({ where: { workspaceId: ctx.workspaceId, status: "connected" }, select: { id: true, platform: true } });
      const targets = (wanted.length ? accounts.filter((x) => wanted.some((w) => x.platform.toLowerCase().includes(w))) : accounts).map((x) => ({ provider: x.platform, accountId: x.id }));
      const { getSetting } = await import("@/lib/settings");
      const requireApproval = (await getSetting("social:require_approval", ctx.workspaceId).catch(() => "")) === "true";
      const held = requireApproval && ctx.role !== "ADMIN";
      const post = await db.socialPost.create({ data: { workspaceId: ctx.workspaceId, text, status: "draft", approval: requireApproval ? (held ? "pending" : "approved") : null, createdById: ctx.userId, targets: { create: targets } } });
      await writeAudit({ workspaceId: ctx.workspaceId, actorId: ctx.userId, action: "social.drafted", entityType: "social_post", entityId: post.id, meta: { via: "assistant", networks: targets.map((t) => t.provider) } });
      return `drafted social post ${post.id} for ${targets.map((t) => t.provider).join(", ") || "no network yet (connect accounts)"}${held ? " — held for an admin's approval" : ""}. /social/${post.id}/edit`;
    },
  },
  {
    name: "queue_social_post",
    description: "Queue a draft into the next free posting slot.",
    args: { postId: "the social post id" },
    confirm: true,
    async run(a, ctx) {
      const post = await db.socialPost.findFirst({ where: { id: str(a.postId, 40), workspaceId: ctx.workspaceId }, select: { id: true, status: true, approval: true, category: true } });
      if (!post) return "no such post";
      if (post.status !== "draft" && post.status !== "scheduled") return "only unsent posts can be queued";
      if (post.approval === "pending") return "awaiting approval — approve_social_post first (admin)";
      if (post.approval === "changes") return "changes were requested — edit and resubmit first";
      const { claimNextFreeSlot, queueFailureMessage, formatInZone, getPostingTimeZone } = await import("@/lib/social/slots");
      const claim = await claimNextFreeSlot(ctx.workspaceId, post.id, post.category);
      if ("error" in claim) return queueFailureMessage(claim.error);
      await db.socialPost.update({ where: { id: post.id }, data: { scheduledAt: claim.at, status: "scheduled" } });
      return `queued for ${formatInZone(claim.at, await getPostingTimeZone(ctx.workspaceId))}`;
    },
  },
  {
    name: "schedule_social_post",
    description: "Schedule a post for a specific time (ISO date-time in UTC, or 'YYYY-MM-DD HH:MM' in the workspace timezone).",
    args: { postId: "the social post id", at: "when" },
    confirm: true,
    async run(a, ctx) {
      const post = await db.socialPost.findFirst({ where: { id: str(a.postId, 40), workspaceId: ctx.workspaceId }, select: { id: true, status: true, approval: true } });
      if (!post) return "no such post";
      if (post.status !== "draft" && post.status !== "scheduled") return "only unsent posts can be moved";
      if (post.approval === "pending" || post.approval === "changes") return "not approved yet";
      const raw = str(a.at, 40);
      const d = new Date(raw.includes("T") || raw.endsWith("Z") ? raw : raw.replace(" ", "T") + "Z");
      if (Number.isNaN(d.getTime()) || d.getTime() < Date.now() - 60_000) return "that time is invalid or already passed";
      await db.socialPost.update({ where: { id: post.id }, data: { scheduledAt: d, status: "scheduled" } });
      return `scheduled for ${when(d)}`;
    },
  },
  {
    name: "send_social_post_now",
    description: "Admin: send a post to its networks right now.",
    args: { postId: "the social post id" },
    confirm: true,
    minRole: "ADMIN",
    async run(a, ctx) {
      const post = await db.socialPost.findFirst({ where: { id: str(a.postId, 40), workspaceId: ctx.workspaceId }, include: { targets: true } });
      if (!post) return "no such post";
      if (post.status === "posted") return "already sent";
      if (post.approval === "pending" || post.approval === "changes") return "not approved yet";
      if (!post.targets.length) return "no networks on this post";
      const { publishSocialPost } = await import("@/lib/social/publish");
      await publishSocialPost(post.id);
      const after = await db.socialPost.findUnique({ where: { id: post.id }, include: { targets: { select: { provider: true, status: true } } } });
      return `sent — ${after?.targets.map((t) => `${t.provider}: ${t.status}`).join(", ")}`;
    },
  },
  {
    name: "unschedule_social_post",
    description: "Take a scheduled post back to draft.",
    args: { postId: "the social post id" },
    confirm: true,
    async run(a, ctx) {
      const r = await db.socialPost.updateMany({ where: { id: str(a.postId, 40), workspaceId: ctx.workspaceId, status: "scheduled" }, data: { status: "draft", scheduledAt: null } });
      return r.count ? "back to draft" : "nothing changed (not scheduled)";
    },
  },
  {
    name: "add_posting_slots",
    description: "Admin: add a recurring posting slot (HH:MM in the workspace timezone) on weekdays (0 Sunday … 6 Saturday).",
    args: { time: "HH:MM", weekdays: "comma-separated weekday numbers, e.g. 2,5", category: "optional slot category" },
    confirm: true,
    minRole: "ADMIN",
    async run(a, ctx) {
      const { parseMinute } = await import("@/lib/social/slots");
      const minute = parseMinute(str(a.time, 5));
      if (minute === null) return "time must be HH:MM";
      const weekdays = [...new Set(str(a.weekdays, 40).split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))];
      if (!weekdays.length) return "give at least one weekday 0-6";
      const { count } = await db.postingSlot.createMany({ data: weekdays.map((weekday) => ({ workspaceId: ctx.workspaceId, weekday, minute, category: str(a.category, 40) || null })), skipDuplicates: true });
      return count ? `added ${count} slot(s) at ${str(a.time, 5)} on ${weekdays.map((d) => DAY[d]).join(", ")}` : "those slots already exist";
    },
  },
  {
    name: "set_timezone",
    description: "Admin: the workspace's posting timezone (an IANA name like America/New_York).",
    args: { timezone: "IANA timezone" },
    confirm: true,
    minRole: "ADMIN",
    async run(a, ctx) {
      const { isValidTimeZone } = await import("@/lib/social/slots");
      const tz = str(a.timezone, 60);
      if (!isValidTimeZone(tz)) return "not a recognised timezone";
      const { setWorkspaceSetting } = await import("@/lib/settings");
      await setWorkspaceSetting(ctx.workspaceId, "social:timezone", tz);
      return `posting times are now read in ${tz}`;
    },
  },
  {
    name: "sync_performance",
    description: "Pull social engagement now instead of waiting for the sweep.",
    args: {},
    async run(_a, ctx) {
      const { syncWorkspaceSocialPerformance } = await import("@/lib/social/performance");
      const r = await syncWorkspaceSocialPerformance(ctx.workspaceId);
      return `synced: ${JSON.stringify(r).slice(0, 200)}`;
    },
  },

  // ── Settings (admin, confirmed) ───────────────────────────────────────────
  {
    name: "set_weekly_articles",
    description: "Admin: the weekly article target (0 clears the cap).",
    args: { count: "0-50" },
    confirm: true,
    minRole: "ADMIN",
    async run(a, ctx) {
      const n = Math.max(0, Math.min(50, parseInt(String(a.count ?? ""), 10) || 0));
      const { setWorkspaceSetting } = await import("@/lib/settings");
      await setWorkspaceSetting(ctx.workspaceId, "autopilot:weekly_articles", n ? String(n) : "");
      await writeAudit({ workspaceId: ctx.workspaceId, actorId: ctx.userId, action: "settings.saved", entityType: "setting", entityId: "autopilot:weekly_articles", meta: { value: n, via: "assistant" } });
      return n ? `${n} article(s) a week` : "no weekly cap";
    },
  },
  {
    name: "set_function_mode",
    description: "Admin: a function's mode — ideation | blog_drafting | social | publishing → manual | assisted | auto.",
    args: { function: "the function", mode: "manual | assisted | auto" },
    confirm: true,
    minRole: "ADMIN",
    async run(a, ctx) {
      const { GOVERNED_FUNCTIONS, MODES } = await import("@/lib/governance");
      const fn = str(a.function, 30); const mode = str(a.mode, 10);
      if (!(GOVERNED_FUNCTIONS as readonly string[]).includes(fn) || !(MODES as readonly string[]).includes(mode)) return "unknown function or mode";
      await db.functionMode.upsert({ where: { workspaceId_function: { workspaceId: ctx.workspaceId, function: fn } }, update: { mode }, create: { workspaceId: ctx.workspaceId, function: fn, mode } });
      await writeAudit({ workspaceId: ctx.workspaceId, actorId: ctx.userId, action: "governance.mode_set", entityType: "function_mode", meta: { function: fn, mode, via: "assistant" } });
      return `${fn} is now ${mode}`;
    },
  },
  {
    name: "set_full_autonomy",
    description: "Admin: turn full autonomy on (everything runs unattended) or off (restores the previous dials).",
    args: { on: "true | false" },
    confirm: true,
    minRole: "ADMIN",
    async run(a, ctx) {
      const on = bool(a.on);
      if (on === null) return "say on or off";
      const { enableFullAutonomy, disableFullAutonomy } = await import("@/lib/autonomy");
      if (on) await enableFullAutonomy(ctx.workspaceId, ctx.userId); else await disableFullAutonomy(ctx.workspaceId, ctx.userId);
      return on ? "full autonomy is ON — ideas, drafts, images, SEO, social posts and publishing run with nobody clicking" : "full autonomy is off — the previous dials are restored";
    },
  },
  {
    name: "set_global_pause",
    description: "Admin: the emergency brake — pause or resume every AI action.",
    args: { paused: "true | false" },
    confirm: true,
    minRole: "ADMIN",
    async run(a, ctx) {
      const paused = bool(a.paused);
      if (paused === null) return "say true or false";
      await db.automationState.upsert({ where: { workspaceId: ctx.workspaceId }, update: { globalPause: paused }, create: { workspaceId: ctx.workspaceId, globalPause: paused } });
      await writeAudit({ workspaceId: ctx.workspaceId, actorId: ctx.userId, action: paused ? "governance.paused" : "governance.resumed", entityType: "automation_state", meta: { via: "assistant" } });
      return paused ? "everything is paused" : "resumed";
    },
  },
  {
    name: "set_social_dial",
    description: "Admin: one social dial — require_approval | autoqueue | evergreen_fill | auto_image | autogen | autogen_weekly (a number) .",
    args: { dial: "which dial", value: "true | false, or a number for autogen_weekly" },
    confirm: true,
    minRole: "ADMIN",
    async run(a, ctx) {
      const dial = str(a.dial, 30);
      const keys: Record<string, string> = { require_approval: "social:require_approval", autoqueue: "social:autoqueue", evergreen_fill: "social:evergreen_fill", auto_image: "social:auto_image", autogen: "social:autogen", autogen_weekly: "social:autogen_weekly" };
      const key = keys[dial];
      if (!key) return "unknown dial";
      const { setWorkspaceSetting } = await import("@/lib/settings");
      let value: string;
      if (dial === "autogen_weekly") { const n = Math.min(50, Math.max(1, parseInt(String(a.value ?? ""), 10) || 5)); value = String(n); }
      else { const b = bool(a.value); if (b === null) return "say true or false"; value = b ? "true" : "false"; }
      await setWorkspaceSetting(ctx.workspaceId, key, value);
      await writeAudit({ workspaceId: ctx.workspaceId, actorId: ctx.userId, action: "settings.saved", entityType: "setting", entityId: key, meta: { value, via: "assistant" } });
      return `${dial} = ${value}`;
    },
  },
  {
    name: "set_video_studio",
    description: "Admin: show or hide the video studio (Scripts, Thumbnails, Videos, Production).",
    args: { on: "true | false" },
    confirm: true,
    minRole: "ADMIN",
    async run(a, ctx) {
      const on = bool(a.on);
      if (on === null) return "say on or off";
      const { setWorkspaceSetting } = await import("@/lib/settings");
      await setWorkspaceSetting(ctx.workspaceId, "studio:enabled", on ? "true" : "false");
      return on ? "video studio shown" : "video studio hidden (nothing deleted)";
    },
  },
  {
    name: "invite_member",
    description: "Admin: invite someone by email with a role (ADMIN | EDITOR | VIEWER). The email goes out through the workspace mailbox; the join link is also returned.",
    args: { email: "their email", role: "ADMIN | EDITOR | VIEWER (default EDITOR)" },
    confirm: true,
    minRole: "ADMIN",
    async run(a, ctx) {
      const email = str(a.email, 200).toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return "that is not an email address";
      const role = ["ADMIN", "EDITOR", "VIEWER"].includes(str(a.role, 10).toUpperCase()) ? str(a.role, 10).toUpperCase() : "EDITOR";
      const { nanoid } = await import("nanoid");
      const token = nanoid(40);
      const ws = await db.workspace.findUnique({ where: { id: ctx.workspaceId }, select: { name: true } });
      await db.invitation.create({ data: { workspaceId: ctx.workspaceId, email, role: role as "ADMIN" | "EDITOR" | "VIEWER", token, expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
      const [{ emailFor }, { getPublicUrl }] = await Promise.all([import("@/lib/email"), import("@/lib/public-url")]);
      const origin = await getPublicUrl();
      await emailFor(ctx.workspaceId).send({ to: email, subject: `You've been invited to ${ws?.name ?? PRODUCT} on ${PRODUCT}`, html: `<p>You've been invited to join <b>${ws?.name ?? ""}</b> as a <b>${role}</b>.</p><p><a href="${origin}/invitations/${token}">Accept the invitation</a></p>` }).catch(() => null);
      await writeAudit({ workspaceId: ctx.workspaceId, actorId: ctx.userId, action: "membership.invited", entityType: "invitation", meta: { email, role, via: "assistant" } });
      return `invited ${email} as ${role}; join link ${origin}/invitations/${token} (the email only delivers if a mailbox is connected)`;
    },
  },
  {
    name: "change_role",
    description: "Admin: change a member's role (not your own).",
    args: { email: "the member's email", role: "ADMIN | EDITOR | VIEWER" },
    confirm: true,
    minRole: "ADMIN",
    async run(a, ctx) {
      const role = str(a.role, 10).toUpperCase();
      if (!["ADMIN", "EDITOR", "VIEWER"].includes(role)) return "role must be ADMIN, EDITOR or VIEWER";
      const u = await db.user.findUnique({ where: { email: str(a.email, 200).toLowerCase() }, select: { id: true, email: true } });
      if (!u) return "no such person";
      if (u.id === ctx.userId) return "you can't change your own role — another admin has to";
      const r = await db.membership.updateMany({ where: { workspaceId: ctx.workspaceId, userId: u.id }, data: { role: role as "ADMIN" | "EDITOR" | "VIEWER" } });
      if (!r.count) return "they are not a member of this workspace";
      await writeAudit({ workspaceId: ctx.workspaceId, actorId: ctx.userId, action: "membership.role_changed", entityType: "membership", entityId: u.id, meta: { email: u.email, role, via: "assistant" } });
      return `${u.email} is now ${role}`;
    },
  },
  {
    name: "run_autopilot_now",
    description: "Admin: run one autopilot cycle now instead of waiting for the sweep (a minute or more).",
    args: {},
    confirm: true,
    minRole: "ADMIN",
    async run(_a, ctx) {
      const { runAutopilotCycle } = await import("@/lib/blog-autopilot");
      const r = await runAutopilotCycle(ctx.workspaceId);
      return `cycle ran: ${JSON.stringify(r).slice(0, 300)}`;
    },
  },

  // ── Research conversation (the old Research chat, folded in 2026-09-09) ──
  {
    name: "intel_channel",
    description: "An indexed competitor channel from Intel: handle, size, cadence and its strongest outliers with ids. Use when the person asks about a channel on /intel/channels/<id>, or says 'this channel' there.",
    args: { intelChannelId: "the Intel channel id (from /intel/channels/<id>)" },
    readOnly: true,
    async run(a, ctx) {
      const ch = await db.intelChannel.findFirst({ where: { id: str(a.intelChannelId, 40), workspaceId: ctx.workspaceId }, include: { videos: { orderBy: { outlierScore: "desc" }, take: 8, select: { id: true, title: true, outlierScore: true, views: true, publishedAt: true, format: true } } } });
      if (!ch) return "no such Intel channel in this workspace (list_outliers shows indexed videos; research_competitor finds a new channel)";
      return [
        `${ch.name ?? ch.handle ?? ch.youtubeId}${ch.handle ? ` (${ch.handle})` : ""} — ${ch.subscribers?.toLocaleString() ?? "—"} subscribers, ${ch.videoCount ?? "—"} videos, ${ch.uploadFrequency != null ? `${ch.uploadFrequency.toFixed(1)}/week` : "cadence —"}${ch.category ? `, ${ch.category}` : ""}${ch.lastIndexedAt ? `, indexed ${when(ch.lastIndexedAt)}` : ""}`,
        `Strongest videos (outlier × = views ÷ this channel's average):`,
        ...ch.videos.map((v) => `  ${v.id} ${v.outlierScore != null ? `${v.outlierScore.toFixed(1)}×` : "—"} "${v.title}" (${v.views != null ? Number(v.views).toLocaleString() : "—"} views${v.format ? `, ${v.format}` : ""}${v.publishedAt ? `, ${v.publishedAt.toISOString().slice(0, 10)}` : ""}) — intel_video for its transcript`),
      ].join("\n");
    },
  },
  {
    name: "intel_video",
    description: "One indexed video from Intel: stats, outlier score, description and the transcript (excerpt) — for breaking down why it worked and how to remix it.",
    args: { intelVideoId: "the Intel video id (from /intel/videos/<id>)" },
    readOnly: true,
    async run(a, ctx) {
      const v = await db.intelVideo.findFirst({ where: { id: str(a.intelVideoId, 40), intelChannel: { workspaceId: ctx.workspaceId } }, include: { intelChannel: { select: { name: true, handle: true } } } });
      if (!v) return "no such Intel video in this workspace";
      const t = v.transcript?.trim();
      return [
        `"${v.title}" — ${v.intelChannel.name ?? v.intelChannel.handle} · https://www.youtube.com/watch?v=${v.youtubeId}`,
        `${v.views != null ? Number(v.views).toLocaleString() : "—"} views · ${v.likes ?? "—"} likes · ${v.comments ?? "—"} comments · ${v.durationSeconds ? `${Math.round(v.durationSeconds / 60)} min` : "—"} · ${v.format ?? ""} · outlier ${v.outlierScore != null ? `${v.outlierScore.toFixed(1)}×` : "not measured"} · published ${v.publishedAt ? v.publishedAt.toISOString().slice(0, 10) : "—"}`,
        v.description ? `Description: ${v.description.slice(0, 600)}` : "",
        t ? `Transcript (${t.length.toLocaleString()} chars, first ${Math.min(t.length, 7000).toLocaleString()}):\n${t.slice(0, 7000)}` : "Transcript: not fetched (analyze_youtube_video can try YouTube directly)",
      ].filter(Boolean).join("\n");
    },
  },
  {
    name: "analyze_youtube_video",
    description: "A YouTube URL the person pasted: finds it in Intel if indexed (stats + transcript), otherwise fetches the transcript from YouTube. Returns text to analyse — hook, structure, retention beats, remix angles are yours to write.",
    args: { url: "a YouTube URL or 11-character video id" },
    readOnly: true,
    async run(a, ctx) {
      const { youtubeVideoId } = await import("@/lib/assistant/context");
      const id = youtubeVideoId(str(a.url, 300));
      if (!id) return "that is not a YouTube video URL";
      const indexed = await db.intelVideo.findFirst({ where: { youtubeId: id, intelChannel: { workspaceId: ctx.workspaceId } }, select: { id: true } });
      if (indexed) return TOOLS_BY_NAME.get("intel_video")!.run({ intelVideoId: indexed.id }, ctx);
      const { youtubeFor } = await import("@/lib/youtube");
      const t = (await youtubeFor(ctx.workspaceId).getTranscript(id).catch(() => null))?.trim();
      if (!t) return `video ${id} is not indexed in Intel and YouTube returned no transcript (captions off, or no YouTube key). Index its channel under /intel to get stats; or ask the person what it is about.`;
      return `https://www.youtube.com/watch?v=${id} — not indexed in Intel (no stats). Transcript (${t.length.toLocaleString()} chars, first 7000):\n${t.slice(0, 7000)}`;
    },
  },
  {
    name: "read_web_page",
    description: "Fetch a public web page the person pointed at and return its title and text (first ~6000 characters) so you can summarise, critique or draw on it. Not for private/internal addresses.",
    args: { url: "https://… the page" },
    readOnly: true,
    async run(a) {
      const { fetchPageText } = await import("@/lib/assistant/context");
      const r = await fetchPageText(str(a.url, 500));
      if (!r.ok) return `could not read it: ${r.reason}`;
      return `${r.title || "(no title)"} — ${r.chars.toLocaleString()} chars${r.chars > r.text.length ? " (truncated)" : ""}\n\n${r.text}`;
    },
  },
  {
    name: "list_research_sources",
    description: "Files and pages saved as research on a channel (uploads from the composer's paperclip land here): id, kind, title, words, starred.",
    args: { channelId: "optional; the active channel when omitted", limit: "optional, default 20" },
    readOnly: true,
    async run(a, ctx) {
      const channelId = str(a.channelId, 40) || ctx.channelId || "";
      if (!channelId) return "no channel — give a channelId (list_channels)";
      const rows = await db.researchSource.findMany({ where: { channelId, channel: { workspaceId: ctx.workspaceId } }, orderBy: { createdAt: "desc" }, take: num(a.limit, 20, 50), select: { id: true, kind: true, title: true, ref: true, wordCount: true, starred: true, createdAt: true } });
      return rows.length ? rows.map((r) => `${r.id} [${r.kind}${r.starred ? " ★" : ""}] ${r.title ?? r.ref} — ${r.wordCount} words, ${when(r.createdAt)}`).join("\n") : "no research sources on this channel yet — the paperclip in the composer adds one";
    },
  },
  {
    name: "read_research_source",
    description: "The extracted text of one research source (an upload or saved page), first ~8000 characters.",
    args: { sourceId: "the research source id" },
    readOnly: true,
    async run(a, ctx) {
      const r = await db.researchSource.findFirst({ where: { id: str(a.sourceId, 40), channel: { workspaceId: ctx.workspaceId } }, select: { title: true, kind: true, content: true, wordCount: true } });
      if (!r) return "no such research source";
      return `${r.title ?? "(untitled)"} [${r.kind}] — ${r.wordCount} words\n\n${(r.content ?? "(no text was extracted)").slice(0, 8000)}`;
    },
  },
  {
    name: "start_script",
    description: "'Turn this into a script': create a video script on the canvas from the conversation, with your synthesis as its opening brief. Lands at /scripts/<id> (Plan → Outline → Script). Nothing is published.",
    args: { title: "a working title", brief: "your synthesis of the conversation so far — the angle, the hook, the beats, the sources (this seeds the canvas chat)", channelId: "optional; the active channel when omitted" },
    async run(a, ctx) {
      const channelId = str(a.channelId, 40) || ctx.channelId || "";
      const ch = channelId ? await db.channel.findFirst({ where: { id: channelId, workspaceId: ctx.workspaceId } }) : null;
      if (!ch) return "refused: a script needs a channel — list_channels, or the person can pick one in the top bar";
      const title = str(a.title, 120) || "Untitled script";
      const brief = str(a.brief, 6000);
      const script = await db.script.create({ data: { channelId: ch.id, authorId: ctx.userId, title, workflow: "canvas", language: ch.defaultLanguage, templateId: ch.defaultTemplateId, model: ch.defaultModel } });
      await db.chat.create({ data: { channelId: ch.id, userId: ctx.userId, type: "canvas", scriptId: script.id, title, messages: { create: { role: "assistant", content: `Started from a conversation with the assistant.\n\n${brief || "(no brief)"}\n\nWhen you're ready, head to the Plan tab, answer the planning questions, and generate an outline.` } } } });
      return `script ${script.id} "${title}" created on ${ch.name}'s canvas with the brief as its opening note — /scripts/${script.id}`;
    },
  },
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/**
 * Execute one tool for the assistant. Role-gated, audited, and errors are
 * returned as text (the model reads them) rather than thrown.
 */
export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
  opts: { confirmed?: boolean } = {},
): Promise<{ ok: boolean; output: string }> {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) return { ok: false, output: `unknown tool "${name}" — use one of: ${TOOLS.map((t) => t.name).join(", ")}` };
  if (tool.minRole === "ADMIN" && ctx.role !== "ADMIN") return { ok: false, output: "refused: only an admin can do this" };
  if (tool.confirm && !opts.confirmed) return { ok: false, output: "refused: this needs the person's confirmation first" };
  if (!tool.readOnly) {
    const { isGloballyPaused } = await import("@/lib/governance");
    if (await isGloballyPaused(ctx.workspaceId) && !["set_global_pause"].includes(name)) return { ok: false, output: "refused: the workspace is globally paused (Settings → Automation)" };
  }
  try {
    const output = await tool.run(args, ctx);
    if (!tool.readOnly) {
      await writeAudit({ workspaceId: ctx.workspaceId, actorId: ctx.userId, action: "assistant.tool_run", entityType: "assistant", meta: { tool: name, args, ok: true } });
    }
    return { ok: true, output };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!tool.readOnly) await writeAudit({ workspaceId: ctx.workspaceId, actorId: ctx.userId, action: "assistant.tool_run", entityType: "assistant", meta: { tool: name, args, ok: false, error: msg.slice(0, 200) } });
    return { ok: false, output: `error: ${msg.slice(0, 300)}` };
  }
}
