import { db } from "@/lib/db";
import { llm } from "@/lib/llm";
import { writeAudit, isGloballyPaused } from "@/lib/governance";
import { notify } from "@/lib/notify";
import { getSearchProvider } from "@/lib/search";
import { askAboutImage } from "@/lib/vision";
import { storage } from "@/lib/storage";
import { generateImageCore, generateBlogImagesCore } from "@/lib/blog-images";
import { generateSeoMetaCore } from "@/lib/blog-seo";

/**
 * Auto-review: under full autonomy, the app presses the REVIEW buttons a human
 * would — it does not lower what they check (the owner's ask, 2026-08-25:
 * "make these settings automatic").
 *
 * What that means concretely, per gate:
 *   · absent SEO metadata   → fill-only generation (existing core, mock-guarded)
 *   · missing image         → render it (existing core; skips human/approved roles)
 *   · image pending review  → a vision model actually LOOKS at the render and
 *                             approves only what passes; a failed render is
 *                             regenerated, and after two failures it stops and
 *                             tells a human (endless paid regens are not review)
 *   · unverified citation   → live web search for the claim, then an LLM
 *                             judgment that a candidate genuinely SUPPORTS it —
 *                             topical overlap is not support (the first manual
 *                             verification refused Ahrefs' own zero-volume post
 *                             because it CONTRADICTED the claim; the automated
 *                             path holds the same bar). Only then is the
 *                             citation verified and the [NEEDS SOURCE] marker
 *                             replaced with a real link.
 *
 * ⚠ WHAT STILL STOPS A POST, deliberately: a claim no source backs (that is
 * the gate working), an image that keeps failing inspection, mock search or a
 * mock LLM (nothing is ever verified on a stand-in's word), and a missing
 * vision key (nothing is approved unseen). Every hold notifies, so "held" is
 * never "lost".
 */

const MARKER = "[NEEDS SOURCE]";

export type AutoReviewResult = { imagesApproved: number; citationsVerified: number; seoFilled: boolean };

export async function autoReviewCore(workspaceId: string, postId: string): Promise<AutoReviewResult> {
  const result: AutoReviewResult = { imagesApproved: 0, citationsVerified: 0, seoFilled: false };
  if (await isGloballyPaused(workspaceId)) return result;
  const post = await db.blogPost.findFirst({ where: { id: postId, workspaceId } });
  if (!post) return result;

  // 1. SEO — only when a required field is actually empty.
  if (!post.metaTitle || !post.metaDescription || !post.slug) {
    const seo = await generateSeoMetaCore(workspaceId, postId, { onlyFillEmpty: true }).catch(() => null);
    if (seo?.ok) result.seoFilled = true;
  }

  // 2. Images.
  result.imagesApproved = await autoReviewImages(workspaceId, post.id, post.title);

  // 3. Citations.
  result.citationsVerified = await autoSourceCitations(workspaceId, post);

  return result;
}

// ── Images ───────────────────────────────────────────────────────────────────

const REVIEW_PROMPT =
  "You are reviewing an AI-generated marketing image before publication. Look for concrete defects only: " +
  "text or a logo that is CUT OFF by the frame edge or partially hidden; garbled, misspelled or nonsense lettering; " +
  "watermark or artifact patterns; or heavy visual glitches. Tasteful abstract imagery with no text is fine. " +
  'Reply ONLY with JSON: {"ok": boolean, "problems": [string]} — ok=false whenever any defect above is visible.';

async function autoReviewImages(workspaceId: string, postId: string, postTitle: string): Promise<number> {
  // Missing roles first — the existing unattended core renders briefs +
  // featured + OG and never overwrites a human's choice or an approval.
  const have = await db.blogImage.findMany({ where: { postId } });
  if (!have.some((i) => i.role === "featured") || !have.some((i) => i.role === "og")) {
    await generateBlogImagesCore(workspaceId, postId).catch(() => 0);
  }

  const rows = await db.blogImage.findMany({ where: { postId, status: "pending", source: "ai" } });
  let approved = 0;
  for (const img of rows) {
    // Two auto-rejections in a week = stop spending and hand it to a human.
    const rejections = await db.auditLog.count({
      where: { workspaceId, action: "blog.image_auto_rejected", entityId: img.id, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
    });
    if (rejections >= 2) {
      await notifyOnce(workspaceId, img.id, `An image for "${postTitle.slice(0, 60)}" keeps failing review`,
        "Two AI renders in a row had visible defects. It stays pending — pick or approve one on the article page.", `/blog/${postId}`);
      continue;
    }

    const key = img.url.match(/\/(?:uploads|api\/files)\/([^"'\s)]+)/)?.[1];
    const bytes = key ? await storage.get(decodeURIComponent(key)).catch(() => null) : null;
    if (!bytes) continue;

    let verdict: { ok?: boolean; problems?: string[] } = {};
    try {
      const raw = await askAboutImage({ bytes, mimeType: "image/png", source: img.url }, REVIEW_PROMPT, workspaceId);
      const m = raw.match(/\{[\s\S]*\}/);
      verdict = m ? (JSON.parse(m[0]) as typeof verdict) : {};
    } catch {
      // No vision key or an unparseable reply: nothing is approved unseen.
      continue;
    }

    if (verdict.ok === true) {
      await db.blogImage.update({ where: { id: img.id }, data: { status: "approved" } });
      await writeAudit({
        workspaceId, action: "blog.image_approved", entityType: "blog_image", entityId: img.id,
        meta: { role: img.role, source: img.source, via: "auto-review", model: "vision" },
      });
      approved++;
    } else if (verdict.ok === false) {
      await writeAudit({
        workspaceId, action: "blog.image_auto_rejected", entityType: "blog_image", entityId: img.id,
        meta: { role: img.role, problems: (verdict.problems ?? []).slice(0, 5) },
      });
      // One fresh render; it lands pending and is reviewed next cycle.
      await generateImageCore(workspaceId, postId, img.role as "featured" | "og").catch(() => false);
    }
    // verdict.ok undefined → treated as "didn't get a real look"; skip.
  }
  return approved;
}

// ── Citations ────────────────────────────────────────────────────────────────

type PostRow = { id: string; body: string | null; title: string; model: string | null };

async function autoSourceCitations(workspaceId: string, post: PostRow): Promise<number> {
  const open = await db.blogCitation.findMany({
    where: { postId: post.id, verified: false },
    orderBy: { createdAt: "asc" },
    take: 3,
  });
  if (open.length === 0) return 0;

  // ⚠ Mock search results carry example.com URLs — verifying against them
  // would be the codebase's oldest bug wearing a new hat. Real vendor or nothing.
  const { provider, real } = await getSearchProvider(workspaceId);
  if (!real) return 0;

  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  let verified = 0;

  for (const cit of open) {
    const results = await provider.search(cit.claim.slice(0, 300), 5).catch(() => []);
    const usable = results.filter((r) => /^https?:\/\//i.test(r.url) && !/["<>]/.test(r.url));
    if (usable.length === 0) {
      await holdUnsourceable(workspaceId, post, cit.id, cit.claim);
      continue;
    }

    const res = await llm.complete({
      model: post.model ?? workspace?.defaultModel ?? llm.defaultModel,
      system:
        "You judge whether a source SUPPORTS a factual claim. Support means the source's content states or evidences " +
        "the claim — topical overlap, or a source that merely discusses the subject, is NOT support; a source that " +
        "contradicts the claim is the opposite of support. " +
        'Reply ONLY with JSON: {"url": string | null, "reason": string} — the single result that supports the claim, or null if none does.',
      messages: [{
        role: "user",
        content: [
          `Claim: "${cit.claim}"`,
          "Candidate sources:",
          ...usable.map((r, i) => `${i + 1}. ${r.url}\n   ${r.title}\n   ${r.snippet}`),
        ].join("\n\n"),
      }],
      maxTokens: 4000,
      workspaceId,
    });
    // Never verify a citation on a stand-in's word.
    if (res.provider === "mock") continue;

    let judged: { url?: string | null; reason?: string } = {};
    try {
      const m = res.content.match(/\{[\s\S]*\}/);
      judged = m ? (JSON.parse(m[0]) as typeof judged) : {};
    } catch { judged = {}; }

    // The URL must be one we actually showed the judge — no invented links.
    const chosen = typeof judged.url === "string" ? usable.find((r) => r.url === judged.url) : undefined;
    if (!chosen) {
      await holdUnsourceable(workspaceId, post, cit.id, cit.claim);
      continue;
    }

    await db.blogCitation.update({ where: { id: cit.id }, data: { verified: true, sourceUrl: chosen.url } });
    await writeAudit({
      workspaceId, action: "blog.citation_autoverified", entityType: "blog_post", entityId: post.id,
      meta: { citationId: cit.id, sourceUrl: chosen.url, reason: (judged.reason ?? "").slice(0, 200), searchVendor: "real" },
    });
    await resolveMarker(post, cit.claim, chosen.url);
    verified++;
  }
  return verified;
}

/** Unsourceable is the gate WORKING — hold, and make sure a human hears once. */
async function holdUnsourceable(workspaceId: string, post: PostRow, citationId: string, claim: string): Promise<void> {
  await writeAudit({
    workspaceId, action: "blog.citation_unsourceable", entityType: "blog_post", entityId: post.id,
    meta: { citationId, claim: claim.slice(0, 200) },
  });
  await notifyOnce(workspaceId, citationId, `No source found for a claim in "${post.title.slice(0, 60)}"`,
    `The claim "${claim.slice(0, 140)}" found no supporting source in live search. The article holds at review — verify it with your own source, or edit the claim out.`,
    `/blog/${post.id}`);
}

/**
 * Replace the [NEEDS SOURCE] marker belonging to this claim with a source
 * link. Markers and citation rows were minted from the same sentences, so the
 * marker whose preceding text ends with the claim is the right one; if the
 * body has been edited since, the first remaining marker is the best match.
 */
async function resolveMarker(post: PostRow, claim: string, url: string): Promise<void> {
  const body = (await db.blogPost.findUnique({ where: { id: post.id }, select: { body: true } }))?.body;
  if (!body) return;
  const norm = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const tail = norm(claim).slice(-60);

  let firstIdx = -1;
  let matchIdx = -1;
  for (let i = body.indexOf(MARKER); i !== -1; i = body.indexOf(MARKER, i + 1)) {
    if (firstIdx === -1) firstIdx = i;
    if (tail && norm(body.slice(Math.max(0, i - 400), i)).endsWith(tail)) { matchIdx = i; break; }
  }
  const idx = matchIdx !== -1 ? matchIdx : firstIdx;
  if (idx === -1) return;

  const link = `<a href="${url}">(source)</a>`;
  const next = body.slice(0, idx) + link + body.slice(idx + MARKER.length);
  await db.blogPost.update({ where: { id: post.id }, data: { body: next } });
}

/** One notification per entity per 24h — held items re-check every cycle. */
async function notifyOnce(workspaceId: string, entityId: string, title: string, body: string, path: string): Promise<void> {
  const already = await db.notification.count({
    where: { workspaceId, kind: "generation_failed", entityId, createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) } },
  });
  if (already > 0) return;
  await notify({ workspaceId, kind: "generation_failed", title, body, path, entityType: "blog_post", entityId });
}
