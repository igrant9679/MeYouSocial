import { NextRequest, NextResponse } from "next/server";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { getBrandKit } from "@/lib/motifs";
import { renderForPublish, stripLeadingH1 } from "@/lib/blog-render";
import { isRenderProfile, parseRenderRules } from "@/lib/design-render";
import { buildSitePreview, esc, inertHtml, onSite, PREVIEW_CSP } from "@/lib/site-preview";

/**
 * GET /api/blog-preview/<postId> — the article as it will look on the
 * connected site (E-ART-17), for the frame on the Review tab.
 *
 * The body is rendered exactly as publishing renders it (the design-system
 * mapping, the heading spec, the leading h1 dropped because the theme prints
 * the headline), then placed into a real page of the site by lib/site-preview.
 * The response allows styles, fonts and images only and is sandboxed even when
 * opened on its own, so nothing on the borrowed page — or in the body — runs.
 * Any member may look; it changes nothing.
 */

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { workspace } = await requireMembership();
  const { id } = await params;
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id }, include: { images: true } });
  if (!post) return new NextResponse("Not found", { status: 404 });

  const brand = await getBrandKit(workspace.id);
  const rendered = post.body
    ? renderForPublish(stripLeadingH1(post.body), {
        headingSpec: brand.headingSpec,
        footerCredit: brand.footerCredit,
        renderProfile: isRenderProfile(brand.renderProfile) ? brand.renderProfile : "html",
        renderRules: parseRenderRules(brand.renderRules),
      }).html
    : "<p><em>This article has no body yet.</em></p>";
  // Embeds can't load under the preview's policy; say where each would be rather than leave a hole.
  const bodyHtml = inertHtml(
    rendered.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, (tag) => {
      const src = tag.match(/\ssrc\s*=\s*["']([^"']+)["']/i)?.[1];
      let host = "another site";
      try {
        if (src) host = new URL(src, "https://x.invalid").hostname;
      } catch {
        // keep "another site"
      }
      return `<div style="padding:24px;margin:1em 0;background:#f2f2f2;color:#555;font:14px/1.4 system-ui,sans-serif;text-align:center">Embed from ${esc(host)} — it shows on the live page, not in this preview.</div>`;
    }),
  );

  const conn = await db.wordPressConnection.findUnique({ where: { workspaceId: workspace.id }, select: { baseUrl: true } });
  let site = conn?.baseUrl ?? null;
  if (!site && post.publishedUrl) {
    try {
      site = new URL(post.publishedUrl).origin;
    } catch {
      site = null;
    }
  }
  // The page to borrow: this workspace's newest live articles on that site (two,
  // in case one has gone), then the home page.
  const live = site
    ? await db.blogPost.findMany({
        where: { workspaceId: workspace.id, status: "published", publishedUrl: { not: null } },
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        take: 8,
        select: { publishedUrl: true },
      })
    : [];
  const templates = site ? [...new Set([...live.map((l) => l.publishedUrl!).filter((u) => onSite(u, site!)).slice(0, 2), site])] : [];

  const featured = post.images.find((i) => i.role === "featured" && i.status === "approved");
  const pv = await buildSitePreview(
    { title: post.title, bodyHtml, featured: featured ? { url: featured.url, alt: featured.altText ?? "" } : null },
    site,
    templates,
  );
  return new NextResponse(pv.html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": PREVIEW_CSP,
      "x-robots-tag": "noindex",
      // What the frame shows, for the page and for checks — never anything secret.
      "x-preview-mode": pv.mode,
    },
  });
}
