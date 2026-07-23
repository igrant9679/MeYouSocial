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
    '{"featured": string, "og": string}. Each brief is 3-5 sentences covering subject, composition, ' +
    "colour treatment, and what to avoid. Concrete and specific — no mood-board waffle. " +
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
  const out = await imageProvider.generate({ prompt: brief.slice(0, 1200), aspectRatio: aspect });

  await db.blogImage.upsert({
    where: { postId_role: { postId, role } },
    update: {
      url: out.url,
      width: out.width,
      height: out.height,
      source: "ai",
      status: "pending",
      branded: role === "og",
      brief: brief.slice(0, 2000),
    },
    create: {
      postId,
      role,
      url: out.url,
      width: out.width,
      height: out.height,
      source: "ai",
      status: "pending",
      branded: role === "og",
      brief: brief.slice(0, 2000),
    },
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
