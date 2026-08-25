import { db } from "@/lib/db";
import { llm } from "@/lib/llm";
import { images as imageProvider } from "@/lib/images";
import { isGloballyPaused, writeAudit } from "@/lib/governance";
import { getBrandKit, motifPromptFor } from "@/lib/motifs";
import type { AssetGate } from "@/lib/blog-checks";

/**
 * FR-8 — asset pipeline: every article needs a featured image and a branded
 * Open Graph image, both at the workspace's pixel dimensions, both with alt
 * text. This module owns the briefs, the dimension probe, and the AI seam.
 *
 * Two rules that shape the design:
 *   - Dimensions are *measured*, never typed. A pasted URL is fetched and its
 *     header parsed, so "1920×1080" in the UI is a fact, not a claim.
 *   - AI-generated images land as `pending`. They cannot satisfy the publish
 *     gate until a human approves them (the quality concern is documented in
 *     the spec, and the same human-gate rule governs every other AI output).
 */

export const IMAGE_ROLES = ["featured", "og"] as const;
export type ImageRole = (typeof IMAGE_ROLES)[number];

export function isImageRole(r: string): r is ImageRole {
  return (IMAGE_ROLES as readonly string[]).includes(r);
}

export const ROLE_LABELS: Record<ImageRole, string> = {
  featured: "Featured image",
  og: "Open Graph image",
};

// ---- Dimension probe -----------------------------------------------------------

/** Read at most `limit` bytes of a response body. */
async function readHead(res: Response, limit = 65536): Promise<Uint8Array | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (!total) return null;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

const be16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const be32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const le16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);

/** Parse width/height from the file header. PNG, GIF, JPEG and WebP. */
export function parseImageDimensions(b: Uint8Array): { width: number; height: number } | null {
  // PNG: 8-byte signature, then IHDR (length + type + w + h)
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { width: be32(b, 16), height: be32(b, 20) };
  }
  // GIF87a / GIF89a: little-endian logical screen size
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { width: le16(b, 6), height: le16(b, 8) };
  }
  // WebP: RIFF....WEBP
  if (b.length > 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) {
    const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (fourcc === "VP8X") {
      const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
      const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
      return { width: w, height: h };
    }
    if (fourcc === "VP8 " && b.length > 30) {
      return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
    }
    return null; // VP8L (lossless) — not worth a bit-reader here
  }
  // JPEG: walk the segment chain to the start-of-frame marker
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = be16(b, i + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { height: be16(b, i + 5), width: be16(b, i + 7) };
      if (len < 2) return null;
      i += 2 + len;
    }
  }
  return null;
}

/** Fetch just enough of a remote image to measure it. Never throws. */
export async function probeImageDimensions(url: string): Promise<{ width: number; height: number } | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, {
      headers: { Range: "bytes=0-65535" },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (!res.ok && res.status !== 206) return null;
    const head = await readHead(res);
    return head ? parseImageDimensions(head) : null;
  } catch {
    return null;
  }
}

// ---- Spec comparison -------------------------------------------------------------

export type DimensionVerdict = {
  state: "ok" | "mismatch" | "unknown";
  detail: string;
};

/**
 * Compare a measured size against the workspace spec. A mismatch is a warning
 * with the exact numbers and the aspect-ratio verdict, so the fix (crop vs
 * re-export) is obvious — this app has no server-side image processing, so it
 * cannot resize for you.
 */
export function dimensionVerdict(
  measured: { width: number | null; height: number | null },
  spec: { width: number; height: number },
): DimensionVerdict {
  if (!measured.width || !measured.height) {
    return { state: "unknown", detail: `could not measure — required ${spec.width}×${spec.height}` };
  }
  if (measured.width === spec.width && measured.height === spec.height) {
    return { state: "ok", detail: `${measured.width}×${measured.height}` };
  }
  const ratio = measured.width / measured.height;
  const target = spec.width / spec.height;
  const sameRatio = Math.abs(ratio - target) < 0.02;
  return {
    state: "mismatch",
    detail: sameRatio
      ? `${measured.width}×${measured.height} — right aspect ratio, wrong size; re-export at ${spec.width}×${spec.height}`
      : `${measured.width}×${measured.height} — needs ${spec.width}×${spec.height}; crop to ${(target).toFixed(2)}:1 first`,
  };
}

export function specFor(
  role: ImageRole,
  brand: { featuredImageWidth: number; featuredImageHeight: number; ogImageWidth: number; ogImageHeight: number },
): { width: number; height: number } {
  return role === "featured"
    ? { width: brand.featuredImageWidth, height: brand.featuredImageHeight }
    : { width: brand.ogImageWidth, height: brand.ogImageHeight };
}

/** Everything the publish gate needs to judge a post's assets. */
export async function loadAssetGate(workspaceId: string, postId: string): Promise<AssetGate> {
  const [brand, rows] = await Promise.all([
    getBrandKit(workspaceId),
    db.blogImage.findMany({ where: { postId } }),
  ]);
  return {
    required: brand.requireImagesToPublish,
    images: rows.map((r) => ({
      role: r.role,
      altText: r.altText,
      width: r.width,
      height: r.height,
      status: r.status,
      branded: r.branded,
    })),
    spec: { featured: specFor("featured", brand), og: specFor("og", brand) },
  };
}

// ---- Briefs ----------------------------------------------------------------------

export type ImageBriefs = { featured?: string; og?: string };

export function briefKey(postId: string): string {
  return `blog:imagebriefs:${postId}`;
}

export async function getImageBriefs(postId: string): Promise<ImageBriefs> {
  const row = await db.setting.findUnique({ where: { key: briefKey(postId) } });
  if (!row) return {};
  try {
    const parsed = JSON.parse(row.value) as ImageBriefs;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Write the featured + OG image briefs. The OG brief is always branded (it is
 * the social/search preview); the featured brief stays clean unless the
 * workspace opted into branding in-body imagery.
 */
export async function generateImageBriefsCore(workspaceId: string, postId: string): Promise<boolean> {
  if (await isGloballyPaused(workspaceId)) return false;
  const post = await db.blogPost.findFirst({ where: { id: postId, workspaceId } });
  if (!post) return false;
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) return false;
  const brand = await getBrandKit(workspaceId);
  const motifs = await motifPromptFor(workspaceId, post, "short");

  const brandLine = [
    brand.primaryColor ? `primary ${brand.primaryColor}` : null,
    brand.secondaryColor ? `secondary ${brand.secondaryColor}` : null,
    brand.accentColor ? `accent ${brand.accentColor}` : null,
    brand.headingFont ? `heading font ${brand.headingFont}` : null,
    brand.logoUrl ? "a logo lockup is available" : "no logo on file",
  ]
    .filter(Boolean)
    .join(", ");

  const system =
    "You write art-direction briefs for editorial images. Respond ONLY with JSON: " +
    '{"featured": string, "og": string}. Each brief is 4-6 sentences covering subject, composition, ' +
    "colour treatment, and what to avoid. Concrete and specific — no mood-board waffle. " +
    "Direct like a magazine art director, not a slide designer: NAME a specific medium suited to the " +
    "subject (cinematic photography, painterly illustration, tactile 3D, macro detail), specify the " +
    "lighting and where the depth comes from, and demand texture and material richness — never flat " +
    "corporate vector minimalism or a plain gradient backdrop. " +
    "Explicitly forbid generic stock clichés (handshakes, faceless suits, glowing circuit boards, " +
    "people pointing at charts). Never describe text overlays that state statistics or claims.";

  const prompt = [
    `Article title: "${post.title}".`,
    post.focusKeyword ? `Focus keyword: ${post.focusKeyword}.` : null,
    post.audience ? `Audience: ${post.audience}.` : null,
    motifs,
    brandLine ? `Brand kit: ${brandLine}.` : null,
    post.body ? `Article summary: ${post.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 900)}` : null,
    `The featured image is ${brand.featuredImageWidth}×${brand.featuredImageHeight} and sits at the top of the article; keep it ${
      brand.brandInBodyImages ? "branded with the logo lockup" : "clean and unbranded"
    }.`,
    `The Open Graph image is ${brand.ogImageWidth}×${brand.ogImageHeight} for social and search previews; it is ALWAYS branded — specify where the logo lockup sits and keep the safe area clear of small text.`,
    // ⚠ The provider renders at a coarser size (e.g. 1536×1024) and the
    // pipeline cover-crops to the exact target, cutting the top and bottom
    // edges. Briefs that placed the lockup at the top edge produced a clipped
    // logo on EVERY render (found on the first autonomous draft's OG,
    // 2026-08-25) — the brief writer has to know about the crop.
    `Placement rule for BOTH images: the final crop removes the top and bottom edges of the frame, so the logo lockup and any text must sit fully within the middle 60% of the frame's height — never in the top fifth or bottom fifth.`,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await llm.complete({
    model: post.model ?? workspace.defaultModel ?? llm.defaultModel,
    system,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 800,
    workspaceId,
  });
  // The router falls back to mock SILENTLY on any provider error, and mock
  // prose is fluent — unattended, a mock brief would go on to spend two real
  // image renders painting nonsense. No brief beats a fake one.
  if (res.provider === "mock") {
    console.warn("[blog-images] brief generation fell back to mock — refusing to store it");
    return false;
  }
  let parsed: ImageBriefs = {};
  try {
    const m = res.content.match(/\{[\s\S]*\}/);
    parsed = m ? (JSON.parse(m[0]) as ImageBriefs) : {};
  } catch {
    parsed = {};
  }
  const briefs: ImageBriefs = {
    featured: typeof parsed.featured === "string" ? parsed.featured.trim().slice(0, 2000) : undefined,
    og: typeof parsed.og === "string" ? parsed.og.trim().slice(0, 2000) : undefined,
  };
  if (!briefs.featured && !briefs.og) return false;

  await db.setting.upsert({
    where: { key: briefKey(postId) },
    update: { value: JSON.stringify(briefs) },
    create: { key: briefKey(postId), value: JSON.stringify(briefs) },
  });
  await writeAudit({
    workspaceId,
    action: "blog.image_briefs_generated",
    entityType: "blog_post",
    entityId: postId,
  });
  return true;
}

// ---- Attach / generate -------------------------------------------------------------

/** Attach an image by URL, measuring it on the way in. */
export async function attachImageCore(
  workspaceId: string,
  postId: string,
  role: ImageRole,
  url: string,
  altText: string | null,
  branded: boolean,
): Promise<boolean> {
  const post = await db.blogPost.findFirst({ where: { id: postId, workspaceId } });
  if (!post || !/^https?:\/\//i.test(url)) return false;
  const dims = await probeImageDimensions(url);
  const data = {
    url: url.slice(0, 1000),
    altText: altText?.slice(0, 200) ?? null,
    width: dims?.width ?? null,
    height: dims?.height ?? null,
    source: "url",
    status: "approved", // a human chose this file — that is the review
    branded: role === "og" ? true : branded,
  };
  await db.blogImage.upsert({
    where: { postId_role: { postId, role } },
    update: data,
    create: { postId, role, ...data },
  });
  await writeAudit({
    workspaceId,
    action: "blog.image_attached",
    entityType: "blog_post",
    entityId: postId,
    meta: { role, measured: dims ? `${dims.width}x${dims.height}` : "unknown" },
  });
  return true;
}

/**
 * Alt text from an art-direction brief: its first sentence, which describes
 * the subject ("Tactile 3D render of a tarnished brass coin-meter…"). Capped
 * at a word boundary under the 200-char column limit.
 *
 * Exists because images generated WITHOUT alt text dead-end the workflow: the
 * asset gate requires alt (WCAG), so every autopilot article stalled at an ✕
 * no amount of approving could clear (found by the user on the first real
 * walk-through, 2026-08-12). A derived default the human can edit beats an
 * empty field only the human can notice.
 */
export function altFromBrief(brief: string): string | null {
  const first = brief.trim().split(/(?<=[.!?])\s+/)[0] ?? "";
  let clean = first.replace(/\s+/g, " ").trim();
  // Briefs speak to a painter ("Create a high-end macro still-life…"); alt
  // text speaks to a reader. Strip the leading imperative so it describes.
  clean = clean.replace(
    /^(?:create|render|generate|produce|design|make|illustrate|compose|depict|show(?:case)?|paint|craft)\b[\s:,-]*(?:an?\s+|the\s+)?/i,
    "",
  );
  clean = clean.charAt(0).toUpperCase() + clean.slice(1);
  if (!clean) return null;
  if (clean.length <= 200) return clean;
  const cut = clean.slice(0, 200);
  return cut.slice(0, cut.lastIndexOf(" ") > 120 ? cut.lastIndexOf(" ") : 200).trim();
}

/**
 * Generate an image from the brief. Lands as `pending`: AI imagery always goes
 * through human review before it can satisfy the publish gate.
 */
export async function generateImageCore(workspaceId: string, postId: string, role: ImageRole): Promise<boolean> {
  if (await isGloballyPaused(workspaceId)) return false;
  const brand = await getBrandKit(workspaceId);
  if (!brand.aiImagesEnabled) return false;
  const post = await db.blogPost.findFirst({ where: { id: postId, workspaceId } });
  if (!post) return false;
  const briefs = await getImageBriefs(postId);
  const brief = role === "featured" ? briefs.featured : briefs.og;
  if (!brief) return false;

  const spec = specFor(role, brand);
  const ratio = spec.width / spec.height;
  const aspect: "16:9" | "1:1" | "9:16" = ratio > 1.3 ? "16:9" : ratio < 0.85 ? "9:16" : "1:1";
  // A real provider THROWS rather than substituting a placeholder (see
  // lib/images). This core runs unattended from autopilot, where an uncaught
  // throw would take down the whole cycle — so it degrades to "no image made"
  // like every other early return here, and leaves no fake image behind.
  //
  // `output: spec` does two jobs at once: the stored file is EXACTLY the
  // brand's pixel spec (so the dimension gate passes instead of warning about
  // 1536×1024-vs-1920×1080 forever), and the sharp re-encode it implies drops
  // the C2PA content credentials gpt-image/gemini stamp into every file — the
  // same strip social publishing does, done here because blog images leave
  // through many doors (WP media upload, og:image scrapes, manual download).
  // ⚠ Google SynthID is pixel-level and survives; provenance stays recorded in
  // the audit row and BlogImage.source either way.
  let out;
  try {
    out = await imageProvider.generate({
      prompt: brief.slice(0, 1200),
      aspectRatio: aspect,
      workspaceId,
      output: spec,
    });
  } catch (e) {
    console.warn("[blog-images] generation failed:", e instanceof Error ? e.message : e);
    return false;
  }

  // Alt text ships WITH the image — an empty alt fails the asset gate and the
  // ✕ it produces cannot be cleared by approving (the trap the user hit on the
  // first real walk-through). The brief's own subject sentence is the default;
  // the reviewer can edit it on the image card.
  const data = {
    url: out.url,
    width: out.width,
    height: out.height,
    source: "ai",
    status: "pending",
    branded: role === "og",
    brief: brief.slice(0, 2000),
    altText: altFromBrief(brief),
  };
  await db.blogImage.upsert({
    where: { postId_role: { postId, role } },
    update: data,
    create: { postId, role, ...data },
  });
  await writeAudit({
    workspaceId,
    action: "blog.image_generated",
    entityType: "blog_post",
    entityId: postId,
    meta: { role, provider: out.provider, status: "pending_review" },
  });
  return true;
}

/**
 * The unattended path: briefs (if none yet) then featured + OG, for a freshly
 * drafted post. Called by autopilot right after a draft parks at review, so
 * the human reviewing the article finds its imagery waiting in the same place
 * — still `pending`, still theirs to approve.
 *
 * ⚠ NEVER overwrites a human's choice. A role whose image was attached by URL
 * or upload, or already approved, is skipped — `generateImageCore`'s
 * unconditional upsert is correct under the manual button (a human clicked)
 * and wrong here. Gated on `aiImagesEnabled` BEFORE brief generation so a
 * workspace with images off doesn't spend LLM budget writing briefs nobody
 * will render.
 */
export async function generateBlogImagesCore(workspaceId: string, postId: string): Promise<number> {
  const brand = await getBrandKit(workspaceId);
  if (!brand.aiImagesEnabled) return 0;

  let briefs = await getImageBriefs(postId);
  if (!briefs.featured && !briefs.og) {
    if (!(await generateImageBriefsCore(workspaceId, postId))) return 0;
    briefs = await getImageBriefs(postId);
  }

  let made = 0;
  for (const role of IMAGE_ROLES) {
    const existing = await db.blogImage.findUnique({ where: { postId_role: { postId, role } } });
    if (existing && (existing.source !== "ai" || existing.status === "approved")) continue;
    if (await generateImageCore(workspaceId, postId, role)) made++;
  }
  return made;
}
