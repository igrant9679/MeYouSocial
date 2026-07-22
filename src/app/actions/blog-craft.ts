"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { llm } from "@/lib/llm";
import { isGloballyPaused, writeAudit } from "@/lib/governance";
import { generateOutlineCore } from "@/lib/blog-autopilot";

/**
 * Craft actions (Wave A′): outline, per-section regenerate, A/B titles,
 * AI meta tags, image alt text. Title variants are transient — stored in the
 * generic Setting KV under blog:titles:<postId> (postId is globally unique).
 */

export async function generateOutlineAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  await generateOutlineCore(workspace.id, id);
  revalidatePath(`/blog/${id}`);
}

export async function saveOutlineAction(formData: FormData) {
  const id = String(formData.get("id"));
  const raw = String(formData.get("outline") ?? "").trim();
  const { workspace } = await requireRole("EDITOR");
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post) return;
  let clean: string | null = null;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Array<{ heading?: string; points?: string[] }>;
      clean = JSON.stringify(
        parsed
          .filter((s) => typeof s.heading === "string" && s.heading.trim())
          .slice(0, 8)
          .map((s) => ({ heading: s.heading!.trim().slice(0, 150), points: (s.points ?? []).filter((p) => typeof p === "string").slice(0, 5) })),
      );
    } catch {
      return; // invalid JSON — keep the old outline rather than destroy it
    }
  }
  await db.blogPost.update({ where: { id: post.id }, data: { outline: clean } });
  revalidatePath(`/blog/${id}`);
}

/** Rewrite one h2 section in place, keeping the rest of the body untouched. */
export async function regenerateSectionAction(formData: FormData) {
  const id = String(formData.get("id"));
  const heading = String(formData.get("heading") ?? "").trim();
  const { workspace } = await requireRole("EDITOR");
  if (await isGloballyPaused(workspace.id)) return;
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post?.body || !heading || post.protectedFromRewrite) return;

  // Split body into h2 sections; find the target by heading text.
  const parts = post.body.split(/(?=<h2[^>]*>)/i);
  const idx = parts.findIndex((p) => {
    const m = p.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    return m && m[1].replace(/<[^>]+>/g, "").trim().toLowerCase() === heading.toLowerCase();
  });
  if (idx < 0) return;

  const res = await llm.complete({
    model: post.model ?? workspace.defaultModel ?? llm.defaultModel,
    system:
      "Rewrite one section of a blog post. Respond ONLY with the replacement HTML for that section, starting with the same <h2> heading. " +
      "Never invent statistics or quotes; flag unverifiable claims with [NEEDS SOURCE].",
    messages: [
      {
        role: "user",
        content: `Post title: "${post.title}"${post.focusKeyword ? ` (focus keyword: ${post.focusKeyword})` : ""}\n\nRewrite this section, improving clarity and depth:\n\n${parts[idx]}`,
      },
    ],
    maxTokens: 1500,
  });
  const replacement = res.content.trim();
  if (!/^<h2/i.test(replacement)) return; // model went off-format — do nothing

  await db.blogPostVersion.create({ data: { postId: post.id, label: `before section rewrite: ${heading.slice(0, 40)}`, body: post.body } });
  parts[idx] = replacement + "\n";
  await db.blogPost.update({ where: { id: post.id }, data: { body: parts.join("") } });
  await writeAudit({ workspaceId: workspace.id, action: "blog.section_regenerated", entityType: "blog_post", entityId: post.id, meta: { heading } });
  revalidatePath(`/blog/${id}`);
}

export async function generateTitlesAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  if (await isGloballyPaused(workspace.id)) return;
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post) return;
  const res = await llm.complete({
    model: post.model ?? workspace.defaultModel ?? llm.defaultModel,
    system:
      'Generate 5 SEO title variants optimized for click-through. Respond ONLY with a JSON array of strings, each ≤60 characters. No clickbait lies — titles must match the content.',
    messages: [
      {
        role: "user",
        content: `Current title: "${post.title}"${post.focusKeyword ? `\nFocus keyword (include naturally): ${post.focusKeyword}` : ""}${post.body ? `\nContent summary: ${post.body.replace(/<[^>]+>/g, " ").slice(0, 600)}` : ""}`,
      },
    ],
    maxTokens: 500,
  });
  let titles: string[] = [];
  try {
    const m = res.content.match(/\[[\s\S]*\]/);
    titles = (m ? (JSON.parse(m[0]) as unknown[]) : []).filter((t): t is string => typeof t === "string").slice(0, 5);
  } catch {
    titles = [];
  }
  if (titles.length) {
    await db.setting.upsert({
      where: { key: `blog:titles:${post.id}` },
      update: { value: JSON.stringify(titles) },
      create: { key: `blog:titles:${post.id}`, value: JSON.stringify(titles) },
    });
  }
  revalidatePath(`/blog/${id}`);
}

export async function applyTitleAction(formData: FormData) {
  const id = String(formData.get("id"));
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  const { workspace } = await requireRole("EDITOR");
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post || !title) return;
  await db.blogPost.update({
    where: { id: post.id },
    data: { title, metaTitle: post.metaTitle ?? title.slice(0, 60) },
  });
  revalidatePath(`/blog/${id}`);
}

/** AI meta title / description / slug from the content. */
export async function generateMetaAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  if (await isGloballyPaused(workspace.id)) return;
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post) return;
  const res = await llm.complete({
    model: post.model ?? workspace.defaultModel ?? llm.defaultModel,
    system:
      'Generate SEO metadata. Respond ONLY with JSON: {"metaTitle": string (≤60 chars), "metaDescription": string (≤155 chars, compelling, ends with a benefit), "slug": string (lowercase-hyphenated, ≤6 words)}.',
    messages: [
      {
        role: "user",
        content: `Title: "${post.title}"${post.focusKeyword ? `\nFocus keyword (must appear in metaTitle and slug): ${post.focusKeyword}` : ""}${post.body ? `\nContent: ${post.body.replace(/<[^>]+>/g, " ").slice(0, 800)}` : ""}`,
      },
    ],
    maxTokens: 300,
  });
  let meta: { metaTitle?: string; metaDescription?: string; slug?: string } = {};
  try {
    const m = res.content.match(/\{[\s\S]*\}/);
    meta = m ? JSON.parse(m[0]) : {};
  } catch {
    meta = {};
  }
  const slug = typeof meta.slug === "string" ? meta.slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) : null;
  await db.blogPost.update({
    where: { id: post.id },
    data: {
      metaTitle: typeof meta.metaTitle === "string" ? meta.metaTitle.slice(0, 60) : post.metaTitle,
      metaDescription: typeof meta.metaDescription === "string" ? meta.metaDescription.slice(0, 155) : post.metaDescription,
      slug: slug || post.slug,
    },
  });
  await writeAudit({ workspaceId: workspace.id, action: "blog.meta_generated", entityType: "blog_post", entityId: post.id });
  revalidatePath(`/blog/${id}`);
}

/** Generate alt text for every <img> in the body that lacks it. */
export async function generateAltTextAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  if (await isGloballyPaused(workspace.id)) return;
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post?.body) return;
  const imgs = [...post.body.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]).filter((t) => !/\balt\s*=\s*"[^"]+"/i.test(t));
  if (!imgs.length) return;
  const srcs = imgs.map((t) => t.match(/src\s*=\s*"([^"]*)"/i)?.[1] ?? "").slice(0, 10);
  const res = await llm.complete({
    model: post.model ?? workspace.defaultModel ?? llm.defaultModel,
    system:
      'Write descriptive image alt text (≤120 chars each) inferred from the article context and the image filename/URL. Respond ONLY with a JSON array of strings, one per image, same order.',
    messages: [
      { role: "user", content: `Article: "${post.title}"\nSummary: ${post.body.replace(/<[^>]+>/g, " ").slice(0, 500)}\nImages:\n${srcs.join("\n")}` },
    ],
    maxTokens: 500,
  });
  let alts: string[] = [];
  try {
    const m = res.content.match(/\[[\s\S]*\]/);
    alts = (m ? (JSON.parse(m[0]) as unknown[]) : []).filter((a): a is string => typeof a === "string");
  } catch {
    alts = [];
  }
  if (!alts.length) return;
  let i = 0;
  const newBody = post.body.replace(/<img\b[^>]*>/gi, (tag) => {
    if (/\balt\s*=\s*"[^"]+"/i.test(tag)) return tag;
    const alt = alts[i++];
    if (!alt) return tag;
    return tag.replace(/\/?>$/, ` alt="${alt.replace(/"/g, "'").slice(0, 120)}">`);
  });
  await db.blogPost.update({ where: { id: post.id }, data: { body: newBody } });
  revalidatePath(`/blog/${id}`);
}
