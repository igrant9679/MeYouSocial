import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { llm } from "@/lib/llm";
import { readJson } from "@/lib/db/json";
import { runBlogChecks, requiredChecksPass } from "@/lib/blog-checks";
import { decryptSecret, type Encrypted } from "@/lib/blog-crypto";
import {
  wpCreatePost,
  wpReadPost,
  wpResolveAuthor,
  wpResolveTerms,
  wpUploadMedia,
  type WpCredentials,
} from "@/lib/wordpress";
import { buildSeoMeta, effectiveFieldMap, isSeoPlugin, verifySeoMeta } from "@/lib/seo-plugins";
import { renderForPublish } from "@/lib/blog-render";
import { isRenderProfile, parseRenderRules } from "@/lib/design-render";
import { smePromptFor } from "@/lib/sme";
import { loadEditorialContext } from "@/lib/blog-slop";
import { notify } from "@/lib/notify";
import { storage } from "@/lib/storage";
import { parseScenes, scenesToSrt } from "@/lib/captions";
import { autoTaskForRenderFailure } from "@/lib/auto-tasks";
import { getModes, isGloballyPaused, writeAudit } from "@/lib/governance";
import { getVideoProvider, estimateCostUsd } from "@/lib/video";
import { templateGuidance, trackLabel, trackWordTarget } from "@/lib/blog-templates";
import { buildJsonLd } from "@/lib/blog-jsonld";
import { loadAssetGate } from "@/lib/blog-images";
import {
  brandGuardrailBlock,
  ensureMotifDirectives,
  getBrandKit,
  getPlatformMotifs,
  motifBlockShort,
  motifPromptFor,
  normalizeMotifs,
  parseMotifs,
  platformMotifBlock,
  platformMotifWeights,
  resolveMotifs,
  serializeMotifs,
} from "@/lib/motifs";
import { rescoreIdeas } from "@/lib/blog-idea-scoring";

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

/**
 * Discover blog ideas. When `topicId` is given the run is focused on that
 * workspace Topic (its description + related phrases go into the prompt and
 * every idea produced is stamped with it). Without one, the workspace's active
 * topics are supplied as steering context so ideas stay on-theme — but nothing
 * is stamped, because we can't reliably map a free-text idea back to a topic.
 */
export async function discoverIdeasCore(workspaceId: string, topicId?: string | null): Promise<number> {
  if (await isGloballyPaused(workspaceId)) return 0;
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) return 0;
  const org = await db.orgProfile.findUnique({ where: { workspaceId } });
  const focusTopic = topicId
    ? await db.topic.findFirst({ where: { id: topicId, workspaceId, status: "active" } })
    : null;
  const allTopics = focusTopic
    ? []
    : await db.topic.findMany({
        where: { workspaceId, status: "active" },
        select: { name: true },
        take: 25,
      });
  const existing = await db.blogIdea.findMany({
    where: { workspaceId },
    select: { title: true },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  // FR-5: ideas arrive tagged. Tier/audience/target page/motifs come from the
  // model; the priority score is computed from workspace facts afterwards.
  const [pages, keywords, motifDirectives] = await Promise.all([
    db.sitePage.findMany({ where: { workspaceId }, select: { url: true, title: true }, take: 40 }),
    db.keyword.findMany({ where: { workspaceId, status: "active" }, select: { phrase: true, tier: true }, take: 60 }),
    ensureMotifDirectives(workspaceId),
  ]);

  const system =
    "You generate blog topic ideas and tag them. Respond ONLY with a JSON array of objects: " +
    '[{"title": string, "angle": string, "keyword": string, "tier": 1|2|3|4, "audience": string, ' +
    '"targetPage": string, "motifs": [{"key": string, "weight": number}], "seasonalHook": string}] — ' +
    "no prose, no markdown fences. Titles must be specific and non-generic. The angle explains why this topic " +
    "serves the audience. tier 1 = broad head topic … 4 = long-tail. targetPage must be one of the supplied page " +
    "URLs or omitted. motifs must use the supplied motif keys and sum to 100. seasonalHook only when the topic " +
    "genuinely rides a calendar moment — omit it otherwise. " +
    "Never invent statistics or cite studies in the angle.";
  const prompt = [
    org?.description
      ? `The organization: ${org.description}${org.industry ? ` Industry: ${org.industry}.` : ""}${org.audience ? ` Audience: ${org.audience}.` : ""}`
      : "No organization profile is set — generate broadly useful business-content ideas and note that grounding is missing.",
    `Motif keys available: ${motifDirectives.map((d) => `${d.key} (${d.label})`).join(", ")}.`,
    focusTopic
      ? `EVERY idea must belong to this topic: "${focusTopic.name}".${focusTopic.description ? ` It covers: ${focusTopic.description}` : ""}${
          readJson<string[]>(focusTopic.keywords, []).length
            ? ` Related phrases: ${readJson<string[]>(focusTopic.keywords, []).join(", ")}.`
            : ""
        }`
      : allTopics.length
        ? `Topics this organization publishes about — prefer ideas that fit one of them: ${allTopics.map((t) => t.name).join(", ")}.`
        : null,
    keywords.length ? `Keyword strategy (phrase → tier): ${keywords.map((k) => `${k.phrase} → ${k.tier}`).join("; ")}` : null,
    pages.length ? `Service pages that ideas can support:\n${pages.map((p) => `${p.url} — ${p.title}`).join("\n")}` : null,
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
    workspaceId,
  });

  type RawIdea = {
    title?: string;
    angle?: string;
    keyword?: string;
    tier?: unknown;
    audience?: string;
    targetPage?: string;
    motifs?: unknown;
    seasonalHook?: string;
  };
  let ideas: RawIdea[] = [];
  try {
    const match = res.content.match(/\[[\s\S]*\]/);
    ideas = match ? JSON.parse(match[0]) : [];
  } catch {
    ideas = [];
  }
  const pageUrls = new Set(pages.map((p) => p.url));
  const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const rows = ideas
    .filter((i) => typeof i.title === "string" && i.title.trim().length > 3)
    .slice(0, 6)
    .map((i) => {
      const tierNum = Number(i.tier);
      const targetPage = text(i.targetPage, 500);
      return {
        workspaceId,
        title: i.title!.trim().slice(0, 200),
        angle: text(i.angle, 500),
        keyword: text(i.keyword, 80),
        tier: Number.isFinite(tierNum) && tierNum >= 1 && tierNum <= 4 ? Math.round(tierNum) : null,
        audience: text(i.audience, 120),
        // Only keep a target page we actually know about — no invented URLs.
        targetPage: targetPage && pageUrls.has(targetPage) ? targetPage : null,
        motifs: serializeMotifs(normalizeMotifs(parseMotifs(JSON.stringify(i.motifs ?? [])))),
        seasonalHook: text(i.seasonalHook, 120),
        // Only stamp the topic when the run was focused on one.
        topicId: focusTopic?.id ?? null,
        source: "ai",
      };
    });
  if (rows.length) await db.blogIdea.createMany({ data: rows });
  // Priority + dedupe are computed from workspace facts, never asked of the model.
  await rescoreIdeas(workspaceId);
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
  // The dominant motif decides the shape of the outline, not just the prose;
  // the expert decides what the sections can credibly claim.
  const [motifs, sme] = await Promise.all([
    motifPromptFor(workspaceId, post, "short"),
    smePromptFor(workspaceId, post, "short"),
  ]);

  const prompt = [
    `Outline a blog post titled: "${post.title}".`,
    motifs,
    sme,
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
    workspaceId,
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
  // FR-2: the motif blend (post selection, else the workspace default for this
  // tier/audience) is the tone engine — it replaced the old 4-option tone field.
  const [motifs, guardrails, sme] = await Promise.all([
    motifPromptFor(workspaceId, post),
    brandGuardrailBlock(workspaceId),
    smePromptFor(workspaceId, post),
  ]);

  const system = [
    "You are a senior content writer producing an SEO blog post draft as clean HTML (h2/h3, p, ul/li — no <html>/<body> wrapper).",
    "Truthfulness rules (hard requirements): never invent statistics, quotes, prices, or named studies. Where a factual claim would need verification, write [NEEDS SOURCE] immediately after it. Do not fabricate customer stories.",
    org?.description
      ? `About the organization this blog belongs to (ground every claim in this): ${org.description}${org.industry ? ` Industry: ${org.industry}.` : ""}${org.audience ? ` Primary audience: ${org.audience}.` : ""}`
      : null,
    voice ? `Write in the brand voice "${voice.label}". Voice profile (JSON): ${clip(voice.data) ?? "n/a"}` : null,
    sme,
    motifs,
    channel?.audience
      ? `Audience profile (JSON): demographics ${clip(channel.audience.demographics) ?? "n/a"}; psychographics ${clip(channel.audience.psychographics) ?? "n/a"}`
      : null,
    guardrails,
  ]
    .filter(Boolean)
    .join("\n\n");

  // FR-6: an explicit target wins; otherwise the content tier's track length.
  const target = post.wordCountTarget ?? trackWordTarget(post.contentTier);
  let outline: Array<{ heading: string; points: string[] }> = [];
  try { outline = post.outline ? JSON.parse(post.outline) : []; } catch { outline = []; }
  let secondary: string[] = [];
  try { secondary = JSON.parse(post.secondaryKeywords) as string[]; } catch { secondary = []; }
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
    post.readingLevel && LEVEL_HINT[post.readingLevel] ? `Reading level: ${LEVEL_HINT[post.readingLevel]}.` : null,
    templateGuidance(post.templateKey) ? `Structure template: ${templateGuidance(post.templateKey)}` : null,
    outline.length
      ? `Follow this approved outline exactly (h2 per section):\n${outline.map((s) => `- ${s.heading}${s.points.length ? ` (${s.points.join("; ")})` : ""}`).join("\n")}`
      : "Structure: strong opening hook, 3–5 h2 sections, actionable close.",
    trackLabel(post.contentTier) ? `This is a ${trackLabel(post.contentTier)} piece.` : null,
    `Length: about ${target} words. HTML only.`,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await llm.complete({
    model: post.model ?? workspace.defaultModel ?? llm.defaultModel,
    system,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 4000,
    workspaceId,
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
  // FR-2 per-channel motif mapping: each variant is written in its channel's
  // mapped motif, falling back to the article's own blend when unmapped.
  const articleWeights = await resolveMotifs(workspaceId, post);
  const [channelMotifs, guardrails] = await Promise.all([
    platformMotifBlock(workspaceId, ["linkedin", "x", "instagram", "facebook"], articleWeights),
    brandGuardrailBlock(workspaceId),
  ]);

  const prompt = [
    `Blog post title: "${post.title}"`,
    org?.description ? `The organization: ${org.description.slice(0, 400)}` : null,
    channelMotifs,
    guardrails,
    `Article summary: ${summary}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await llm.complete({
    model: workspace.defaultModel ?? llm.defaultModel,
    system,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 1500,
    workspaceId,
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
  // Already handed off as a WordPress draft — creating a second one on the next
  // scheduler cycle (or a double-click) would duplicate the post over there.
  if (post.wpPostId != null && post.status !== "published") return false;

  const unverified = await db.blogCitation.count({ where: { postId: post.id, verified: false } });
  const [assets, editorial] = await Promise.all([
    loadAssetGate(workspaceId, post.id),
    loadEditorialContext(workspaceId, post),
  ]);
  if (!requiredChecksPass(runBlogChecks(post, unverified, assets, editorial))) return false;

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

  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  const brand = await getBrandKit(workspaceId);
  const images = await db.blogImage.findMany({ where: { postId: post.id } });
  const featured = images.find((i) => i.role === "featured");
  const ogImage = images.find((i) => i.role === "og");

  // Featured image goes into the media library rather than being hotlinked.
  const media = featured ? await wpUploadMedia(creds, featured.url, featured.altText) : null;

  // Taxonomy: the post's own terms, falling back to the connection defaults.
  const postCategories = parseStringArray(post.categories);
  const postTags = parseStringArray(post.tags);
  const categoryNames = postCategories.length ? postCategories : parseStringArray(conn.defaultCategories);
  const tagNames = postTags.length ? postTags : parseStringArray(conn.defaultTags);
  const [cats, tags] = await Promise.all([
    categoryNames.length ? wpResolveTerms(creds, "categories", categoryNames) : Promise.resolve({ ids: [], missed: [] }),
    tagNames.length ? wpResolveTerms(creds, "tags", tagNames) : Promise.resolve({ ids: [], missed: [] }),
  ]);
  const authorId = conn.defaultAuthor ? await wpResolveAuthor(creds, conn.defaultAuthor) : null;

  // SEO plugin fields, mapped to this install's meta keys.
  const plugin = isSeoPlugin(conn.seoPlugin) ? conn.seoPlugin : "none";
  const fieldMap = effectiveFieldMap(plugin, conn.seoFieldMap);
  const seoValues = {
    title: post.metaTitle ?? post.title,
    description: post.metaDescription ?? undefined,
    focusKeyword: post.focusKeyword ?? undefined,
    canonical: post.canonicalUrl ?? undefined,
    ogTitle: post.ogTitle ?? post.metaTitle ?? post.title,
    ogDescription: post.ogDescription ?? post.metaDescription ?? undefined,
    ogImage: ogImage?.url ?? undefined,
  };
  const meta = buildSeoMeta(fieldMap, seoValues);

  // Structured data rides inside the content (works on any WP theme/plugin).
  const jsonLd = `\n<script type="application/ld+json">${buildJsonLd(post, workspace?.name ?? "MeYouSocial")}</script>`;
  const rendered = renderForPublish(post.body, {
    headingSpec: brand.headingSpec,
    footerCredit: brand.footerCredit,
    renderProfile: isRenderProfile(brand.renderProfile) ? brand.renderProfile : "html",
    renderRules: parseRenderRules(brand.renderRules),
  });
  const content = rendered.html + jsonLd;

  const status = conn.publishAsDraft ? "draft" : "publish";
  const created = await wpCreatePost(creds, {
    title: post.metaTitle ?? post.title,
    slug: post.slug,
    content,
    excerpt: post.metaDescription,
    status,
    meta,
    categories: cats.ids,
    tags: tags.ids,
    author: authorId ?? undefined,
    featuredMedia: media?.id,
  });

  // "Sent" is not "stored": WordPress drops meta keys that aren't registered
  // for REST. Read the post back and report what actually landed.
  const readBack = await wpReadPost(creds, created.id);
  const seoOutcomes = verifySeoMeta(fieldMap, seoValues, readBack?.meta ?? null);
  const report = {
    at: new Date().toISOString(),
    wpPostId: created.id,
    status,
    plugin,
    renderProfile: brand.renderProfile,
    rendered: rendered.report,
    seo: seoOutcomes,
    seoUnverified: readBack ? false : true,
    featuredMedia: media ? { id: media.id, applied: readBack ? readBack.featuredMedia === media.id : null } : null,
    featuredUploadFailed: !!featured && !media,
    categories: { requested: categoryNames, applied: readBack?.categories.length ?? cats.ids.length, missed: cats.missed },
    tags: { requested: tagNames, applied: readBack?.tags.length ?? tags.ids.length, missed: tags.missed },
    author: conn.defaultAuthor ? { requested: conn.defaultAuthor, resolved: authorId } : null,
  };

  await db.blogPost.update({
    where: { id: post.id },
    data: {
      // A draft handoff hasn't gone live — don't claim it has.
      status: status === "publish" ? "published" : post.status,
      publishedAt: status === "publish" ? new Date() : null,
      publishedUrl: created.link,
      wpPostId: created.id,
      publishReport: JSON.stringify(report),
    },
  });
  await writeAudit({
    workspaceId,
    action: status === "publish" ? "blog.published_wordpress" : "blog.drafted_to_wordpress",
    entityType: "blog_post",
    entityId: post.id,
    meta: {
      wpPostId: created.id,
      link: created.link,
      seoAccepted: seoOutcomes.filter((o) => o.accepted).length,
      seoSent: seoOutcomes.length,
    },
  });
  return true;
}

function parseStringArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json);
    return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string" && !!s.trim()).map((s) => s.trim()) : [];
  } catch {
    return [];
  }
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
  // The video channel's mapped motif shapes the hook's mood and text.
  const [articleWeights, platformMap] = await Promise.all([
    resolveMotifs(workspaceId, post),
    getPlatformMotifs(workspaceId),
  ]);
  const videoWeights = platformMotifWeights(platformMap.video, articleWeights);
  const motifLine = videoWeights.length
    ? motifBlockShort(await ensureMotifDirectives(workspaceId), videoWeights)
    : null;

  // Slice 4: a multi-scene storyboard, not a single clip. Each scene is one
  // provider render; on-screen text drives captions and the narration script.
  const system =
    "You write storyboards for an AI video generator producing short-form vertical videos. " +
    'Respond ONLY with a JSON object: {"title": string, "scenes": [{"prompt": string, "seconds": number, "text": string}]}. ' +
    "3 to 4 scenes, 4-8 seconds each, ~20 seconds total. Each prompt describes ONE visually concrete scene " +
    "(subject, setting, camera movement, mood). `text` is that scene's on-screen caption (≤8 words) — scene 1 is the hook, " +
    "the last scene is the call to action. No statistics, no invented claims, no brand logos.";
  const res = await llm.complete({
    model: workspace.defaultModel ?? llm.defaultModel,
    system,
    messages: [
      {
        role: "user",
        content: [`Article title: "${post.title}"`, motifLine, `Article summary: ${summary}`]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    maxTokens: 900,
    workspaceId,
  });
  let parsed: { title?: string; prompt?: string; scenes?: unknown } = {};
  try {
    const match = res.content.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : {};
  } catch {
    parsed = {};
  }
  const scenes = parseScenes(JSON.stringify(parsed.scenes ?? [])).slice(0, 4).map((s) => ({
    ...s,
    seconds: Math.min(s.seconds, env.VIDEO_MAX_SECONDS),
    status: "planned",
  }));
  // Back-compat: a single-prompt response still packages as a one-scene board.
  if (!scenes.length && typeof parsed.prompt === "string" && parsed.prompt.trim()) {
    scenes.push({ prompt: parsed.prompt.trim(), seconds: env.VIDEO_MAX_SECONDS, text: null, outputUrl: null, status: "planned" });
  }
  if (!scenes.length) return null;

  const totalSeconds = scenes.reduce((a, s) => a + s.seconds, 0);
  const render = await db.videoRender.create({
    data: {
      workspaceId,
      blogPostId: post.id,
      topicId: post.topicId, // the source post's topic follows into the render
      title: (parsed.title ?? post.title).slice(0, 200),
      prompt: scenes[0].prompt.slice(0, 2000),
      scenes: JSON.stringify(scenes),
      seconds: totalSeconds,
      aspect: "9:16",
      costEstimate: estimateCostUsd(totalSeconds),
    },
  });
  await writeAudit({
    workspaceId,
    action: "video.packaged",
    entityType: "video_render",
    entityId: render.id,
    meta: { blogPostId: post.id, scenes: scenes.length, seconds: totalSeconds, costEstimate: render.costEstimate },
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

/**
 * Persist a provider's output into StorageProvider so it outlives expiring
 * URIs (Veo's die in ~2 days). Skipped for the mock's stable sample URL and
 * for anything over 80MB. Returns the durable URL, or null when not persisted.
 */
async function persistRenderOutput(url: string, providerName: string): Promise<string | null> {
  if (providerName === "mock") return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000), redirect: "follow" });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.byteLength || buf.byteLength > 80 * 1024 * 1024) return null;
    const file = await storage.put("render.mp4", buf, res.headers.get("content-type") ?? "video/mp4");
    return file.url;
  } catch {
    return null;
  }
}

/**
 * Process one queued render through the provider. Renders every scene of the
 * storyboard (each counts against the daily cap), persists output to storage,
 * and generates the SRT from scene timings. Minutes-long — background only.
 */
export async function processRenderCore(workspaceId: string, renderId: string): Promise<boolean> {
  if (await isGloballyPaused(workspaceId)) return false;
  const render = await db.videoRender.findFirst({ where: { id: renderId, workspaceId, status: "queued" } });
  if (!render) return false;
  if ((await rendersToday(workspaceId)) >= env.VIDEO_DAILY_RENDER_CAP) return false;

  const provider = await getVideoProvider(workspaceId);
  await db.videoRender.update({ where: { id: render.id }, data: { status: "rendering", provider: provider.name } });
  const scenes = parseScenes(render.scenes);
  try {
    if (scenes.length > 1) {
      // Storyboard: render scene by scene, recording progress as it happens so
      // a mid-board failure keeps the completed clips.
      for (let i = 0; i < scenes.length; i++) {
        const out = await provider.render({
          prompt: scenes[i].prompt,
          seconds: scenes[i].seconds,
          aspect: render.aspect as "9:16" | "16:9" | "1:1",
          workspaceId,
        });
        const durable = await persistRenderOutput(out.url, out.provider);
        scenes[i] = { ...scenes[i], outputUrl: durable ?? out.url, status: "done" };
        await db.videoRender.update({ where: { id: render.id }, data: { scenes: JSON.stringify(scenes) } });
      }
      await db.videoRender.update({
        where: { id: render.id },
        data: {
          status: "done",
          provider: provider.name,
          outputUrl: scenes[0].outputUrl,
          storedUrl: scenes[0].outputUrl,
          srt: scenesToSrt(scenes),
        },
      });
    } else {
      const out = await provider.render({
        prompt: render.prompt,
        seconds: render.seconds,
        aspect: render.aspect as "9:16" | "16:9" | "1:1",
        workspaceId,
      });
      const durable = await persistRenderOutput(out.url, out.provider);
      await db.videoRender.update({
        where: { id: render.id },
        data: {
          status: "done",
          outputUrl: out.url,
          storedUrl: durable,
          provider: out.provider,
          seconds: out.seconds,
          srt: scenes.length ? scenesToSrt(scenes) : null,
        },
      });
    }
    await writeAudit({
      workspaceId,
      action: "video.rendered",
      entityType: "video_render",
      entityId: render.id,
      meta: { provider: provider.name, scenes: Math.max(1, scenes.length) },
    });
    // A multi-scene board's deliverable is the stitched file, so assemble it
    // straight away. Best-effort by design — the render is already a success.
    if (scenes.length > 1) {
      await assembleRenderCore(workspaceId, render.id).catch(() => false);
    }
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 500) : "render failed";
    await db.videoRender.update({
      where: { id: render.id },
      data: { status: "failed", error: message },
    });
    await writeAudit({
      workspaceId,
      action: "video.render_failed",
      entityType: "video_render",
      entityId: render.id,
      meta: { provider: provider.name },
    });
    // Someone should look before a retry loop burns budget.
    await autoTaskForRenderFailure(workspaceId, { id: render.id, title: render.title, error: message });
    return false;
  }
}

/**
 * Stitch a finished storyboard's clips into one file (ffmpeg). Runs after a
 * successful multi-scene render and on demand from the storyboard page.
 *
 * Never throws and never touches `status`: a render whose assembly fails is
 * still a successful render with playable per-scene clips. The reason is
 * recorded on `assemblyError` so the UI can be specific about it.
 */
export async function assembleRenderCore(workspaceId: string, renderId: string): Promise<boolean> {
  const render = await db.videoRender.findFirst({ where: { id: renderId, workspaceId } });
  if (!render || render.status !== "done") return false;
  const scenes = parseScenes(render.scenes);
  if (scenes.filter((s) => s.outputUrl).length < 2) return false;

  await db.videoRender.update({
    where: { id: render.id },
    data: { assemblyStatus: "assembling", assemblyError: null },
  });
  try {
    const { assembleScenes } = await import("@/lib/video/assemble");
    const out = await assembleScenes(scenes, render.aspect, render.voiceoverUrl);
    await db.videoRender.update({
      where: { id: render.id },
      data: { assembledUrl: out.url, assemblyStatus: "done", assemblyError: null },
    });
    await writeAudit({
      workspaceId,
      action: "video.assembled",
      entityType: "video_render",
      entityId: render.id,
      meta: { clips: out.clips, bytes: out.bytes, withVoiceover: out.withVoiceover },
    });
    return true;
  } catch (e) {
    const { AssemblyUnavailable } = await import("@/lib/video/assemble");
    const unavailable = e instanceof AssemblyUnavailable;
    await db.videoRender.update({
      where: { id: render.id },
      data: {
        assemblyStatus: unavailable ? "unavailable" : "failed",
        assemblyError: e instanceof Error ? e.message.slice(0, 500) : "assembly failed",
      },
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
          refreshPostId: p.id,
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
              wpPostId: null,
              OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
            }
          : { workspaceId, status: "final_approval", wpPostId: null, scheduledAt: { lte: now } },
      orderBy: { updatedAt: "asc" },
      take: 2,
    });
    for (const p of ready) {
      try {
        if (await publishCore(workspaceId, p.id)) report.published++;
      } catch (e) {
        // WP outage or rejection — leave the post at final_approval for the next
        // cycle, but tell someone. A silent retry loop is how a broken
        // integration goes unnoticed for a week.
        await notify({
          workspaceId,
          kind: "publish_failed",
          title: `Publishing "${p.title}" failed`,
          body: e instanceof Error ? e.message.slice(0, 400) : "WordPress rejected the request.",
          path: `/blog/${p.id}`,
          entityType: "blog_post",
          entityId: p.id,
        });
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
