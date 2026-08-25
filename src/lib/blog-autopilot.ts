import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { llm } from "@/lib/llm";
import { readJson } from "@/lib/db/json";
import { runBlogChecks, requiredChecksPass } from "@/lib/blog-checks";
import { decryptSecret, type Encrypted } from "@/lib/blog-crypto";
import {
  wpCreatePost,
  wpUploadMediaBytes,
  sniffImageMime,
  wpReadPost,
  wpResolveAuthor,
  wpResolveTerms,
  wpUploadMedia,
  type WpCredentials,
} from "@/lib/wordpress";
import { buildSeoMeta, effectiveFieldMap, isSeoPlugin, verifySeoMeta } from "@/lib/seo-plugins";
import { renderForPublish, stripLeadingH1 } from "@/lib/blog-render";
import { isRenderProfile, parseRenderRules } from "@/lib/design-render";
import { smePromptFor } from "@/lib/sme";
import { loadEditorialContext } from "@/lib/blog-slop";
import { notify } from "@/lib/notify";
import { storage } from "@/lib/storage";
import { parseScenes, scenesToSrt } from "@/lib/captions";
import { autoTaskForRenderFailure } from "@/lib/auto-tasks";
import { getModes, isGloballyPaused, writeAudit } from "@/lib/governance";
import { getVideoProvider, estimateCostUsd } from "@/lib/video";
import { getApiKey } from "@/lib/llm/keys";
import { templateGuidance, trackLabel, trackWordTarget } from "@/lib/blog-templates";
import { buildJsonLd } from "@/lib/blog-jsonld";
import { loadAssetGate, generateBlogImagesCore } from "@/lib/blog-images";
import {
  brandContextBlock,
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
import { isFullyAutonomous } from "@/lib/autonomy";

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
const GENERATION_ACTIONS = ["blog.draft_generated", "ideas.ai_discovery", "social.variants_generated", "social.post_generated"];

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
        // Priority first: higher-priority topics lead the list and win the cut
        // when a workspace has more than 25. This is the lever the
        // recommendation engine adjusts (src/lib/recommendations).
        orderBy: [{ priority: "desc" }, { name: "asc" }],
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
    // ⚠ 8000, not 1500: gemini-2.5-pro is a REASONING model that spends its
    // token budget thinking before emitting (the documented CLAUDE.md trap).
    // At 1500 these calls returned EMPTY content, so the JSON match failed and
    // the step silently produced nothing on every cycle since the workspaces
    // moved to Gemini — found 2026-08-04.
    maxTokens: 8000,
    timeoutMs: 120_000,
    workspaceId,
  });
  // ⚠ Unattended: mock "ideas" are fluent garbage rows a human then curates.
  // Same rule as autogen/SEO/images — refuse, audit, produce nothing.
  if (res.provider === "mock") {
    await writeAudit({ workspaceId, action: "blog.ideation_failed", entityType: "workspace", meta: { provider: "mock", reason: "provider unavailable — refused to store mock ideas" } });
    return 0;
  }

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
  // Mock outline text would be fed verbatim into the draft prompt as "this
  // approved outline" — refuse; drafting falls back to its generic structure.
  if (res.provider === "mock") return false;
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

/**
 * A draft the core refused (mock fallback / provider down) must not linger as
 * an empty `drafting` post — that is the documented stall shape: in no review
 * queue, unpublishable, invisible. Shared by the cycle and the human Draft
 * buttons: deletes the empty post (guarded on status + null body so a post
 * that somehow got content can't be swept away), restores the idea, and
 * notifies — once per idea per 6h, because the autopilot retries every cycle
 * and a provider outage must not page someone every 30 minutes.
 */
export async function revertRefusedDraft(
  workspaceId: string,
  postId: string,
  idea: { id: string; title: string },
  restoreStatus: string = "approved",
): Promise<void> {
  await db.blogPost.deleteMany({ where: { id: postId, workspaceId, status: "drafting", body: null } });
  await db.blogIdea.update({ where: { id: idea.id }, data: { status: restoreStatus, postId: null } }).catch(() => {});
  const already = await db.notification.count({
    where: { workspaceId, kind: "generation_failed", entityId: idea.id, createdAt: { gte: new Date(Date.now() - 6 * 3600_000) } },
  });
  if (already === 0) {
    await notify({
      workspaceId,
      kind: "generation_failed",
      title: `Couldn't draft "${idea.title.slice(0, 80)}"`,
      body: "The AI provider didn't answer (timeout or error) and the mock stand-in was refused, so nothing was stored. The idea is back on the board; drafting will be retried.",
      path: "/blog/ideas",
      entityType: "blog_idea",
      entityId: idea.id,
    });
  }
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
    brandContextBlock(workspaceId),
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
    // A 4000-token article on claude-sonnet takes longer than the router's
    // default 45s — that timeout is what turned CF's first two autonomous
    // drafts into stored mock prose on 2026-08-21.
    timeoutMs: 180_000,
    workspaceId,
  });
  // ⚠ The mock is fluent, and this body goes to review, WordPress and the
  // social variants. It must never be stored — not by the autopilot, not by a
  // human's Draft button. Fail with an audit trail instead; the caller decides
  // what happens to the empty post.
  if (res.provider === "mock") {
    await writeAudit({
      workspaceId,
      action: "blog.draft_failed",
      entityType: "blog_post",
      entityId: post.id,
      meta: { model: post.model ?? workspace.defaultModel ?? llm.defaultModel, provider: "mock", reason: "provider unavailable — refused to store mock output" },
    });
    return false;
  }

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
    // ⚠ provider, not just model: `model` is what was ASKED FOR. The 08-21
    // mock drafts audited as "claude-sonnet" while the mock had answered —
    // the ledger must record who actually replied.
    meta: { model: res.model, provider: res.provider, claimsFlagged: claims.length },
  });
  return true;
}

/**
 * Everything a freshly generated draft needs before it can sit at review:
 * park it at the `draft_review` checkpoint, render its featured/OG images, and
 * fill the SEO meta the publish gate requires.
 *
 * ⚠ THIS USED TO LIVE INSIDE THE AUTOPILOT CYCLE ONLY, and that was a stall
 * factory on the human side. A draft generated from Blog → Ideas ("Draft this",
 * "Auto-draft approved") or the editor's Generate-draft button kept
 * `status: "drafting"` — invisible to the review queue AND to Home's decision
 * list — with no images and no meta title/description, all three of which the
 * publish gate requires. Prod carried two such drafts for days with nothing
 * anywhere saying they were stuck (LSI "SEO in Non-Government Organization",
 * 08-12; CF "AI Grants Management", 08-16, which the owner then walked through
 * every step of by hand). It is the same defect the autopilot had before
 * 2026-08-12 — "a draft without them is a stall, not a choice" — one door over.
 *
 * Order and isolation are deliberate: the status flip happens FIRST and on its
 * own, so an image-provider outage or a mock LLM cannot undo a draft that just
 * succeeded. Both extras are best-effort and both are already idempotent —
 * images skip any role a human owns or approved, and SEO is fill-only.
 *
 * The status flip is a conditional `updateMany` on `status: "drafting"`, so
 * re-running the editor's button on a post that has moved on (in review, final
 * approval, published) can never drag it backwards.
 */
export async function completeFreshDraftCore(
  workspaceId: string,
  postId: string,
): Promise<{ advanced: boolean; imagesGenerated: number; seoOptimized: number }> {
  const out = { advanced: false, imagesGenerated: 0, seoOptimized: 0 };

  const moved = await db.blogPost.updateMany({
    where: { id: postId, workspaceId, status: "drafting" },
    data: { status: "draft_review" },
  });
  out.advanced = moved.count > 0;

  // Images ride the draft: briefs + featured/OG, landing `pending` at the same
  // review the article itself just parked at — one stop for the human, and with
  // requireImagesToPublish on (the default) the article can't publish without
  // them anyway. Gated on brand.aiImagesEnabled inside the core.
  try {
    out.imagesGenerated = await generateBlogImagesCore(workspaceId, postId);
  } catch (e) {
    console.error(`[blog] image generation failed for ${postId}:`, e instanceof Error ? e.message : e);
  }

  // SEO metadata too — the publish gate REQUIRES meta title, description and
  // slug. `blog:auto_seo` (absent = ON, "false" = off; toggle on Blog →
  // Automation) is the owner's switch. Fill-only: a re-run can never clobber
  // hand-tuned meta or a slug something has already been published under.
  try {
    const { getSetting } = await import("@/lib/settings");
    const autoSeo = await getSetting("blog:auto_seo", workspaceId).catch(() => "");
    if (autoSeo !== "false") {
      const { generateSeoMetaCore } = await import("@/lib/blog-seo");
      const seo = await generateSeoMetaCore(workspaceId, postId, { onlyFillEmpty: true });
      if (seo.ok) out.seoOptimized = 1;
      else if (seo.reason === "mock") console.warn(`[blog] SEO meta for ${postId} fell back to mock — skipped`);
    }
  } catch (e) {
    console.error(`[blog] SEO meta failed for ${postId}:`, e instanceof Error ? e.message : e);
  }

  return out;
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
    brandContextBlock(workspaceId),
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
    // ⚠ 8000, not 1500: gemini-2.5-pro is a REASONING model that spends its
    // token budget thinking before emitting (the documented CLAUDE.md trap).
    // At 1500 these calls returned EMPTY content, so the JSON match failed and
    // the step silently produced nothing on every cycle since the workspaces
    // moved to Gemini — found 2026-08-04.
    maxTokens: 8000,
    timeoutMs: 120_000,
    workspaceId,
  });
  // ⚠ These variants are social copy that auto-queues and SENDS under full
  // autonomy — mock text here reaches a real feed. Refuse before the delete
  // below can wipe good variants in favour of nothing.
  if (res.provider === "mock") {
    await writeAudit({ workspaceId, action: "social.variants_failed", entityType: "blog_post", entityId: post.id, meta: { provider: "mock", reason: "provider unavailable — refused to store mock variants" } });
    return 0;
  }

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
  // Stored images live at session-gated RELATIVE urls a server-side fetch
  // cannot read (the first real publish went out imageless because of this) —
  // resolve those to bytes from storage; only external urls are fetched.
  let media: { id: number; sourceUrl: string } | null = null;
  if (featured) {
    const storedKey = featured.url.match(/\/(?:uploads|api\/files)\/([^"'\s)]+)/)?.[1];
    if (storedKey) {
      const { storage } = await import("@/lib/storage");
      const buf = await storage.get(decodeURIComponent(storedKey)).catch(() => null);
      if (buf) {
        const bytes = new Uint8Array(buf);
        const mime = sniffImageMime(bytes);
        if (mime) {
          const ext = mime.split("/")[1].replace("jpeg", "jpg");
          media = await wpUploadMediaBytes(creds, bytes, `${post.slug || post.id}-featured.${ext}`, mime, featured.altText);
        }
      }
    } else {
      media = await wpUploadMedia(creds, featured.url, featured.altText);
    }
  }

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
  // The theme renders the headline; the body's leading h1 would duplicate it.
  const rendered = renderForPublish(stripLeadingH1(post.body), {
    headingSpec: brand.headingSpec,
    footerCredit: brand.footerCredit,
    renderProfile: isRenderProfile(brand.renderProfile) ? brand.renderProfile : "html",
    renderRules: parseRenderRules(brand.renderRules),
  });
  const content = rendered.html + jsonLd;

  const status = conn.publishAsDraft ? "draft" : "publish";
  const created = await wpCreatePost(creds, {
    // The EDITORIAL title is the on-page headline (user's call 2026-08-12 —
    // the first live publish surprised them with the 39-char SEO title as
    // its h1). The meta title still reaches search engines through the SEO
    // plugin's fields (seoValues.title, below) when one is configured.
    title: post.title,
    slug: post.slug,
    content,
    excerpt: post.metaDescription,
    status,
    meta,
    categories: cats.ids,
    tags: tags.ids,
    author: authorId ?? undefined,
    featuredMedia: media?.id,
    template: conn.template || undefined,
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
  // A mock storyboard would go on to spend real Veo money rendering nonsense.
  if (res.provider === "mock") return null;
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
 *
 * ── Why this never worked for Veo until 2026-07-28 ──────────────────────────
 * It used a bare `fetch(url)`. A Veo file URI is NOT publicly readable — it
 * needs the Google key — so every attempt came back 401 and hit `return null`.
 * The call site then fell back to the raw provider URL, the UI dutifully said
 * "couldn't be persisted", and no one could tell that the reason was a missing
 * credential rather than a storage problem. Two years of Veo renders would have
 * quietly gone dead after 48 hours.
 *
 * The download URL is NOT the file URI. Taken from the SDK's own downloader
 * (`files/<name>:download` + `alt=media`) rather than guessed — probing showed
 * a bare `?alt=media` on the resource URI returns 400 "File download is not
 * supported. Try getting metadata without ?alt=media." The `:download` verb is
 * required.
 *
 * Auth goes in an `x-goog-api-key` HEADER, never the query string: the key must
 * not land in a stored URL or a log line, which is also why `veoProvider`
 * deliberately returns the bare URI.
 *
 * ⚠ Verified as far as it can be without paying for a render: unauthenticated
 * gets 403, this construction authenticates and reaches the API, and the SDK's
 * own `files.download` issues the identical request. What is NOT covered is a
 * real Veo output — the endpoint refuses anything else with "Only GENERATED
 * files can be downloaded", so an uploaded test file cannot stand in for it.
 */
async function persistRenderOutput(
  url: string,
  providerName: string,
  workspaceId: string,
): Promise<string | null> {
  if (providerName === "mock") return null;
  try {
    let target = url;
    const headers: Record<string, string> = {};

    // Veo hands back a Gemini Files URI; HeyGen and friends hand back already
    // signed URLs that a bare fetch can read.
    const isGoogleFileUri = /generativelanguage\.googleapis\.com/.test(url);
    if (isGoogleFileUri) {
      const key = await getApiKey("google", workspaceId).catch(() => "");
      if (!key) {
        console.warn("[video] cannot persist Veo output — no Google key resolved for this workspace");
        return null;
      }
      headers["x-goog-api-key"] = key;
      // .../v1beta/files/<id>  →  .../v1beta/files/<id>:download?alt=media
      if (/\/files\/[^/:?]+$/.test(target)) target += ":download";
      if (!/[?&]alt=media\b/.test(target)) {
        target += (target.includes("?") ? "&" : "?") + "alt=media";
      }
    }

    const res = await fetch(target, { headers, signal: AbortSignal.timeout(120_000), redirect: "follow" });
    if (!res.ok) {
      // Say why. The silent `return null` here is what hid the missing-auth bug.
      console.warn(`[video] cannot persist ${providerName} output — download failed (HTTP ${res.status})`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.byteLength || buf.byteLength > 80 * 1024 * 1024) {
      console.warn(`[video] not persisting ${providerName} output — ${buf.byteLength} bytes is empty or over the 80MB cap`);
      return null;
    }
    const file = await storage.put("render.mp4", buf, res.headers.get("content-type") ?? "video/mp4");
    return file.url;
  } catch (e) {
    console.warn(`[video] cannot persist ${providerName} output:`, e instanceof Error ? e.message : e);
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
      // ⚠ `firstDurable` is tracked separately from `scenes[0].outputUrl`. A
      // scene falls back to the raw provider URL so it still PLAYS when the
      // persist failed, but `storedUrl` means "we hold the bytes" — writing the
      // fallback into it claims a durability we don't have, and the UI reads
      // that field to decide whether to warn about provider-URL expiry.
      let firstDurable: string | null = null;
      for (let i = 0; i < scenes.length; i++) {
        const out = await provider.render({
          prompt: scenes[i].prompt,
          seconds: scenes[i].seconds,
          aspect: render.aspect as "9:16" | "16:9" | "1:1",
          workspaceId,
        });
        const durable = await persistRenderOutput(out.url, out.provider, workspaceId);
        if (i === 0) firstDurable = durable;
        scenes[i] = { ...scenes[i], outputUrl: durable ?? out.url, status: "done" };
        await db.videoRender.update({ where: { id: render.id }, data: { scenes: JSON.stringify(scenes) } });
      }
      await db.videoRender.update({
        where: { id: render.id },
        data: {
          status: "done",
          provider: provider.name,
          outputUrl: scenes[0].outputUrl,
          storedUrl: firstDurable,
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
      const durable = await persistRenderOutput(out.url, out.provider, workspaceId);
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
  postsGenerated: number;
  imagesGenerated: number;
  seoOptimized: number;
  /** Full autonomy only: drafts moved past review because their gates passed. */
  autoAdvanced: number;
  /** Full autonomy only: pending AI images approved after a real vision look. */
  imagesAutoApproved: number;
  /** Full autonomy only: citations verified against a live-searched source. */
  citationsAutoVerified: number;
  /** Full autonomy only: social drafts given a slot with nobody clicking. */
  autoQueued: number;
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
    postsGenerated: 0,
    imagesGenerated: 0,
    seoOptimized: 0,
    autoAdvanced: 0,
    imagesAutoApproved: 0,
    citationsAutoVerified: 0,
    autoQueued: 0,
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
  // `autopilot:weekly_articles` caps how many articles the autopilot drafts in
  // any rolling 7 days — the owner's "N articles a week" dial. Unset = the old
  // behavior (bounded only by the approved-ideas pool and the daily budget).
  if (unattended("blog_drafting")) {
    const { getSetting } = await import("@/lib/settings");
    const weeklyRaw = parseInt(await getSetting("autopilot:weekly_articles", workspaceId).catch(() => ""), 10);
    let allowance = 2; // per-cycle cap, as before
    if (Number.isFinite(weeklyRaw) && weeklyRaw > 0) {
      const draftedThisWeek = await db.auditLog.count({
        where: { workspaceId, action: "blog.draft_generated", createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      });
      allowance = Math.min(2, Math.max(0, weeklyRaw - draftedThisWeek));
    }
    const approved = allowance > 0 ? await db.blogIdea.findMany({
      where: { workspaceId, status: "approved" },
      orderBy: { createdAt: "asc" },
      take: allowance,
    }) : [];
    for (const idea of approved) {
      const post = await db.blogPost.create({
        data: { workspaceId, title: idea.title, focusKeyword: idea.keyword, status: "drafting" },
      });
      await db.blogIdea.update({ where: { id: idea.id }, data: { status: "drafted", postId: post.id } });
      const ok = await generateDraftCore(workspaceId, post.id);
      if (ok) {
        report.drafted++;
        // Park at review, images, SEO meta — shared with the human "Draft this"
        // buttons (via the blog.finishdraft job) so both doors finish a draft
        // the same way. See completeFreshDraftCore.
        const finished = await completeFreshDraftCore(workspaceId, post.id);
        report.imagesGenerated += finished.imagesGenerated;
        report.seoOptimized += finished.seoOptimized;
      } else {
        // Refused draft (mock fallback / provider down). Don't leave the
        // documented stall shape — an empty `drafting` post in no queue — and
        // don't burn the idea: put it back so the next cycle retries.
        await revertRefusedDraft(workspaceId, post.id, idea);
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

    // 3½. De-novo social posts on a weekly quota — same mode dial, same lock,
    // same daily budget; additionally opt-in via social:autogen. One per
    // cycle: the 30-minute cadence spreads the quota rather than bursting it.
    const { generateSocialPostForWorkspace } = await import("@/lib/social/autogen");
    try {
      if (await generateSocialPostForWorkspace(workspaceId)) report.postsGenerated++;
    } catch (e) {
      console.error(`[social-autogen] failed for ${workspaceId}:`, e instanceof Error ? e.message : e);
    }
  }

  // 3¾. FULL AUTONOMY ONLY — the links that had no automatic step, and so kept
  // a workspace that looked fully configured from ever running itself.
  //
  // ⚠ None of this lowers a bar. Auto-review (owner's ask 2026-08-25) presses
  // the REVIEW buttons a human would: it fills missing SEO, renders missing
  // images, has a vision model actually look at pending renders before
  // approving them, and sources flagged claims from live search — verifying a
  // citation only when a source genuinely supports it. Advancing then runs the
  // SAME `requiredChecksPass` a human advancing the post has to clear, so what
  // auto-review could not satisfy honestly (an unsourceable claim, an image
  // that keeps failing inspection) still stops the article — and notifies.
  // Queueing still refuses anything held for approval.
  if (await isFullyAutonomous(workspaceId)) {
    // Blog: try to SATISFY the gates, then advance what passes.
    const atReview = await db.blogPost.findMany({
      where: { workspaceId, status: "draft_review" },
      orderBy: { updatedAt: "asc" },
      take: 3,
    });
    for (const post of atReview) {
      try {
        const { autoReviewCore } = await import("@/lib/blog-autoreview");
        const reviewed = await autoReviewCore(workspaceId, post.id);
        report.imagesAutoApproved += reviewed.imagesApproved;
        report.citationsAutoVerified += reviewed.citationsVerified;
        if (reviewed.seoFilled) report.seoOptimized++;
      } catch (e) {
        console.error(`[auto-review] failed for ${post.id}:`, e instanceof Error ? e.message : e);
      }
      // Re-read: auto-review may have edited the body and meta.
      const fresh = await db.blogPost.findFirst({ where: { id: post.id, workspaceId } });
      if (!fresh) continue;
      const unverified = await db.blogCitation.count({ where: { postId: post.id, verified: false } });
      const [assets, editorial] = await Promise.all([
        loadAssetGate(workspaceId, post.id),
        loadEditorialContext(workspaceId, fresh),
      ]);
      if (!requiredChecksPass(runBlogChecks(fresh, unverified, assets, editorial))) continue;
      await db.blogPost.update({ where: { id: post.id }, data: { status: "final_approval" } });
      await writeAudit({
        workspaceId, action: "blog.auto_advanced", entityType: "blog_post", entityId: post.id,
        meta: { from: "draft_review", to: "final_approval", via: "full autonomy" },
      });
      report.autoAdvanced++;
    }

    // Social: give unscheduled drafts a slot. Approval-held posts are skipped —
    // `require_approval` still means what it says, even here.
    const { getQueue, pickFreeSlot } = await import("@/lib/social/slots");
    const drafts = await db.socialPost.findMany({
      where: {
        workspaceId,
        status: "draft",
        scheduledAt: null,
        // ⚠ OR [null, "approved"], NEVER `notIn`. SQL NOT IN drops NULL rows,
        // so `approval notIn ['pending','changes']` silently matches nothing
        // for ordinary posts — which have approval NULL. This file's own module
        // docs warn about it for the publish sweep; the first cut of this query
        // did it anyway and queued zero posts on a fixture that had one waiting.
        OR: [{ approval: null }, { approval: "approved" }],
      },
      orderBy: { createdAt: "asc" },
      take: 10,
      select: { id: true, category: true },
    });
    if (drafts.length) {
      const { free } = await getQueue(workspaceId, { limit: 200 });
      let remaining = free;
      for (const d of drafts) {
        const slot = pickFreeSlot(remaining, d.category);
        if (!slot) break; // calendar full — the rest wait for a slot, not a person
        await db.socialPost.update({ where: { id: d.id }, data: { scheduledAt: slot.at, status: "scheduled" } });
        remaining = remaining.filter((f) => f.at.getTime() !== slot.at.getTime());
        report.autoQueued++;
      }
      if (report.autoQueued) {
        await writeAudit({
          workspaceId, action: "social.auto_queued", entityType: "social_post",
          meta: { count: report.autoQueued, via: "full autonomy" },
        });
      }
    }
  }

  // 4. Publishing. Auto mode: any gate-passing final_approval post whose
  // scheduledAt is unset or due. Assisted mode: ONLY due scheduled posts —
  // an admin setting the time was the human approval. Manual: nothing.
  if (modes.publishing === "auto" || modes.publishing === "assisted") {
    const now = new Date();
    // `autopilot:publish_day` (Date#getDay 0–6, unset = any day) — the owner's
    // "articles go out on Wednesdays" dial. On every other day auto mode
    // behaves like assisted: a time a human set on a post is still honoured,
    // but gate-passing unscheduled posts wait at final_approval for the day.
    // The weekday is read in the workspace's posting timezone, never the
    // server's — Railway runs in UTC and "Wednesday" means the owner's.
    let autoToday = modes.publishing === "auto";
    if (autoToday) {
      const { getSetting } = await import("@/lib/settings");
      const day = parseInt(await getSetting("autopilot:publish_day", workspaceId).catch(() => ""), 10);
      if (Number.isInteger(day) && day >= 0 && day <= 6) {
        const { getPostingTimeZone, zonedParts } = await import("@/lib/social/slots");
        autoToday = zonedParts(now, await getPostingTimeZone(workspaceId)).weekday === day;
      }
    }
    const ready = await db.blogPost.findMany({
      where: autoToday
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
    report.ideasCreated + report.drafted + report.variantPosts + report.postsGenerated +
    report.imagesGenerated + report.seoOptimized + report.published + report.videosPackaged +
    report.videosRendered;
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
