import { db } from "@/lib/db";
import { llm } from "@/lib/llm";
import { runBlogChecks, requiredChecksPass } from "@/lib/blog-checks";
import { decryptSecret, type Encrypted } from "@/lib/blog-crypto";
import { wpCreatePost, type WpCredentials } from "@/lib/wordpress";
import { getModes, isGloballyPaused, writeAudit } from "@/lib/governance";

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
  const prompt = [
    `Write a blog post draft titled: "${post.title}".`,
    post.audience ? `Intended audience: ${post.audience}.` : null,
    post.focusKeyword
      ? `Primary SEO keyword: "${post.focusKeyword}" — use it naturally in the opening paragraph and at least one heading.`
      : null,
    `Length: about ${target} words.`,
    "Structure: strong opening hook, 3–5 h2 sections, actionable close. HTML only.",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await llm.complete({
    model: workspace.defaultModel ?? llm.defaultModel,
    system,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 4000,
  });

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

  const created = await wpCreatePost(creds, {
    title: post.metaTitle ?? post.title,
    slug: post.slug,
    content: post.body,
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
};

export async function runAutopilotCycle(workspaceId: string): Promise<CycleReport> {
  const report: CycleReport = { workspaceId, ideasCreated: 0, drafted: 0, variantPosts: 0, published: 0 };

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

  // 4. Publishing: auto mode only — and only gate-passing posts can go out.
  if (modes.publishing === "auto") {
    const ready = await db.blogPost.findMany({
      where: { workspaceId, status: "final_approval" },
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

  const activity = report.ideasCreated + report.drafted + report.variantPosts + report.published;
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
