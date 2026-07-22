import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { llm } from "@/lib/llm";
import { runBlogChecks, requiredChecksPass } from "@/lib/blog-checks";
import { decryptSecret, type Encrypted } from "@/lib/blog-crypto";
import { wpCreatePost, type WpCredentials } from "@/lib/wordpress";
import { getModes, isGloballyPaused, writeAudit } from "@/lib/governance";
import { getVideoProvider, estimateCostUsd } from "@/lib/video";
import { templateGuidance } from "@/lib/blog-templates";
import { buildJsonLd } from "@/lib/blog-jsonld";

/**
 * Autopilot cores + the Phase-3 scheduler cycle. Every function here is
 * session-free (takes workspaceId explicitly) so both the server actions and
 * the background scheduler share one implementation. Cores enforce the
 * guardrails themselves: global pause, protect-from-rewrite, publish gates,
 * and a per-workspace daily AI-call budget for unattended runs.
 *
 * Mode semantics per cycle:
 *   ideation      assisted|auto → top up discovered ideas when the pool is low
 *   blog_drafting assisted|auto → draft approved ideas (≤2/cycle), park at the
 *                                 draft_review checkpoint
 *   social        assisted|auto → generate variants for published posts that
 *                                 lack them (they queue as drafts for approval)
 *   publishing    auto only     → publish gate-passing final_approval posts to
 *                                 WordPress (≤2/cycle). assisted = queue at
 *                                 final_approval, which is the default flow.
 * Truthfulness holds by construction: unverified citations fail the gates, so
 * auto mode can never publish unverified claims.
 */

const DAILY_AI_BUDGET = 20; // unattended generations per workspace per day
const GENERATION_ACTIONS = ["blog.draft_generated", "ideas.ai_discovery", "social.variants_generated"];

const clip = (s: string | null | undefined, n = 600) => (s && s !== "{}" && s !== "[]" ? s.slice(0, n) : null);

// ---- Cores (shared by actions + scheduler) -----------------------------------

export async function discoverIdeasCore(workspaceId: string): Promise<number> {
  if (await isGloballyPaused(workspaceId)) return 0;
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) return 0;
  const org = await db.orgProfile.findUnique({ where: { workspaceId } });
  const existing = await db.blogIdea.findMany({
    where: { workspaceId },
    select: { title: true },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const system =
    "You generate blog topic ideas. Respond ONLY with a JSON array of objects: " +
    '[{"title": string, "angle": string, "keyword": string}] — no prose, no markdown fences. ' +
    "Titles must be specific and non-generic. The angle explains why this topic serves the audience. " +
    "Never invent statistics or cite studies in the angle.";
  const prompt = [
    org?.description
      ? `The organization: ${org.description}${org.industry ? ` Industry: ${org.industry}.` : ""}${org.audience ? ` Audience: ${org.audience}.` : ""}`
      : "No organization profile is set — generate broadly useful business-content ideas and note that grounding is missing.",
    existing.length ? `Avoid duplicating these existing ideas: ${existing.map((i) => i.title).join(" | ")}` : null,
    "Generate 6 blog post ideas.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await llm.complete({
    model: workspace.defaultModel ?? llm.defaultModel,
    system,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 1500,
  });

  let ideas: Array<{ title?: string; angle?: string; keyword?: string }> = [];
  try {
    const match = res.content.match(/\[[\s\S]*\]/);
    ideas = match ? JSON.parse(match[0]) : [];
  } catch {
    ideas = [];
  }
  const rows = ideas
    .filter((i) => typeof i.title === "string" && i.title.trim().length > 3)
    .slice(0, 6)
    .map((i) => ({
      workspaceId,
      title: i.title!.trim().slice(0, 200),
      angle: typeof i.angle === "string" ? i.angle.trim().slice(0, 500) : null,
      keyword: typeof i.keyword === "string" ? i.keyword.trim().slice(0, 80) : null,
      source: "ai",
    }));
  if (rows.length) await db.blogIdea.createMany({ data: rows });
  await writeAudit({
    workspaceId,
    action: "ideas.ai_discovery",
    entityType: "blog_idea",
    meta: { created: rows.length },
  });
  return rows.length;
}

/** Generate (or regenerate) the outline as JSON [{heading, points[]}]. */
export async function generateOutlineCore(workspaceId: string, postId: string): Promise<boolean> {
  const post = await db.blogPost.findFirst({ where: { id: postId, workspaceId } });
  if (!post) return false;
  if (await isGloballyPaused(workspaceId)) return false;
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) return false;
  const org = await db.orgProfile.findUnique({ where: { workspaceId } });
  let secondary: string[] = [];
  try { secondary = JSON.parse(post.secondaryKeywords) as string[]; } catch { secondary = []; }

  const system =
    "You are an SEO content strategist. Respond ONLY with a JSON array: " +
    '[{"heading": string, "points": string[]}] — 4 to 7 h2 sections with 2-4 bullet points each. ' +
    "No invented statistics in points. Headings should be specific, and at least one should naturally contain the focus keyword when one is given.";
  const prompt = [
    `Outline a blog post titled: "${post.title}".`,
    org?.description ? `Organization context: ${org.description.slice(0, 500)}` : null,
    post.focusKeyword ? `Focus keyword: "${post.focusKeyword}".` : null,
    secondary.length ? `Secondary keywords to cover: ${secondary.join(", ")}.` : null,
    templateGuidance(post.templateKey) ? `Structure: ${templateGuidance(post.templateKey)}` : null,
    post.audience ? `Audience: ${post.audience}.` : null,
  ].filter(Boolean).join("\n");

  const res = await llm.complete({
    model: post.model ?? workspace.defaultModel ?? llm.defaultModel,
    system,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 1200,
  });
  let outline: Array<{ heading?: string; points?: string[] }> = [];
  try {
    const m = res.content.match(/\[[\s\S]*\]/);
    outline = m ? JSON.parse(m[0]) : [];
  } catch { outline = []; }
  const clean = outline
    .filter((s) => typeof s.heading === "string" && s.heading.trim())
    .slice(0, 8)
    .map((s) => ({ heading: s.heading!.trim().slice(0, 150), points: (s.points ?? []).filter((p) => typeof p === "string").slice(0, 5) }));
  if (!clean.length) return false;
  await db.blogPost.update({ where: { id: post.id }, data: { outline: JSON.stringify(clean) } });
  await writeAudit({ workspaceId, action: "blog.outline_generated", entityType: "blog_post", entityId: post.id, meta: { sections: clean.length } });
  return true;
}

export async function generateDraftCore(workspaceId: string, postId: string): Promise<boolean> {
  const post = await db.blogPost.findFirst({ where: { id: postId, workspaceId } });
  if (!post || post.protectedFromRewrite) return false;
  if (await isGloballyPaused(workspaceId)) return false;
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) return false;

  const [org, channel] = await Promise.all([
    db.orgProfile.findUnique({ where: { workspaceId } }),
    db.channel.findFirst({
      where: { workspaceId },
      include: { voiceProfiles: { take: 1 }, audience: true },
    }),
  ]);
  const voice = channel?.voiceProfiles[0];

  const system = [
    "You are a senior content writer producing an SEO blog post draft as clean HTML (h2/h3, p, ul/li — no <html>/<body> wrapper).",
    "Truthfulness rules (hard requirements): never invent statistics, quotes, prices, or named studies. Where a factual claim would need verification, write [NEEDS SOURCE] immediately after it. Do not fabricate customer stories.",
    org?.description
      ? `About the organization this blog belongs to (ground every claim in this): ${org.description}${org.industry ? ` Industry: ${org.industry}.` : ""}${org.audience ? ` Primary audience: ${org.audience}.` : ""}`
      : null,
    voice ? `Write in the brand voice "${voice.label}". Voice profile (JSON): ${clip(voice.data) ?? "n/a"}` : null,
    channel?.audience
      ? `Audience profile (JSON): demographics ${clip(channel.audience.demographics) ?? "n/a"}; psychographics ${clip(channel.audience.psychographics) ?? "n/a"}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const target = post.wordCountTarget ?? 900;
  let outline: Array<{ heading: string; points: string[] }> = [];
  try { outline = post.outline ? JSON.parse(post.outline) : []; } catch { outline = []; }
  let secondary: string[] = [];
  try { secondary = JSON.parse(post.secondaryKeywords) as string[]; } catch { secondary = []; }
  const TONE_HINT: Record<string, string> = {
    professional: "professional and precise",
    friendly: "warm, friendly, first-person plural",
    authoritative: "confident and authoritative, no hedging",
    conversational: "conversational, short sentences, direct address",
  };
  const LEVEL_HINT: Record<string, string> = {
    simple: "8th-grade reading level — short sentences, common words",
    standard: "general adult reading level",
    advanced: "expert reading level — technical vocabulary is fine",
  };

  const prompt = [
    `Write a blog post draft titled: "${post.title}".`,
    post.audience ? `Intended audience: ${post.audience}.` : null,
    post.focusKeyword
      ? `Primary SEO keyword: "${post.focusKeyword}" — use it naturally in the opening paragraph and at least one heading.`
      : null,
    secondary.length ? `Work these secondary keywords in naturally (no stuffing): ${secondary.join(", ")}.` : null,
    post.tone && TONE_HINT[post.tone] ? `Tone: ${TONE_HINT[post.tone]}.` : null,
    post.readingLevel && LEVEL_HINT[post.readingLevel] ? `Reading level: ${LEVEL_HINT[post.readingLevel]}.` : null,
    templateGuidance(post.templateKey) ? `Structure template: ${templateGuidance(post.templateKey)}` : null,
    outline.length
      ? `Follow this approved outline exactly (h2 per section):\n${outline.map((s) => `- ${s.heading}${s.points.length ? ` (${s.points.join("; ")})` : ""}`).join("\n")}`
      : "Structure: strong opening hook, 3–5 h2 sections, actionable close.",
    `Length: about ${target} words. HTML only.`,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await llm.complete({
    model: post.model ?? workspace.defaultModel ?? llm.defaultModel,
    system,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 4000,
  });

  // Version history: preserve what generation is about to overwrite.
  if (post.body) {
    await db.blogPostVersion.create({
      data: { postId: post.id, label: "before generation", body: post.body },
    });
  }
  await db.blogPost.update({ where: { id: post.id }, data: { body: res.content } });
  await db.blogCitation.deleteMany({ where: { postId: post.id, verified: false } });
  const text = res.content.replace(/<[^>]+>/g, " ");
  const claims = [...text.matchAll(/([^.!?]*[.!?]?)\s*\[NEEDS SOURCE\]/g)]
    .map((m) => m[1].trim().slice(-300))
    .filter((c) => c.length > 8)
    .slice(0, 20);
  if (claims.length) {
    await db.blogCitation.createMany({ data: claims.map((claim) => ({ postId: post.id, claim })) });
  }
  await writeAudit({
    workspaceId,
    action: "blog.draft_generated",
    entityType: "blog_post",
    entityId: post.id,
    meta: { model: res.model, claimsFlagged: claims.length },
  });
  return true;
}

export async function generateVariantsCore(workspaceId: string, postId: string): Promise<number> {
  const post = await db.blogPost.findFirst({ where: { id: postId, workspaceId } });
  if (!post || !post.body) return 0;
  if (await isGloballyPaused(workspaceId)) return 0;
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) return 0;
  const org = await db.orgProfile.findUnique({ where: { workspaceId } });
  const summary = post.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 1500);

  const system =
    "You write social media copy promoting a blog post. Respond ONLY with a JSON object keyed by platform: " +
    '{"linkedin": string, "x": string, "instagram": string, "facebook": string}. ' +
    "Use {{URL}} where the post link belongs. Platform conventions: linkedin = professional, 2-3 short paragraphs; " +
    "x = under 260 chars, punchy; instagram = conversational with line breaks, no link in body (say 'link in bio' + {{URL}} on its own line); " +
    "facebook = friendly, 1-2 paragraphs. Never invent statistics or quotes not present in the article.";
  const prompt = [
    `Blog post title: "${post.title}"`,
    org?.description ? `The organization: ${org.description.slice(0, 400)}` : null,
    `Article summary: ${summary}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await llm.complete({
    model: workspace.defaultModel ?? llm.defaultModel,
    system,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 1500,
  });

  let parsed: Record<string, unknown> = {};
  try {
    const match = res.content.match(/\{[\s\S]*\}/);
    parsed = match ? (JSON.parse(match[0]) as Record<string, unknown>) : {};
  } catch {
    parsed = {};
  }
  await db.socialVariant.deleteMany({ where: { postId: post.id, status: { not: "posted" } } });
  const platforms = ["linkedin", "x", "instagram", "facebook"] as const;
  const rows = platforms
    .filter((p) => typeof parsed[p] === "string" && (parsed[p] as string).trim())
    .map((p) => ({ postId: post.id, platform: p, content: (parsed[p] as string).trim().slice(0, 3000) }));
  if (rows.length) await db.socialVariant.createMany({ data: rows });
  await writeAudit({
    workspaceId,
    action: "social.variants_generated",
    entityType: "blog_post",
    entityId: post.id,
    meta: { platforms: rows.map((r) => r.platform) },
  });
  return rows.length;
}

export async function publishCore(workspaceId: string, postId: string): Promise<boolean> {
  const post = await db.blogPost.findFirst({ where: { id: postId, workspaceId } });
  if (!post || !post.body) return false;
  if (post.status !== "final_approval" && post.status !== "published") return false;

  const unverified = await db.blogCitation.count({ where: { postId: post.id, verified: false } });
  if (!requiredChecksPass(runBlogChecks(post, unverified))) return false;

  const conn = await db.wordPressConnection.findUnique({ where: { workspaceId } });
  if (!conn) return false;
  let creds: WpCredentials;
  try {
    creds = {
      baseUrl: conn.baseUrl,
      username: conn.username,
      appPassword: decryptSecret(JSON.parse(conn.encAppPassword) as Encrypted),
    };
  } catch {
    return false;
  }

  // Structured data rides inside the content (works on any WP theme/plugin).
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  const jsonLd = `\n<script type="application/ld+json">${buildJsonLd(post, workspace?.name ?? "MeYouSocial")}</script>`;
  const created = await wpCreatePost(creds, {
    title: post.metaTitle ?? post.title,
    slug: post.slug,
    content: post.body + jsonLd,
    excerpt: post.metaDescription,
    status: "publish",
  });
  await db.blogPost.update({
    where: { id: post.id },
    data: { status: "published", publishedAt: new Date(), publishedUrl: created.link },
  });
  await writeAudit({
    workspaceId,
    action: "blog.published_wordpress",
    entityType: "blog_post",
    entityId: post.id,
    meta: { wpPostId: created.id, link: created.link },
  });
  return true;
}

// ---- Video (Phase 4) ---------------------------------------------------------

/**
 * Package a blog post into a queued short-form video: an LLM turns the article
 * into a single-scene visual prompt + hook, stored as a VideoRender awaiting
 * the rendering step. No video API cost at packaging time.
 */
export async function packageVideoCore(workspaceId: string, blogPostId: string): Promise<string | null> {
  if (await isGloballyPaused(workspaceId)) return null;
  const post = await db.blogPost.findFirst({ where: { id: blogPostId, workspaceId } });
  if (!post || !post.body) return null;
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) return null;

  const summary = post.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 1200);
  const system =
    "You write prompts for an AI video generator producing short-form vertical videos (8 seconds). " +
    'Respond ONLY with a JSON object: {"title": string, "prompt": string}. ' +
    "The prompt describes ONE visually concrete scene (subject, setting, camera movement, mood, on-screen text hook ≤6 words) " +
    "that teases the article's core idea. No statistics, no invented claims, no brand logos.";
  const res = await llm.complete({
    model: workspace.defaultModel ?? llm.defaultModel,
    system,
    messages: [{ role: "user", content: `Article title: "${post.title}"\n\nArticle summary: ${summary}` }],
    maxTokens: 500,
  });
  let parsed: { title?: string; prompt?: string } = {};
  try {
    const match = res.content.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : {};
  } catch {
    parsed = {};
  }
  if (!parsed.prompt) return null;

  const seconds = env.VIDEO_MAX_SECONDS;
  const render = await db.videoRender.create({
    data: {
      workspaceId,
      blogPostId: post.id,
      title: (parsed.title ?? post.title).slice(0, 200),
      prompt: parsed.prompt.slice(0, 2000),
      seconds,
      aspect: "9:16",
      costEstimate: estimateCostUsd(seconds),
    },
  });
  await writeAudit({
    workspaceId,
    action: "video.packaged",
    entityType: "video_render",
    entityId: render.id,
    meta: { blogPostId: post.id, seconds, costEstimate: render.costEstimate },
  });
  return render.id;
}

async function rendersToday(workspaceId: string): Promise<number> {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  return db.videoRender.count({
    where: { workspaceId, status: { in: ["rendering", "done"] }, updatedAt: { gte: dayStart } },
  });
}

/** Process one queued render through the provider. Minutes-long — background only. */
export async function processRenderCore(workspaceId: string, renderId: string): Promise<boolean> {
  if (await isGloballyPaused(workspaceId)) return false;
  const render = await db.videoRender.findFirst({ where: { id: renderId, workspaceId, status: "queued" } });
  if (!render) return false;
  if ((await rendersToday(workspaceId)) >= env.VIDEO_DAILY_RENDER_CAP) return false;

  const provider = await getVideoProvider();
  await db.videoRender.update({ where: { id: render.id }, data: { status: "rendering", provider: provider.name } });
  try {
    const out = await provider.render({
      prompt: render.prompt,
      seconds: render.seconds,
      aspect: render.aspect as "9:16" | "16:9" | "1:1",
    });
    await db.videoRender.update({
      where: { id: render.id },
      data: { status: "done", outputUrl: out.url, provider: out.provider, seconds: out.seconds },
    });
    await writeAudit({
      workspaceId,
      action: "video.rendered",
      entityType: "video_render",
      entityId: render.id,
      meta: { provider: out.provider, seconds: out.seconds },
    });
    return true;
  } catch (e) {
    await db.videoRender.update({
      where: { id: render.id },
      data: { status: "failed", error: e instanceof Error ? e.message.slice(0, 500) : "render failed" },
    });
    await writeAudit({
      workspaceId,
      action: "video.render_failed",
      entityType: "video_render",
      entityId: render.id,
      meta: { provider: provider.name },
    });
    return false;
  }
}

// ---- The scheduler cycle ------------------------------------------------------

async function generationsToday(workspaceId: string): Promise<number> {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  return db.auditLog.count({
    where: { workspaceId, action: { in: GENERATION_ACTIONS }, createdAt: { gte: dayStart } },
  });
}

export type CycleReport = {
  workspaceId: string;
  skipped?: "paused" | "budget";
  ideasCreated: number;
  drafted: number;
  variantPosts: number;
  published: number;
  videosPackaged: number;
  videosRendered: number;
};

export async function runAutopilotCycle(workspaceId: string): Promise<CycleReport> {
  const report: CycleReport = {
    workspaceId,
    ideasCreated: 0,
    drafted: 0,
    variantPosts: 0,
    published: 0,
    videosPackaged: 0,
    videosRendered: 0,
  };

  if (await isGloballyPaused(workspaceId)) {
    report.skipped = "paused";
    return report;
  }
  const modes = await getModes(workspaceId);
  const unattended = (fn: keyof typeof modes) => modes[fn] === "assisted" || modes[fn] === "auto";

  if ((await generationsToday(workspaceId)) >= DAILY_AI_BUDGET) {
    report.skipped = "budget";
    return report;
  }

  // 1. Ideation: top up when the open pool is low.
  if (unattended("ideation")) {
    const open = await db.blogIdea.count({
      where: { workspaceId, status: { in: ["discovered", "approved"] } },
    });
    if (open < 3) report.ideasCreated = await discoverIdeasCore(workspaceId);

    // Wave C′ refresh loop: published posts ranking past position 10 become
    // refresh ideas (once per post; protected posts excluded).
    const published = await db.blogPost.findMany({
      where: { workspaceId, status: "published", protectedFromRewrite: false },
      include: { snapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
      take: 20,
    });
    for (const p of published) {
      const pos = p.snapshots[0]?.position;
      if (pos == null || pos <= 10) continue;
      const title = `Refresh: ${p.title}`;
      const exists = await db.blogIdea.count({ where: { workspaceId, title } });
      if (exists) continue;
      await db.blogIdea.create({
        data: {
          workspaceId,
          title,
          angle: `Ranking at position ${pos.toFixed(1)} — update and expand to recover.`,
          keyword: p.focusKeyword,
          source: "refresh",
          postId: p.id,
        },
      });
      report.ideasCreated++;
    }
  }

  // 2. Drafting: draft approved ideas, park at the draft_review checkpoint.
  if (unattended("blog_drafting")) {
    const approved = await db.blogIdea.findMany({
      where: { workspaceId, status: "approved" },
      orderBy: { createdAt: "asc" },
      take: 2,
    });
    for (const idea of approved) {
      const post = await db.blogPost.create({
        data: { workspaceId, title: idea.title, focusKeyword: idea.keyword, status: "drafting" },
      });
      await db.blogIdea.update({ where: { id: idea.id }, data: { status: "drafted", postId: post.id } });
      const ok = await generateDraftCore(workspaceId, post.id);
      if (ok) {
        await db.blogPost.update({ where: { id: post.id }, data: { status: "draft_review" } });
        report.drafted++;
      }
    }
  }

  // 3. Social: generate variants for published posts that lack any.
  if (unattended("social")) {
    const bare = await db.blogPost.findMany({
      where: { workspaceId, status: "published", variants: { none: {} } },
      select: { id: true },
      take: 2,
    });
    for (const p of bare) {
      const n = await generateVariantsCore(workspaceId, p.id);
      if (n > 0) report.variantPosts++;
    }
  }

  // 4. Publishing. Auto mode: any gate-passing final_approval post whose
  // scheduledAt is unset or due. Assisted mode: ONLY due scheduled posts —
  // an admin setting the time was the human approval. Manual: nothing.
  if (modes.publishing === "auto" || modes.publishing === "assisted") {
    const now = new Date();
    const ready = await db.blogPost.findMany({
      where:
        modes.publishing === "auto"
          ? {
              workspaceId,
              status: "final_approval",
              OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
            }
          : { workspaceId, status: "final_approval", scheduledAt: { lte: now } },
      orderBy: { updatedAt: "asc" },
      take: 2,
    });
    for (const p of ready) {
      try {
        if (await publishCore(workspaceId, p.id)) report.published++;
      } catch {
        // WP outage or rejection — leave the post at final_approval for the next cycle.
      }
    }
  }

  // 5. Video packaging: turn published posts without a package into queued renders.
  if (unattended("video_packaging")) {
    const unpackaged = await db.blogPost.findMany({
      where: { workspaceId, status: "published" },
      select: { id: true },
      take: 5,
    });
    for (const p of unpackaged) {
      const has = await db.videoRender.count({ where: { workspaceId, blogPostId: p.id } });
      if (has > 0) continue;
      const id = await packageVideoCore(workspaceId, p.id);
      if (id) report.videosPackaged++;
      break; // one package per cycle
    }
  }

  // 6. Video rendering: process one queued render per cycle (daily cap inside).
  if (unattended("video_rendering")) {
    const queued = await db.videoRender.findFirst({
      where: { workspaceId, status: "queued" },
      orderBy: { createdAt: "asc" },
    });
    if (queued && (await processRenderCore(workspaceId, queued.id))) report.videosRendered++;
  }

  const activity =
    report.ideasCreated + report.drafted + report.variantPosts + report.published +
    report.videosPackaged + report.videosRendered;
  if (activity > 0) {
    await writeAudit({
      workspaceId,
      action: "autopilot.cycle",
      entityType: "workspace",
      meta: report as unknown as Record<string, unknown>,
    });
  }
  return report;
}

/** Sweep every workspace; per-workspace failures never sink the sweep. */
export async function runAutopilotSweep(): Promise<void> {
  const workspaces = await db.workspace.findMany({ select: { id: true }, take: 100 });
  for (const ws of workspaces) {
    try {
      await runAutopilotCycle(ws.id);
    } catch (e) {
      console.error(`[autopilot] cycle failed for ${ws.id}:`, e instanceof Error ? e.message : e);
    }
  }
}
