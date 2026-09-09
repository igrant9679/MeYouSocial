import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { PRODUCT } from "@/lib/product";

/**
 * The no-WordPress fallback (owner's ask, 2026-09-06): a self-contained HTML
 * file of an article that can be added to any site by hand.
 *
 * GET /blog/<id>/export              → a full document: head (title, meta
 *                                       description, canonical, Open Graph),
 *                                       minimal CSS, <article> with the
 *                                       featured image and the body.
 * GET /blog/<id>/export?fragment=1   → just the <article> for pasting into a
 *                                       CMS block.
 *
 * Images are EMBEDDED as data URIs. The app serves images through
 * session-gated routes (/uploads/<key>, /api/files/<key>), so a plain link
 * would break the moment the file left the app; embedding keeps the file
 * standing on its own. Anyone in the workspace can download (the article is
 * theirs to read); publishing is still an admin's act.
 */

const LOCAL_IMG = /^\/(?:uploads|api\/files)\/([^"'\s)?#]+)/;

function mimeOf(bytes: Buffer): string {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.length > 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (bytes.length > 6 && bytes.subarray(0, 6).toString("ascii").startsWith("GIF8")) return "image/gif";
  return "application/octet-stream";
}

/** A local image URL → data URI; anything else (already absolute) is left alone. */
async function embed(url: string): Promise<string> {
  const m = url.match(LOCAL_IMG);
  if (!m) return url;
  const bytes = await storage.get(decodeURIComponent(m[1])).catch(() => null);
  if (!bytes) return url;
  return `data:${mimeOf(bytes)};base64,${bytes.toString("base64")}`;
}

async function embedInline(html: string): Promise<string> {
  const srcs = new Set<string>();
  for (const m of html.matchAll(/<img\b[^>]*\ssrc=["']([^"']+)["']/gi)) if (LOCAL_IMG.test(m[1])) srcs.add(m[1]);
  let out = html;
  for (const src of srcs) {
    const data = await embed(src);
    if (data !== src) out = out.split(src).join(data);
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { workspace } = await requireMembership();
  const post = await db.blogPost.findFirst({
    where: { id, workspaceId: workspace.id },
    include: { images: { where: { status: "approved" }, orderBy: { createdAt: "desc" } } },
  });
  if (!post) return new Response("Not found", { status: 404 });

  const fragment = new URL(req.url).searchParams.get("fragment") === "1";
  const featured = post.images.find((i) => i.role === "featured") ?? null;
  const og = post.images.find((i) => i.role === "og") ?? featured;
  const [featuredSrc, ogSrc, body] = await Promise.all([
    featured ? embed(featured.url) : Promise.resolve(null),
    og ? embed(og.url) : Promise.resolve(null),
    embedInline(post.body ?? ""),
  ]);

  const article =
    `<article>\n` +
    `  <h1>${esc(post.title)}</h1>\n` +
    (featuredSrc
      ? `  <figure><img src="${featuredSrc}" alt="${esc(featured?.altText ?? "")}"${featured?.width ? ` width="${featured.width}"` : ""}${featured?.height ? ` height="${featured.height}"` : ""}></figure>\n`
      : "") +
    `  ${body}\n` +
    `</article>`;

  const slug = (post.slug || post.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80) || "article";
  const filename = `${slug}${fragment ? ".fragment" : ""}.html`;

  const html = fragment
    ? article
    : `<!doctype html>\n<html lang="en">\n<head>\n` +
      `<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
      `<title>${esc(post.metaTitle || post.title)}</title>\n` +
      (post.metaDescription ? `<meta name="description" content="${esc(post.metaDescription)}">\n` : "") +
      (post.canonicalUrl ? `<link rel="canonical" href="${esc(post.canonicalUrl)}">\n` : "") +
      `<meta property="og:type" content="article">\n<meta property="og:title" content="${esc(post.metaTitle || post.title)}">\n` +
      (post.metaDescription ? `<meta property="og:description" content="${esc(post.metaDescription)}">\n` : "") +
      (ogSrc ? `<meta property="og:image" content="${ogSrc}">\n` : "") +
      `<!--\n  Exported from ${PRODUCT} (${esc(workspace.name)}) on ${new Date().toISOString().slice(0, 10)}.\n` +
      `  Images are embedded so this file stands on its own. For social previews, upload the Open Graph image\n` +
      `  to your site and point og:image at its public URL — crawlers ignore data URIs.\n-->\n` +
      `<style>\n  body{margin:0;background:#fff;color:#1a1d26;font-family:system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;line-height:1.6}\n` +
      `  article{max-width:720px;margin:0 auto;padding:40px 20px 80px}\n  h1{font-size:2rem;line-height:1.2;margin:0 0 20px}\n` +
      `  figure{margin:0 0 24px}\n  img{max-width:100%;height:auto;border-radius:8px}\n  h2{margin-top:2em}\n  a{color:#4a31b8}\n  blockquote{border-left:3px solid #ddd;margin:1.2em 0;padding-left:1em;color:#5c6371}\n</style>\n` +
      `</head>\n<body>\n${article}\n</body>\n</html>\n`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
