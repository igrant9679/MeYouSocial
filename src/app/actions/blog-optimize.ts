"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { llm } from "@/lib/llm";
import { search } from "@/lib/search";
import { isGloballyPaused, writeAudit } from "@/lib/governance";

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

// ---- Featured-snippet blocks -------------------------------------------------

export async function addFaqSectionAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  if (await isGloballyPaused(workspace.id)) return;
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post?.body || post.protectedFromRewrite) return;
  if (/frequently asked/i.test(post.body)) return; // already has one

  const res = await llm.complete({
    model: post.model ?? workspace.defaultModel ?? llm.defaultModel,
    system:
      'Generate a FAQ section for a blog post. Respond ONLY with JSON: [{"q": string, "a": string}] — 3 to 5 pairs. Answers are 2-3 sentences, direct, snippet-friendly, and only claim what the article supports. No invented statistics.',
    messages: [{ role: "user", content: `Article "${post.title}":\n${post.body.replace(/<[^>]+>/g, " ").slice(0, 2500)}` }],
    maxTokens: 900,
  });
  let faq: Array<{ q?: string; a?: string }> = [];
  try {
    const m = res.content.match(/\[[\s\S]*\]/);
    faq = m ? JSON.parse(m[0]) : [];
  } catch {
    faq = [];
  }
  const pairs = faq.filter((f) => typeof f.q === "string" && typeof f.a === "string").slice(0, 5);
  if (!pairs.length) return;

  await db.blogPostVersion.create({ data: { postId: post.id, label: "before FAQ section", body: post.body } });
  const html =
    `\n<h2>Frequently asked questions</h2>\n` +
    pairs.map((f) => `<h3>${f.q}</h3>\n<p>${f.a}</p>`).join("\n");
  await db.blogPost.update({ where: { id: post.id }, data: { body: post.body + html } });
  revalidatePath(`/blog/${id}`);
}

export async function addKeyTakeawaysAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  if (await isGloballyPaused(workspace.id)) return;
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post?.body || post.protectedFromRewrite) return;
  if (/key takeaways/i.test(post.body)) return;

  const res = await llm.complete({
    model: post.model ?? workspace.defaultModel ?? llm.defaultModel,
    system:
      'Generate a key-takeaways list. Respond ONLY with a JSON array of 3-5 short strings (≤120 chars), each a concrete takeaway the article supports. Snippet-friendly, no invented numbers.',
    messages: [{ role: "user", content: `Article "${post.title}":\n${post.body.replace(/<[^>]+>/g, " ").slice(0, 2500)}` }],
    maxTokens: 500,
  });
  let items: string[] = [];
  try {
    const m = res.content.match(/\[[\s\S]*\]/);
    items = (m ? (JSON.parse(m[0]) as unknown[]) : []).filter((x): x is string => typeof x === "string").slice(0, 5);
  } catch {
    items = [];
  }
  if (!items.length) return;

  await db.blogPostVersion.create({ data: { postId: post.id, label: "before key takeaways", body: post.body } });
  const block = `<h2>Key takeaways</h2>\n<ul>\n${items.map((i) => `<li>${i}</li>`).join("\n")}\n</ul>\n`;
  // Insert after the first paragraph; fall back to prepending.
  const firstParaEnd = post.body.search(/<\/p>/i);
  const newBody =
    firstParaEnd >= 0
      ? post.body.slice(0, firstParaEnd + 4) + "\n" + block + post.body.slice(firstParaEnd + 4)
      : block + post.body;
  await db.blogPost.update({ where: { id: post.id }, data: { body: newBody } });
  revalidatePath(`/blog/${id}`);
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
  revalidatePath("/blog/settings");
}

export async function deleteSitePageAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  await db.sitePage.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/blog/settings");
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
  revalidatePath("/blog/settings");
}

export async function suggestInternalLinksAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  if (await isGloballyPaused(workspace.id)) return;
  const [post, pages] = await Promise.all([
    db.blogPost.findFirst({ where: { id, workspaceId: workspace.id } }),
    db.sitePage.findMany({ where: { workspaceId: workspace.id }, take: 50 }),
  ]);
  if (!post?.body || !pages.length) return;

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
  await db.setting.upsert({
    where: { key: `blog:links:${post.id}` },
    update: { value: JSON.stringify(valid) },
    create: { key: `blog:links:${post.id}`, value: JSON.stringify(valid) },
  });
  revalidatePath(`/blog/${id}`);
}

/** Deterministic apply: wrap the first free occurrence of the anchor text. */
export async function applyInternalLinkAction(formData: FormData) {
  const id = String(formData.get("id"));
  const url = String(formData.get("url"));
  const anchor = String(formData.get("anchorText") ?? "").trim();
  const { workspace } = await requireRole("EDITOR");
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post?.body || !anchor || !url) return;
  if (post.body.includes(`href="${url}"`)) return; // already linked

  // Find the anchor outside existing tags/links (simple heuristic: exact text
  // match not preceded by ">" of an <a> tag within 100 chars).
  const idx = post.body.toLowerCase().indexOf(anchor.toLowerCase());
  if (idx < 0) return;
  const before = post.body.slice(Math.max(0, idx - 120), idx);
  if (/<a\s[^>]*$/i.test(before)) return; // inside a link — skip
  const original = post.body.slice(idx, idx + anchor.length);
  const newBody = post.body.slice(0, idx) + `<a href="${url}">${original}</a>` + post.body.slice(idx + anchor.length);
  await db.blogPost.update({ where: { id: post.id }, data: { body: newBody } });
  revalidatePath(`/blog/${id}`);
}

// ---- Content gap (search-data-gated) ----------------------------------------

export async function contentGapAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  if (await isGloballyPaused(workspace.id)) return;
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post) return;

  if (env.USE_MOCK_SEARCH) {
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
  const results = await search.search(query, 6);
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
  await writeAudit({ workspaceId: workspace.id, action: "blog.content_gap_analyzed", entityType: "blog_post", entityId: post.id });
  revalidatePath(`/blog/${id}`);
}
