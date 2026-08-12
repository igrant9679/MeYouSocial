import { NextRequest, NextResponse } from "next/server";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { getBrandKit } from "@/lib/motifs";
import { buildJsonLd } from "@/lib/blog-jsonld";
import { renderForPublish } from "@/lib/blog-render";
import { isRenderProfile, parseRenderRules } from "@/lib/design-render";
import { writeAudit } from "@/lib/governance";

/**
 * GET /api/blog-export/<postId> — the article as ONE standalone HTML file, for
 * publishing on any site that isn't WordPress ("publish anywhere" on the
 * Website page).
 *
 * The same rendering the WordPress path uses (renderForPublish + JSON-LD), but
 * self-contained: our stored images are served by session-gated routes that
 * the outside world can't read, so every one referenced by the body (and the
 * featured image) is fetched and EMBEDDED as a data URI. The file renders
 * identically pasted into a CMS or hosted as-is.
 *
 * ⚠ No og:image on purpose. Scrapers don't read data URIs and our storage
 * URLs are private, so any og:image we could emit here would be a lie that
 * previews as a broken card. The page says to set the preview image in the
 * destination CMS; og:title/description are real and included.
 */

export const dynamic = "force-dynamic";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Fetch a session-gated storage URL's bytes and return a data URI, or null. */
async function embed(url: string): Promise<string | null> {
  const m = url.match(/\/(?:uploads|api\/files)\/([^"'\s)]+)/);
  if (!m) return null;
  let key = m[1];
  try {
    key = decodeURIComponent(key);
  } catch { /* leave as-is */ }
  const buf = await storage.get(key).catch(() => null);
  if (!buf) return null;
  const b = Buffer.from(buf);
  const mime =
    b[0] === 0x89 && b[1] === 0x50 ? "image/png"
    : b[0] === 0xff && b[1] === 0xd8 ? "image/jpeg"
    : b.length > 12 && b.toString("ascii", 8, 12) === "WEBP" ? "image/webp"
    : b[0] === 0x47 && b[1] === 0x49 ? "image/gif"
    : null;
  if (!mime) return null;
  return `data:${mime};base64,${b.toString("base64")}`;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { workspace, user } = await requireMembership();
  const { id } = await params;

  const post = await db.blogPost.findFirst({
    where: { id, workspaceId: workspace.id },
    include: { images: true },
  });
  if (!post || !post.body) return new NextResponse("Not found", { status: 404 });

  const brand = await getBrandKit(workspace.id);
  const rendered = renderForPublish(post.body, {
    headingSpec: brand.headingSpec,
    footerCredit: brand.footerCredit,
    renderProfile: isRenderProfile(brand.renderProfile) ? brand.renderProfile : "html",
    renderRules: parseRenderRules(brand.renderRules),
  });

  // Embed every stored image the body references; leave external URLs alone.
  let body = rendered.html;
  const stored = [...new Set(body.match(/(?:\/uploads|\/api\/files)\/[^"'\s)]+/g) ?? [])];
  for (const url of stored) {
    const data = await embed(url);
    if (data) body = body.split(url).join(data);
  }

  const featured = post.images.find((i) => i.role === "featured" && i.status === "approved");
  const featuredData = featured ? await embed(featured.url) : null;
  const hero = featuredData
    ? `<figure style="margin:0 0 1.5rem"><img src="${featuredData}" alt="${esc(featured!.altText ?? "")}" style="width:100%;height:auto;display:block"/></figure>\n`
    : "";

  const title = post.metaTitle ?? post.title;
  const html = [
    "<!doctype html>",
    `<html lang="en">`,
    "<head>",
    `<meta charset="utf-8"/>`,
    `<meta name="viewport" content="width=device-width, initial-scale=1"/>`,
    `<title>${esc(title)}</title>`,
    post.metaDescription ? `<meta name="description" content="${esc(post.metaDescription)}"/>` : "",
    `<meta property="og:type" content="article"/>`,
    `<meta property="og:title" content="${esc(title)}"/>`,
    post.metaDescription ? `<meta property="og:description" content="${esc(post.metaDescription)}"/>` : "",
    "<!-- og:image deliberately absent: scrapers can't read embedded images. Set the preview image in your CMS. -->",
    `<script type="application/ld+json">${buildJsonLd(post, workspace.name)}</script>`,
    "</head>",
    `<body style="max-width:720px;margin:0 auto;padding:2rem 1rem;font-family:Georgia,serif;line-height:1.7">`,
    `<article>`,
    hero,
    `<h1>${esc(post.title)}</h1>`,
    body,
    `</article>`,
    "</body>",
    "</html>",
  ]
    .filter(Boolean)
    .join("\n");

  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "blog.html_exported",
    entityType: "blog_post",
    entityId: post.id,
    meta: { bytes: html.length, imagesEmbedded: stored.length + (featuredData ? 1 : 0) },
  });

  const filename = `${post.slug || post.id}.html`;
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
