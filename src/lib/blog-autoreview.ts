import { db } from "@/lib/db";
import { llm, resolveUsableModel } from "@/lib/llm";
import { writeAudit, isGloballyPaused } from "@/lib/governance";
import { notify } from "@/lib/notify";
import { getSearchProvider } from "@/lib/search";
import { claimsFromMarkers } from "@/lib/citations-extract";
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

export type AutoReviewResult = { imagesApproved: number; citationsVerified: number; seoFilled: boolean; findingsApplied: number };

export async function autoReviewCore(workspaceId: string, postId: string): Promise<AutoReviewResult> {
  const result: AutoReviewResult = { imagesApproved: 0, citationsVerified: 0, seoFilled: false, findingsApplied: 0 };
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

  // 4. Findings (Optimize → "Address these"): generated once per article,
  //    and only the MECHANICAL cards are applied unattended — a knowledge card
  //    is the author's to answer, a strategic one is a decision.
  const { autoFindingsCore } = await import("@/lib/blog-findings");
  result.findingsApplied = (await autoFindingsCore(workspaceId, post.id)).applied;

  return result;
}

// ── Images ───────────────────────────────────────────────────────────────────

// Brand-aware on purpose: a render for CommunityForce came back branded
// "GRYPHON & BISHOP EST. 1876" — an invented company — and a reviewer that
// doesn't know whose image it is cannot call that a defect. Since 2026-09-16
// the lockup is composited by us (lib/images/lockup) in the bottom-left
// corner, so the reviewer is told exactly what to expect there and that
// anything else legible is the model's — and a defect.
const reviewPrompt = (brandName: string) =>
  "You are reviewing an AI-generated marketing image before publication. Look for concrete defects only: " +
  "text or a logo that is CUT OFF by the frame edge or partially hidden; garbled, misspelled or nonsense lettering; " +
  "watermark or artifact patterns; or heavy visual glitches. " +
  `The image belongs to the brand "${brandName}". Its lockup — a small dark rounded pill in the BOTTOM-LEFT corner holding the brand's mark and the name "${brandName}" in clean white type — is added by the publisher and is correct; do not report it. ` +
  "ANY other readable text, logo, badge, sign, or company name anywhere else in the image was painted by the model and is a defect, whatever it says. Imagery with no text outside that pill is fine. " +
  'Reply ONLY with JSON: {"ok": boolean, "problems": [string]} — ok=false whenever any defect above is visible.';

async function autoReviewImages(workspaceId: string, postId: string, postTitle: string): Promise<number> {
  const brandName = (await db.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }))?.name ?? "the workspace";
  // Missing roles first — the existing unattended core renders briefs +
  // featured + OG and never overwrites a human's choice or an approval.
  const have = await db.blogImage.findMany({ where: { postId } });
  if (!have.some((i) => i.role === "featured") || !have.some((i) => i.role === "og")) {
    await generateBlogImagesCore(workspaceId, postId).catch(() => 0);
  }

  const rows = await db.blogImage.findMany({ where: { postId, status: "pending", source: "ai" } });
  let approved = 0;
  for (const img of rows) {
    // ⚠ The strike count gates the SPEND (below), never the LOOK. The first
    // cut checked it up here and skipped review entirely once two old renders
    // had been rejected — which silently blocked the fresh, clean render that
    // followed a brief fix from ever being seen (CF, 2026-08-25: v3 sat
    // pending forever while the brake counted v1/v2's rejections against it).
    // A pending render is always reviewed; only regeneration is rationed.
    //
    // …but the SAME render is judged once. Once the brake has tripped, the
    // rejected image sits pending and unchanged until a person acts, and this
    // loop was re-inspecting it every half-hour sweep: 72 vision calls per
    // tenant in two days (LSI + CF, 2026-09-05→06) for a verdict that could
    // not change. A rejection audit newer than the image's own updatedAt
    // means this exact render already failed — skip the look. A regeneration
    // writes a new URL into the row, which advances updatedAt past the last
    // rejection, so a fresh render is still always seen.
    const judged = await db.auditLog.findFirst({
      where: { workspaceId, action: "blog.image_auto_rejected", entityId: img.id, createdAt: { gte: img.updatedAt } },
      select: { id: true },
    });
    if (judged) continue;

    const key = img.url.match(/\/(?:uploads|api\/files)\/([^"'\s)]+)/)?.[1];
    const bytes = key ? await storage.get(decodeURIComponent(key)).catch(() => null) : null;
    if (!bytes) {
      console.warn(`[auto-review] no bytes for ${img.role} image ${img.id} (key=${key ?? "none"}) — skipping`);
      continue;
    }

    let verdict: { ok?: boolean; problems?: string[] } = {};
    try {
      const raw = await askAboutImage({ bytes, mimeType: "image/png", source: img.url }, reviewPrompt(brandName), workspaceId);
      const m = raw.match(/\{[\s\S]*\}/);
      verdict = m ? (JSON.parse(m[0]) as typeof verdict) : {};
      if (verdict.ok === undefined) console.warn(`[auto-review] vision reply for ${img.id} had no verdict: ${raw.slice(0, 120)}`);
    } catch (e) {
      // No vision key, a provider error, or an unparseable reply: nothing is
      // approved unseen — but say so, or a skipped review looks like a cycle
      // that never ran (that ambiguity cost a diagnosis on 08-25).
      console.warn(`[auto-review] vision look failed for ${img.role} image ${img.id}:`, e instanceof Error ? e.message : e);
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
      // Prior strikes BEFORE recording this one: 0 or 1 → regenerate (at most
      // three auto renders a week per role); 2+ → stop spending and tell a
      // human, but keep reviewing whatever lands here next.
      const priorRejections = await db.auditLog.count({
        where: { workspaceId, action: "blog.image_auto_rejected", entityId: img.id, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      });
      await writeAudit({
        workspaceId, action: "blog.image_auto_rejected", entityType: "blog_image", entityId: img.id,
        meta: { role: img.role, problems: (verdict.problems ?? []).slice(0, 5) },
      });
      if (priorRejections >= 2) {
        await notifyOnce(workspaceId, img.id, `An image for "${postTitle.slice(0, 60)}" keeps failing review`,
          "Several AI renders in a row had visible defects. It stays pending — pick or approve one on the article page.", `/blog/${postId}`);
      } else {
        // One fresh render; it lands pending and is reviewed next cycle.
        await generateImageCore(workspaceId, postId, img.role as "featured" | "og").catch(() => false);
      }
    }
    // verdict.ok undefined → treated as "didn't get a real look"; skip.
  }
  return approved;
}

// ── Citations ────────────────────────────────────────────────────────────────

type PostRow = { id: string; body: string | null; title: string; model: string | null };

const normText = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
const normTail = (s: string) => normText(s).slice(-60);

async function autoSourceCitations(workspaceId: string, post: PostRow): Promise<number> {
  // ⚠ Markers without citation rows first. A [NEEDS SOURCE] in the body whose
  // row was deleted (or that predates the row sync) would otherwise hold the
  // post FOREVER with nothing for auto-review to work on — LSI's "SEO in NGO"
  // draft sat exactly like that. Recreate rows from the marker sentences (the
  // same extraction the drafting core uses) so every marker is workable.
  if (post.body) {
    const existing = await db.blogCitation.findMany({ where: { postId: post.id }, select: { claim: true } });
    const known = new Set(existing.map((c) => normTail(c.claim)));
    // ⚠ claimsFromMarkers, not a local regex: the old one dropped a marker
    // whose sentence ended in a closing quote (see lib/citations-extract.ts).
    const claims = claimsFromMarkers(post.body.replace(/<[^>]+>/g, " "), 6);
    const missing = claims.filter((c) => !known.has(normTail(c))).slice(0, 3);
    if (missing.length) {
      await db.blogCitation.createMany({ data: missing.map((claim) => ({ postId: post.id, claim })) });
    }
  }

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
    // A claim already held as unsourceable is searched again at most once a
    // day. Without this it was searched (and judged) on every half-hour
    // sweep, forever — the citation twin of the image re-inspection loop
    // (LSI, 2026-09-06: held 23:47, searched again 00:04). A person who
    // verifies or drops the claim removes the row, so the day's wait only
    // ever applies to a claim nobody has touched.
    const heldRecently = await db.auditLog.findFirst({
      where: { workspaceId, action: "blog.citation_unsourceable", meta: { contains: cit.id }, createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) } },
      select: { id: true },
    });
    if (heldRecently) continue;

    const results = await provider.search(cit.claim.slice(0, 300), 5).catch(() => []);
    const usable = results.filter((r) => /^https?:\/\//i.test(r.url) && !/["<>]/.test(r.url));
    if (usable.length === 0) {
      await holdUnsourceable(workspaceId, post, cit.id, cit.claim);
      continue;
    }

    const res = await llm.complete({
      model: await resolveUsableModel(post.model ?? workspace?.defaultModel ?? llm.defaultModel, workspaceId),
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
      // Reasoning models spend the budget thinking before emitting — the
      // default 45s wrap is exactly what turned CF's drafts into mock (see
      // LLMRequest.timeoutMs). The judge gets the same headroom.
      timeoutMs: 120_000,
      workspaceId,
    });
    // Never verify a citation on a stand-in's word. Loudly, though — a silent
    // skip here made the first live cycle look like auto-review hadn't run.
    if (res.provider === "mock") {
      console.warn(`[auto-review] citation judge fell back to mock for ${post.id} — skipping this cycle`);
      continue;
    }

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
 * link — or, with `url` null, remove it. Markers and citation rows were
 * minted from the same sentences, so the marker whose preceding text ends
 * with the claim is the right one; if the body has been edited since, the
 * first remaining marker is the best match.
 */
async function resolveMarker(post: { id: string }, claim: string, url: string | null): Promise<boolean> {
  const body = (await db.blogPost.findUnique({ where: { id: post.id }, select: { body: true } }))?.body;
  if (!body) return false;
  const tail = normTail(claim);

  let firstIdx = -1;
  let matchIdx = -1;
  for (let i = body.indexOf(MARKER); i !== -1; i = body.indexOf(MARKER, i + 1)) {
    if (firstIdx === -1) firstIdx = i;
    if (tail && normText(body.slice(Math.max(0, i - 400), i)).endsWith(tail)) { matchIdx = i; break; }
  }
  const idx = matchIdx !== -1 ? matchIdx : firstIdx;
  if (idx === -1) return false;

  const replacement = url ? `<a href="${url}">(source)</a>` : "";
  // Removing: take the space before the marker with it, so "fund." [NEEDS SOURCE]" reads "fund."".
  const start = !url && body[idx - 1] === " " ? idx - 1 : idx;
  const next = body.slice(0, start) + replacement + body.slice(idx + MARKER.length);
  await db.blogPost.update({ where: { id: post.id }, data: { body: next } });
  return true;
}

/**
 * Drop a claim's marker from the body. Used when a person drops the claim's
 * citation record: the marker is what the required check counts, and the
 * orphan-marker reconciliation would otherwise mint a fresh row for it on the
 * next sweep — a loop with a person inside it.
 */
export async function removeMarkerForClaim(postId: string, claim: string): Promise<boolean> {
  return resolveMarker({ id: postId }, claim, null);
}

/** One notification per entity per 24h — held items re-check every cycle. */
async function notifyOnce(workspaceId: string, entityId: string, title: string, body: string, path: string): Promise<void> {
  const already = await db.notification.count({
    where: { workspaceId, kind: "generation_failed", entityId, createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) } },
  });
  if (already > 0) return;
  await notify({ workspaceId, kind: "generation_failed", title, body, path, entityType: "blog_post", entityId });
}
