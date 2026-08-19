import { db } from "@/lib/db";
import { isGloballyPaused, writeAudit } from "@/lib/governance";

/**
 * The assistant's tools — the ONLY things it can do.
 *
 * ⚠ THE ALLOWLIST IS THE SAFETY MODEL. The assistant reads a model's JSON and
 * executes what it names, so anything reachable from here is something a
 * sentence in a chat box can cause. Two rules decide what is allowed in:
 *
 *   1. **Nothing outward-facing, ever.** No publishing to WordPress, no sending
 *      or queueing a social post, no approving one, no email. The house rule is
 *      that approving is the last human act before an audience sees anything —
 *      an assistant that could schedule a send would take that away. Every tool
 *      here lands its work at the SAME review gates a human would.
 *   2. **Nothing destructive and nothing configuring.** No deletes, no settings,
 *      no API keys, no role changes. The blast radius of a misread instruction
 *      stays at "made a draft nobody asked for", which is a click to remove.
 *
 * `REFUSED_INTENTS` below names the common asks that fall outside, so the
 * assistant can say what it won't do and where the button is, instead of
 * inventing a tool call that silently no-ops.
 *
 * Every execution writes an audit row with the tool name and arguments, so
 * "why does this draft exist" always has an answer.
 */

export type ToolContext = { workspaceId: string; userId: string };

export type Tool = {
  name: string;
  /** Shown to the model. Say what it does AND what it doesn't. */
  description: string;
  /** Argument names → what they mean. Kept flat and small on purpose. */
  args: Record<string, string>;
  /** Read-only tools are free to call; the model is told to prefer them. */
  readOnly?: boolean;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
};

const str = (v: unknown, max = 300): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown, dflt: number, max: number): number => {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : dflt;
};

/** Things people will ask for that this assistant deliberately cannot do. */
export const REFUSED_INTENTS = [
  "publishing an article to WordPress (Blog → the article → Publish, once its gates pass)",
  "sending, scheduling or queueing a social post (Social → Calendar, or approve it if auto-queue is on)",
  "approving anything — posts, images or ideas that are already drafted are a person's call",
  "deleting anything at all",
  "changing settings, API keys, connections, slots or roles",
  "sending email",
];

export const TOOLS: Tool[] = [
  // ── Reading ───────────────────────────────────────────────────────────────
  {
    name: "pipeline_status",
    description: "Counts across the workspace: blog ideas by status, blog posts by status, social posts by status. Call this first when asked what is going on, what needs attention, or before deciding what to make.",
    args: {},
    readOnly: true,
    async run(_a, ctx) {
      const [ideas, posts, social] = await Promise.all([
        db.blogIdea.groupBy({ by: ["status"], where: { workspaceId: ctx.workspaceId }, _count: true }),
        db.blogPost.groupBy({ by: ["status"], where: { workspaceId: ctx.workspaceId }, _count: true }),
        db.socialPost.groupBy({ by: ["status"], where: { workspaceId: ctx.workspaceId }, _count: true }),
      ]);
      const fmt = (rows: Array<{ status: string; _count: number }>) =>
        rows.length ? rows.map((r) => `${r.status}=${r._count}`).join(", ") : "none";
      return [
        `blog ideas: ${fmt(ideas as never)}`,
        `blog posts: ${fmt(posts as never)}`,
        `social posts: ${fmt(social as never)}`,
      ].join("\n");
    },
  },
  {
    name: "list_ideas",
    description: "List blog ideas with their id, status and title. Use before drafting so you draft from a real idea instead of inventing one.",
    args: { status: "optional filter: discovered | approved | rejected | drafted", limit: "optional, default 20" },
    readOnly: true,
    async run(a, ctx) {
      const status = str(a.status, 20);
      const rows = await db.blogIdea.findMany({
        where: { workspaceId: ctx.workspaceId, ...(status ? { status } : {}) },
        orderBy: { createdAt: "desc" },
        take: num(a.limit, 20, 50),
        select: { id: true, title: true, status: true, keyword: true },
      });
      if (!rows.length) return "no ideas match";
      return rows.map((r) => `${r.id} [${r.status}] ${r.title}${r.keyword ? ` (keyword: ${r.keyword})` : ""}`).join("\n");
    },
  },
  {
    name: "list_articles",
    description: "List blog posts with id, status and title. Statuses run drafting → draft_review → final_approval → published.",
    args: { status: "optional filter", limit: "optional, default 20" },
    readOnly: true,
    async run(a, ctx) {
      const status = str(a.status, 20);
      const rows = await db.blogPost.findMany({
        where: { workspaceId: ctx.workspaceId, ...(status ? { status } : {}) },
        orderBy: { updatedAt: "desc" },
        take: num(a.limit, 20, 50),
        select: { id: true, title: true, status: true, metaTitle: true },
      });
      if (!rows.length) return "no articles match";
      return rows.map((r) => `${r.id} [${r.status}] ${r.title}${r.metaTitle ? "" : " (no SEO meta yet)"}`).join("\n");
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

  // ── Making things (all land at the normal review gates) ───────────────────
  {
    name: "discover_ideas",
    description: "Generate new blog ideas grounded in the workspace profile, topics and keywords. They land as 'discovered' for a human to approve.",
    args: { topicId: "optional workspace topic id to focus on" },
    async run(a, ctx) {
      const { discoverIdeasCore } = await import("@/lib/blog-autopilot");
      const topicId = str(a.topicId, 40) || null;
      const created = await discoverIdeasCore(ctx.workspaceId, topicId);
      return created ? `created ${created} idea(s), all 'discovered' and awaiting approval` : "created nothing (the model returned no usable ideas, or generation is paused)";
    },
  },
  {
    name: "add_idea",
    description: "Add one blog idea the user has described. Use this when they tell you the topic rather than asking you to find topics.",
    args: { title: "the idea's title", angle: "optional: why it works, the hook", keyword: "optional focus keyword" },
    async run(a, ctx) {
      const title = str(a.title, 200);
      if (!title) return "refused: an idea needs a title";
      const idea = await db.blogIdea.create({
        data: {
          workspaceId: ctx.workspaceId,
          title,
          angle: str(a.angle, 500) || null,
          keyword: str(a.keyword, 100) || null,
          source: "manual",
        },
      });
      return `added idea ${idea.id} ("${title}"), status 'discovered' — a human approves it before it can be drafted`;
    },
  },
  {
    name: "draft_article",
    description: "Write a full grounded article from an existing idea, then give it images and SEO metadata and park it at draft_review for a human. Takes a minute or two. Never publishes.",
    args: { ideaId: "id of the idea to draft (from list_ideas)" },
    async run(a, ctx) {
      const ideaId = str(a.ideaId, 40);
      const idea = await db.blogIdea.findFirst({ where: { id: ideaId, workspaceId: ctx.workspaceId } });
      if (!idea) return "refused: no such idea in this workspace";
      if (idea.status === "drafted" && idea.postId) return `that idea was already drafted as article ${idea.postId}`;

      const post = await db.blogPost.create({
        data: { workspaceId: ctx.workspaceId, title: idea.title, focusKeyword: idea.keyword, topicId: idea.topicId, status: "drafting", createdById: ctx.userId },
      });
      await db.blogIdea.update({ where: { id: idea.id }, data: { status: "drafted", postId: post.id } });

      const { generateDraftCore, completeFreshDraftCore } = await import("@/lib/blog-autopilot");
      const ok = await generateDraftCore(ctx.workspaceId, post.id);
      if (!ok) return `article ${post.id} was created but drafting failed (paused, or the model returned nothing) — it is sitting at 'drafting'`;
      const done = await completeFreshDraftCore(ctx.workspaceId, post.id);
      return `drafted article ${post.id} ("${idea.title}") — now at draft_review, ${done.imagesGenerated} image(s) generated, SEO meta ${done.seoOptimized ? "written" : "unchanged"}. A human reviews and publishes it.`;
    },
  },
  {
    name: "generate_seo",
    description: "Fill an article's meta title, description and slug. Fill-only: it never overwrites values a human has already written.",
    args: { articleId: "id of the article" },
    async run(a, ctx) {
      const id = str(a.articleId, 40);
      const post = await db.blogPost.findFirst({ where: { id, workspaceId: ctx.workspaceId }, select: { id: true } });
      if (!post) return "refused: no such article in this workspace";
      const { generateSeoMetaCore } = await import("@/lib/blog-seo");
      const res = await generateSeoMetaCore(ctx.workspaceId, post.id, { onlyFillEmpty: true });
      return res.ok ? `wrote SEO metadata for ${post.id}` : `no metadata written (${res.reason ?? "unknown reason"})`;
    },
  },
  {
    name: "generate_images",
    description: "Generate the featured and OG images for an article. They land 'pending' for a human to approve, and a human's own images are never replaced.",
    args: { articleId: "id of the article" },
    async run(a, ctx) {
      const id = str(a.articleId, 40);
      const post = await db.blogPost.findFirst({ where: { id, workspaceId: ctx.workspaceId }, select: { id: true } });
      if (!post) return "refused: no such article in this workspace";
      const { generateBlogImagesCore } = await import("@/lib/blog-images");
      const made = await generateBlogImagesCore(ctx.workspaceId, post.id);
      return made ? `generated ${made} image(s) for ${post.id}, both pending human approval` : "generated nothing (AI images are off for this workspace, or a human already owns both images)";
    },
  },
  {
    name: "draft_social_post",
    description: "Create ONE social post draft on a workspace topic, with an image if auto-image is on. It is a DRAFT: it is not scheduled and will not send.",
    args: {},
    async run(_a, ctx) {
      const { generateSocialPostForWorkspace } = await import("@/lib/social/autogen");
      const ok = await generateSocialPostForWorkspace(ctx.workspaceId);
      return ok
        ? "created one social post draft — it needs approval and queueing before it can send"
        : "created nothing (no topics or connected accounts, generation paused, or the weekly cap is spent)";
    },
  },
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/**
 * Execute one tool call. Every path here writes an audit row — including
 * failures, because "the assistant tried and could not" is the answer to a
 * question someone will ask later.
 */
export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ ok: boolean; output: string }> {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) return { ok: false, output: `refused: "${name}" is not a tool this assistant has` };

  // The global pause is the workspace's stop button; it outranks any chat.
  if (!tool.readOnly && (await isGloballyPaused(ctx.workspaceId))) {
    return { ok: false, output: "refused: automation is globally paused for this workspace" };
  }

  try {
    const output = await tool.run(args, ctx);
    if (!tool.readOnly) {
      await writeAudit({
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        action: "assistant.tool_run",
        entityType: "assistant",
        meta: { tool: name, args, outcome: output.slice(0, 300) },
      });
    }
    return { ok: true, output };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!tool.readOnly) {
      await writeAudit({
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        action: "assistant.tool_failed",
        entityType: "assistant",
        meta: { tool: name, args, error: message.slice(0, 300) },
      });
    }
    return { ok: false, output: `the tool failed: ${message.slice(0, 300)}` };
  }
}
