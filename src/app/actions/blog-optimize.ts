"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { llm } from "@/lib/llm";
import { getSearchProvider } from "@/lib/search";
import { isGloballyPaused, writeAudit } from "@/lib/governance";
import { returnToReviewAfterEdit } from "@/lib/blog-gates";
import { placeholderProblem } from "@/lib/studio-ai";

/**
 * Wave B′ differentiators: E-E-A-T review, featured-snippet blocks, internal
 * link suggestions (SitePage inventory), content-gap analysis (honest
 * needs-a-search-key state while the SearchProvider is mocked).
 */

// ---- E-E-A-T -----------------------------------------------------------------

export async function eeatReviewAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  if (await isGloballyPaused(workspace.id)) return;
  const post = await db.blogPost.findFirst({
    where: { id, workspaceId: workspace.id },
    include: { citations: true },
  });
  if (!post?.body) return;
  const org = await db.orgProfile.findUnique({ where: { workspaceId: workspace.id } });

  const res = await llm.complete({
    model: post.model ?? workspace.defaultModel ?? llm.defaultModel,
    system:
      "You review blog content against Google's E-E-A-T (experience, expertise, authoritativeness, trust). " +
      'Respond ONLY with JSON: {"summary": string, "findings": [{"dimension": "experience"|"expertise"|"authority"|"trust", "finding": string, "suggestion": string}]} — max 8 findings, concrete and actionable.',
    messages: [
      {
        role: "user",
        content: [
          `Article: "${post.title}"`,
          org?.description ? `Publisher: ${org.description.slice(0, 300)}` : null,
          `Citations: ${post.citations.filter((c) => c.verified).length} verified, ${post.citations.filter((c) => !c.verified).length} unverified.`,
          `Content: ${post.body.replace(/<[^>]+>/g, " ").slice(0, 3000)}`,
        ].filter(Boolean).join("\n"),
      },
    ],
    maxTokens: 1200,
    workspaceId: workspace.id,
  });
  let review: unknown = null;
  try {
    const m = res.content.match(/\{[\s\S]*\}/);
    review = m ? JSON.parse(m[0]) : null;
  } catch {
    review = null;
  }
  if (!review) return;
  await db.blogPost.update({ where: { id: post.id }, data: { eeatReview: JSON.stringify(review) } });
  await writeAudit({ workspaceId: workspace.id, action: "blog.eeat_reviewed", entityType: "blog_post", entityId: post.id });
  revalidatePath(`/blog/${id}`);
}

/**
 * Back to the article's Optimize tab, saying what happened (E-ART-19: the Quick
 * additions returned in silence — already there, paused, protected, no site
 * pages, or the AI gave nothing usable all looked like a button that did nothing).
 */
function backToOptimize(id: string, message: string, kind: "ok" | "err" = "ok"): never {
  redirect(`/blog/${encodeURIComponent(id)}?tab=optimize&${kind === "ok" ? "flash" : "flashErr"}=${encodeURIComponent(message)}`);
}
const PAUSED = "Everything is paused (Settings → Automation), so the AI isn't run — resume to use this.";
const PROTECTED = "This article is protected from rewrites, so nothing was added — turn the protection off first.";

// ---- Featured-snippet blocks -------------------------------------------------

export async function addFaqSectionAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  if (await isGloballyPaused(workspace.id)) backToOptimize(id, PAUSED, "err");
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post?.body) return backToOptimize(id, "This article has no text yet — write or draft it first.", "err");
  if (post.protectedFromRewrite) backToOptimize(id, PROTECTED, "err");
  if (/frequently asked/i.test(post.body)) backToOptimize(id, "This article already has an FAQ section.", "err");

  const res = await llm.complete({
    model: post.model ?? workspace.defaultModel ?? llm.defaultModel,
    system:
      'Generate a FAQ section for a blog post. Respond ONLY with JSON: [{"q": string, "a": string}] — 3 to 5 pairs. Answers are 2-3 sentences, direct, snippet-friendly, and only claim what the article supports. No invented statistics.',
    messages: [{ role: "user", content: `Article "${post.title}":\n${post.body.replace(/<[^>]+>/g, " ").slice(0, 2500)}` }],
    maxTokens: 900,
    workspaceId: workspace.id,
  });
  let faq: Array<{ q?: string; a?: string }> = [];
  try {
    const m = res.content.match(/\[[\s\S]*\]/);
    faq = m ? JSON.parse(m[0]) : [];
  } catch {
    faq = [];
  }
  const pairs = faq.filter((f) => typeof f.q === "string" && typeof f.a === "string").slice(0, 5);
  const placeholder = placeholderProblem(res, "no FAQ was added");
  if (placeholder) backToOptimize(id, placeholder, "err");
  if (!pairs.length) backToOptimize(id, "The AI's answer had no usable questions, so nothing was added — try again.", "err");

  await db.blogPostVersion.create({ data: { postId: post.id, label: "before FAQ section", body: post.body } });
  const html =
    `\n<h2>Frequently asked questions</h2>\n` +
    pairs.map((f) => `<h3>${f.q}</h3>\n<p>${f.a}</p>`).join("\n");
  await db.blogPost.update({ where: { id: post.id }, data: { body: post.body + html } });
  await returnToReviewAfterEdit(workspace.id, post.id, "FAQ section");
  revalidatePath(`/blog/${id}`);
  backToOptimize(id, `Added an FAQ section with ${pairs.length} questions (the article before it is kept as a version).`);
}

export async function addKeyTakeawaysAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  if (await isGloballyPaused(workspace.id)) backToOptimize(id, PAUSED, "err");
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post?.body) return backToOptimize(id, "This article has no text yet — write or draft it first.", "err");
  if (post.protectedFromRewrite) backToOptimize(id, PROTECTED, "err");
  if (/key takeaways/i.test(post.body)) backToOptimize(id, "This article already has a key-takeaways list.", "err");

  const res = await llm.complete({
    model: post.model ?? workspace.defaultModel ?? llm.defaultModel,
    system:
      'Generate a key-takeaways list. Respond ONLY with a JSON array of 3-5 short strings (≤120 chars), each a concrete takeaway the article supports. Snippet-friendly, no invented numbers.',
    messages: [{ role: "user", content: `Article "${post.title}":\n${post.body.replace(/<[^>]+>/g, " ").slice(0, 2500)}` }],
    maxTokens: 500,
    workspaceId: workspace.id,
  });
  let items: string[] = [];
  try {
    const m = res.content.match(/\[[\s\S]*\]/);
    items = (m ? (JSON.parse(m[0]) as unknown[]) : []).filter((x): x is string => typeof x === "string").slice(0, 5);
  } catch {
    items = [];
  }
  const placeholder = placeholderProblem(res, "no takeaways were added");
  if (placeholder) backToOptimize(id, placeholder, "err");
  if (!items.length) backToOptimize(id, "The AI's answer had no usable takeaways, so nothing was added — try again.", "err");

  await db.blogPostVersion.create({ data: { postId: post.id, label: "before key takeaways", body: post.body } });
  const block = `<h2>Key takeaways</h2>\n<ul>\n${items.map((i) => `<li>${i}</li>`).join("\n")}\n</ul>\n`;
  // Insert after the first paragraph; fall back to prepending.
  const firstParaEnd = post.body.search(/<\/p>/i);
  const newBody =
    firstParaEnd >= 0
      ? post.body.slice(0, firstParaEnd + 4) + "\n" + block + post.body.slice(firstParaEnd + 4)
      : block + post.body;
  await db.blogPost.update({ where: { id: post.id }, data: { body: newBody } });
  await returnToReviewAfterEdit(workspace.id, post.id, "key takeaways");
  revalidatePath(`/blog/${id}`);
  backToOptimize(id, `Added ${items.length} key takeaways after the first paragraph.`);
}

// ---- Internal links ----------------------------------------------------------

export async function addSitePageAction(formData: FormData) {
  const url = String(formData.get("url") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  if (!/^https?:\/\//.test(url) || !title) return;
  const { workspace } = await requireRole("EDITOR");
  await db.sitePage.upsert({
    where: { workspaceId_url: { workspaceId: workspace.id, url } },
    update: { title, topic: String(formData.get("topic") ?? "").trim() || null },
    create: { workspaceId: workspace.id, url, title, topic: String(formData.get("topic") ?? "").trim() || null },
  });
  revalidatePath("/website");
}

export async function deleteSitePageAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  await db.sitePage.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/website");
}

/** Import this workspace's published posts (with URLs) into the page inventory. */
export async function importPublishedAsPagesAction(): Promise<void> {
  const { workspace } = await requireRole("EDITOR");
  const published = await db.blogPost.findMany({
    where: { workspaceId: workspace.id, status: "published", publishedUrl: { not: null } },
    select: { title: true, publishedUrl: true, focusKeyword: true },
  });
  for (const p of published) {
    await db.sitePage.upsert({
      where: { workspaceId_url: { workspaceId: workspace.id, url: p.publishedUrl! } },
      update: {},
      create: { workspaceId: workspace.id, url: p.publishedUrl!, title: p.title, topic: p.focusKeyword },
    });
  }
  revalidatePath("/website");
}

export async function suggestInternalLinksAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  if (await isGloballyPaused(workspace.id)) backToOptimize(id, PAUSED, "err");
  const [post, pages] = await Promise.all([
    db.blogPost.findFirst({ where: { id, workspaceId: workspace.id } }),
    db.sitePage.findMany({ where: { workspaceId: workspace.id }, take: 50 }),
  ]);
  if (!post?.body) return backToOptimize(id, "This article has no text yet — write or draft it first.", "err");
  if (!pages.length) backToOptimize(id, "No site pages yet — add your site's pages under Website (or import your published articles there), then try again.", "err");

  const res = await llm.complete({
    model: post.model ?? workspace.defaultModel ?? llm.defaultModel,
    system:
      "Suggest internal links. Given an article and a site-page inventory, pick up to 5 pages genuinely relevant to the article. " +
      'Respond ONLY with JSON: [{"url": string, "anchorText": string}] — anchorText must be an EXACT phrase that already appears in the article body (2-6 words).',
    messages: [
      {
        role: "user",
        content: `Article:\n${post.body.replace(/<[^>]+>/g, " ").slice(0, 2500)}\n\nPages:\n${pages.map((p) => `${p.url} — ${p.title}${p.topic ? ` (${p.topic})` : ""}`).join("\n")}`,
      },
    ],
    maxTokens: 600,
    workspaceId: workspace.id,
  });
  let suggestions: Array<{ url?: string; anchorText?: string }> = [];
  try {
    const m = res.content.match(/\[[\s\S]*\]/);
    suggestions = m ? JSON.parse(m[0]) : [];
  } catch {
    suggestions = [];
  }
  const valid = suggestions
    .filter((s) => typeof s.url === "string" && typeof s.anchorText === "string")
    .filter((s) => pages.some((p) => p.url === s.url))
    .slice(0, 5);
  // A placeholder keeps the suggestions already shown rather than wiping them.
  const placeholder = placeholderProblem(res, "no links were suggested");
  if (placeholder) backToOptimize(id, placeholder, "err");
  await db.setting.upsert({
    where: { key: `blog:links:${post.id}` },
    update: { value: JSON.stringify(valid) },
    create: { key: `blog:links:${post.id}`, value: JSON.stringify(valid) },
  });
  revalidatePath(`/blog/${id}`);
  backToOptimize(id, valid.length
    ? `${valid.length} internal link${valid.length === 1 ? "" : "s"} suggested below — Link it adds one.`
    : `None of the ${pages.length} site pages fits a phrase in this article, so there's nothing to link.`);
}

/** Deterministic apply: wrap the first free occurrence of the anchor text. */
export async function applyInternalLinkAction(formData: FormData) {
  const id = String(formData.get("id"));
  const url = String(formData.get("url"));
  const anchor = String(formData.get("anchorText") ?? "").trim();
  const { workspace } = await requireRole("EDITOR");
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post?.body || !anchor || !url) return backToOptimize(id, "That suggestion is incomplete — suggest links again.", "err");
  if (post.body.includes(`href="${url}"`)) backToOptimize(id, "That page is already linked in this article.", "err");

  // Find the anchor outside existing tags/links (simple heuristic: exact text
  // match not preceded by ">" of an <a> tag within 100 chars).
  const idx = post.body.toLowerCase().indexOf(anchor.toLowerCase());
  if (idx < 0) backToOptimize(id, `“${anchor}” isn't in the article any more — suggest links again.`, "err");
  const before = post.body.slice(Math.max(0, idx - 120), idx);
  if (/<a\s[^>]*$/i.test(before)) backToOptimize(id, `“${anchor}” is already inside a link, so it was left alone.`, "err");
  const original = post.body.slice(idx, idx + anchor.length);
  const newBody = post.body.slice(0, idx) + `<a href="${url}">${original}</a>` + post.body.slice(idx + anchor.length);
  await db.blogPost.update({ where: { id: post.id }, data: { body: newBody } });
  await returnToReviewAfterEdit(workspace.id, post.id, "internal link");
  revalidatePath(`/blog/${id}`);
  backToOptimize(id, `Linked “${original}” to ${url}.`);
}

// ---- Entity coverage (Wave C′; LLM-derived, labeled as such) -----------------

export async function entityCoverageAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  if (await isGloballyPaused(workspace.id)) return;
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post?.body) return;

  const res = await llm.complete({
    model: post.model ?? workspace.defaultModel ?? llm.defaultModel,
    system:
      "Analyze topical entity coverage for SEO. List key entities (concepts, tools, standards, named things — not statistics) an authoritative article on this topic should mention. " +
      'Respond ONLY with JSON: {"covered": string[], "missing": string[]} — max 10 each, based on the article text vs the topic.',
    messages: [
      { role: "user", content: `Topic: ${post.focusKeyword ?? post.title}\n\nArticle:\n${post.body.replace(/<[^>]+>/g, " ").slice(0, 3000)}` },
    ],
    maxTokens: 600,
    workspaceId: workspace.id,
  });
  let entities: unknown = null;
  try {
    const m = res.content.match(/\{[\s\S]*\}/);
    entities = m ? JSON.parse(m[0]) : null;
  } catch {
    entities = null;
  }
  if (!entities) return;
  await db.setting.upsert({
    where: { key: `blog:entities:${post.id}` },
    update: { value: JSON.stringify(entities) },
    create: { key: `blog:entities:${post.id}`, value: JSON.stringify(entities) },
  });
  revalidatePath(`/blog/${id}`);
}

// ---- Content gap (search-data-gated) ----------------------------------------

export async function contentGapAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  if (await isGloballyPaused(workspace.id)) return;
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post) return;

  const { provider, real, vendor } = await getSearchProvider(workspace.id);
  if (!real) {
    // Honesty: no real SERP data — say so instead of inventing competitors.
    await db.setting.upsert({
      where: { key: `blog:gaps:${post.id}` },
      update: { value: JSON.stringify({ needsKey: true }) },
      create: { key: `blog:gaps:${post.id}`, value: JSON.stringify({ needsKey: true }) },
    });
    revalidatePath(`/blog/${id}`);
    return;
  }

  const query = post.focusKeyword ?? post.title;
  const results = await provider.search(query, 6);
  const res = await llm.complete({
    model: post.model ?? workspace.defaultModel ?? llm.defaultModel,
    system:
      'Compare an article against search results for its target query. Respond ONLY with JSON: {"missing": [{"subtopic": string, "why": string}]} — up to 6 subtopics competitors cover that the article does not.',
    messages: [
      {
        role: "user",
        content: `Query: ${query}\n\nArticle:\n${(post.body ?? "").replace(/<[^>]+>/g, " ").slice(0, 2500)}\n\nTop results:\n${results.map((r) => `${r.title} — ${r.snippet ?? ""}`).join("\n")}`,
      },
    ],
    maxTokens: 800,
    workspaceId: workspace.id,
  });
  let gaps: unknown = { missing: [] };
  try {
    const m = res.content.match(/\{[\s\S]*\}/);
    gaps = m ? JSON.parse(m[0]) : { missing: [] };
  } catch {
    gaps = { missing: [] };
  }
  await db.setting.upsert({
    where: { key: `blog:gaps:${post.id}` },
    update: { value: JSON.stringify(gaps) },
    create: { key: `blog:gaps:${post.id}`, value: JSON.stringify(gaps) },
  });
  await writeAudit({ workspaceId: workspace.id, action: "blog.content_gap_analyzed", entityType: "blog_post", entityId: post.id, meta: { vendor } });
  revalidatePath(`/blog/${id}`);
}
