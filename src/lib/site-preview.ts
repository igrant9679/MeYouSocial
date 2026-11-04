/**
 * Preview an article as it will look on the connected site (E-ART-17).
 *
 * The "Rendered output" panel shows what publishing sends, as markup; a
 * theme's fonts, widths, colours and chrome are what readers see. So the
 * preview borrows a real page from the site — the newest of this workspace's
 * live articles there, else the home page — and puts this article's title,
 * featured image and rendered body where that page had its own. Only the
 * connected host is read (same-host redirects only), as for the live-page
 * check (lib/live-head). Nothing is cached: a theme change shows next time.
 *
 * Nothing on the borrowed page runs. Scripts, frames, embeds and event
 * handlers are removed, lazy images get their real source, and the result is
 * served under a policy that allows styles, fonts and images only, into a
 * frame sandboxed without scripts. A theme that draws parts of its page with
 * JavaScript shows those parts bare — the bar at the top says scripts are off.
 */

export type SitePreview = {
  html: string;
  /** page: the article sits in a real page of the site · styles: the site's stylesheets around a plain article · plain: no site styles. */
  mode: "page" | "styles" | "plain";
  /** The site page the look came from. */
  from: string | null;
  note: string;
};

export type PreviewArticle = { title: string; bodyHtml: string; featured: { url: string; alt: string } | null };

const sameHost = (a: URL, b: URL) => a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, "");

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** True when `link` is on the same site as `siteBaseUrl` (www. ignored). */
export function onSite(link: string, siteBaseUrl: string): boolean {
  try {
    const u = new URL(link);
    return /^https?:$/.test(u.protocol) && sameHost(u, new URL(siteBaseUrl));
  } catch {
    return false;
  }
}

/** Read one page of the site (same-host redirects only). Never throws. */
export async function fetchSitePage(link: string, siteBaseUrl: string): Promise<{ html: string; url: string } | { error: string }> {
  let url: URL;
  let site: URL;
  try {
    url = new URL(link);
    site = new URL(siteBaseUrl);
  } catch {
    return { error: "The site's address isn't a valid URL." };
  }
  if (!/^https?:$/.test(url.protocol) || !sameHost(url, site)) return { error: `${url.hostname} isn't the connected site (${site.hostname}).` };
  try {
    for (let hop = 0; hop < 4; hop++) {
      const res = await fetch(url, {
        redirect: "manual",
        headers: { accept: "text/html", "user-agent": "Mozilla/5.0 (compatible; MeYouSocial preview)" },
        signal: AbortSignal.timeout(12_000),
      });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (loc) {
        await res.body?.cancel().catch(() => {});
        const next = new URL(loc, url);
        if (!sameHost(next, site)) return { error: `${url.hostname} redirects off the site (${next.hostname}).` };
        url = next;
        continue;
      }
      if (!res.ok) return { error: `${url.toString()} answered ${res.status}.` };
      return { html: (await res.text()).slice(0, 1_500_000), url: url.toString() };
    }
    return { error: "The site redirected too many times." };
  } catch (e) {
    return { error: e instanceof Error && e.name === "TimeoutError" ? "The site took longer than 12 seconds to answer." : "The site couldn't be reached." };
  }
}

/** Remove what could run or navigate on load, and give lazy images their real source. Pure. */
export function inertHtml(html: string): string {
  return (
    html
      .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
      .replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, "")
      .replace(/<(iframe|object|embed|frameset|frame|applet|portal)\b[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<(?:iframe|object|embed|frame|portal)\b[^>]*>/gi, "")
      .replace(/<base\b[^>]*>/gi, "")
      .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, "")
      // Stylesheets loaded "async" (preload, then a script flips rel) load directly; other hints go.
      .replace(/<link\b[^>]*>/gi, (tag) =>
        /\brel\s*=\s*["']?preload\b/i.test(tag) && /\bas\s*=\s*["']?style\b/i.test(tag)
          ? tag.replace(/\brel\s*=\s*(["']?)preload\1/i, 'rel="stylesheet"')
          : /\brel\s*=\s*["']?(?:preload|prefetch|modulepreload|prerender|preconnect|dns-prefetch)\b/i.test(tag)
            ? ""
            : tag,
      )
      .replace(/<[a-z][a-z0-9-]*\b[^>]*>/gi, (tag) => {
        let t = tag
          .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
          .replace(/\b(href|src|action|formaction|xlink:href)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1=$2#$2');
        if (/^<(img|source)\b/i.test(t)) {
          const lazy = (name: string) => t.match(new RegExp(`\\s(?:data-lazy-${name}|data-${name})\\s*=\\s*"([^"]+)"`, "i"))?.[1];
          const src = lazy("src");
          const srcset = lazy("srcset");
          const placeholder = (attr: string) => {
            const v = t.match(new RegExp(`\\s${attr}\\s*=\\s*"([^"]*)"`, "i"));
            return !v || v[1].trim() === "" || v[1].startsWith("data:");
          };
          if (src && placeholder("src")) t = /\ssrc\s*=/i.test(t) ? t.replace(/\ssrc\s*=\s*"[^"]*"/i, ` src="${src}"`) : t.replace(/^<(img|source)\b/i, `<$1 src="${src}"`);
          if (srcset && placeholder("srcset")) t = /\ssrcset\s*=/i.test(t) ? t.replace(/\ssrcset\s*=\s*"[^"]*"/i, ` srcset="${srcset}"`) : t.replace(/^<(img|source)\b/i, `<$1 srcset="${srcset}"`);
        }
        return t;
      })
  );
}

/** Make the page's relative addresses absolute — links, images, stylesheets, and url()s in its styles. Pure. */
export function absoluteUrls(html: string, pageUrl: string): string {
  const abs = (v: string) => {
    const s = v.trim();
    if (!s || /^(#|data:|mailto:|tel:|javascript:|about:|blob:)/i.test(s)) return v;
    try {
      return new URL(s.replace(/&amp;/g, "&"), pageUrl).toString().replace(/&/g, "&amp;");
    } catch {
      return v;
    }
  };
  const cssUrls = (css: string) =>
    css
      .replace(/url\(\s*(&quot;|['"]|)(.*?)\1\s*\)/gi, (_m, q: string, u: string) => `url(${q}${abs(u)}${q})`)
      .replace(/@import\s+(['"])([^'"]+)\1/gi, (_m, q: string, u: string) => `@import ${q}${abs(u)}${q}`);
  return html
    .replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_m, attrs: string, css: string) => `<style${attrs}>${cssUrls(css)}</style>`)
    .replace(/<[a-z][a-z0-9-]*\b[^>]*>/gi, (tag) =>
      tag
        .replace(/(\s(?:href|src|poster|data-src|data-lazy-src))\s*=\s*"([^"]*)"/gi, (_m, a: string, v: string) => `${a}="${abs(v)}"`)
        .replace(/(\s(?:href|src|poster))\s*=\s*'([^']*)'/gi, (_m, a: string, v: string) => `${a}='${abs(v)}'`)
        .replace(/(\s(?:srcset|data-srcset|data-lazy-srcset))\s*=\s*"([^"]*)"/gi, (_m, a: string, v: string) =>
          `${a}="${v.split(",").map((part) => { const [u, ...d] = part.trim().split(/\s+/); return u ? [abs(u), ...d].join(" ") : part; }).join(", ")}"`,
        )
        .replace(/(\sstyle)\s*=\s*"([^"]*)"/gi, (_m, a: string, v: string) => `${a}="${cssUrls(v)}"`),
    );
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

export type Span = { open: number; innerStart: number; innerEnd: number; close: number; tag: string };

/** Where an element that opens at `open` ends, counting nested elements of the same tag. Pure. */
function spanAt(html: string, open: number, openTag: string, tag: string): Span | null {
  const innerStart = open + openTag.length;
  if (VOID.has(tag) || openTag.endsWith("/>")) return { open, innerStart, innerEnd: innerStart, close: innerStart, tag };
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = innerStart;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[1]) depth--;
    else if (!m[0].endsWith("/>")) depth++;
    if (depth === 0) return { open, innerStart, innerEnd: m.index, close: m.index + m[0].length, tag };
  }
  return null;
}

/**
 * The first element in [from, to) whose class list holds one of `classes` —
 * tried in the order given, so the likeliest name wins — with where its
 * content starts and ends. Pure.
 */
export function findByClass(html: string, classes: string[], from = 0, to = html.length): Span | null {
  for (const cls of classes) {
    const re = /<([a-z][a-z0-9-]*)\b[^>]*?\bclass\s*=\s*(["'])([^"']*)\2[^>]*>/gi;
    re.lastIndex = from;
    for (let m = re.exec(html); m && m.index < to; m = re.exec(html)) {
      if (!m[3].split(/\s+/).includes(cls)) continue;
      const span = spanAt(html, m.index, m[0], m[1].toLowerCase());
      if (span) return span;
    }
  }
  return null;
}

/** Where themes put a single article's body, its headline, and its featured picture. */
export const CONTENT_CLASSES = ["entry-content", "wp-block-post-content", "post-content", "single-post-content", "article-content", "post-entry", "td-post-content", "elementor-widget-theme-post-content"];
export const TITLE_CLASSES = ["entry-title", "wp-block-post-title", "post-title", "single-post-title", "page-title", "fusion-post-title"];
export const FEATURED_CLASSES = ["post-thumbnail", "wp-block-post-featured-image", "featured-image", "entry-thumbnail", "post-featured-image", "single-featured-image"];

const BODY_TOKEN = "\u0000MYS_ARTICLE_BODY\u0000";

const imgTag = (f: { url: string; alt: string }) => `<img src="${esc(f.url)}" alt="${esc(f.alt)}" style="max-width:100%;height:auto">`;

/**
 * Put the article into a page of the site: its body where the page's article
 * body was, its headline in the page's headline, its featured image in the
 * page's featured slot (emptied when the article has none, so another
 * article's picture never shows). Returns null when the page has no article
 * body to replace. The page must already be inert and absolute. Pure.
 */
export function fillTemplate(page: string, a: PreviewArticle): { html: string; placed: { title: boolean; featured: "placed" | "emptied" | "no-slot" } } | null {
  const content = findByClass(page, CONTENT_CLASSES);
  if (!content) return null;
  let html = page.slice(0, content.innerStart) + BODY_TOKEN + page.slice(content.innerEnd);
  // Look for the headline and picture in the article around the body (else the
  // main area), never in a sidebar or "related posts" list further down.
  const before = html.slice(0, content.innerStart);
  const regionStart = Math.max(before.lastIndexOf("<article"), before.lastIndexOf("<main"), 0);
  let bodyAt = html.indexOf(BODY_TOKEN);

  let title = false;
  const t = findByClass(html, TITLE_CLASSES, regionStart, bodyAt) ?? (() => {
    const re = /<h1\b[^>]*>/gi;
    re.lastIndex = regionStart;
    const m = re.exec(html);
    return m && m.index < bodyAt ? spanAt(html, m.index, m[0], "h1") : null;
  })();
  if (t) {
    // A title link keeps its <a>, with our headline inside.
    const inner = html.slice(t.innerStart, t.innerEnd);
    const link = inner.match(/^\s*(<a\b[^>]*>)[\s\S]*<\/a>\s*$/i);
    html = html.slice(0, t.innerStart) + (link ? `${link[1]}${esc(a.title)}</a>` : esc(a.title)) + html.slice(t.innerEnd);
    title = true;
    bodyAt = html.indexOf(BODY_TOKEN);
  }

  let featured: "placed" | "emptied" | "no-slot" = "no-slot";
  const f = findByClass(html, FEATURED_CLASSES, regionStart, bodyAt);
  if (f) {
    const inner = html.slice(f.innerStart, f.innerEnd);
    let next: string;
    if (a.featured) {
      const pic = a.featured;
      // Keep the theme's <img> (its classes size it); only the picture changes.
      next = /<picture\b/i.test(inner)
        ? inner.replace(/<picture\b[^>]*>[\s\S]*?<\/picture>/i, imgTag(pic))
        : /<img\b/i.test(inner)
          ? inner.replace(/<img\b[^>]*>/i, (tag) => {
              const t = tag.replace(/\s(?:srcset|sizes|data-src|data-srcset|data-lazy-src|data-lazy-srcset)\s*=\s*"[^"]*"/gi, "");
              const withSrc = /\ssrc\s*=/i.test(t) ? t.replace(/\ssrc\s*=\s*"[^"]*"/i, ` src="${esc(pic.url)}"`) : t.replace(/^<img\b/i, `<img src="${esc(pic.url)}"`);
              return /\salt\s*=/i.test(withSrc) ? withSrc.replace(/\salt\s*=\s*"[^"]*"/i, ` alt="${esc(pic.alt)}"`) : withSrc.replace(/^<img\b/i, `<img alt="${esc(pic.alt)}"`);
            })
          : imgTag(pic);
      featured = "placed";
    } else {
      next = "";
      featured = "emptied";
    }
    html = html.slice(0, f.innerStart) + next + html.slice(f.innerEnd);
  }

  // A page with no headline of its own gets ours at the top of the body.
  const body = (title ? "" : `<h1 class="entry-title">${esc(a.title)}</h1>`) + a.bodyHtml;
  html = html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, `<title>${esc(a.title)}</title>`);
  return { html: html.split(BODY_TOKEN).join(body), placed: { title, featured } };
}

/** The site's <head> (its stylesheets and fonts) around a plain WordPress-shaped article. Pure. */
export function stylesDocument(page: string, a: PreviewArticle): string {
  const head = page.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
  const lang = page.match(/<html\b[^>]*\blang\s*=\s*"([^"]+)"/i)?.[1] ?? "en";
  return `<!doctype html><html lang="${esc(lang)}"><head>${head.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, "")}<title>${esc(a.title)}</title></head>
<body class="post-template-default single single-post singular">
<div id="page" class="site"><main id="main" class="site-main"><article class="post type-post status-publish hentry">
<div style="max-width:780px;margin:0 auto;padding:32px 16px">
<header class="entry-header"><h1 class="entry-title">${esc(a.title)}</h1></header>
${a.featured ? `<div class="post-thumbnail">${imgTag(a.featured)}</div>` : ""}
<div class="entry-content">${a.bodyHtml}</div></div></article></main></div></body></html>`;
}

/** A readable page with no site styles, for when there is no site to borrow from. Pure. */
export function plainDocument(a: PreviewArticle): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(a.title)}</title>
<style>body{max-width:720px;margin:0 auto;padding:32px 16px;font-family:Georgia,serif;line-height:1.7;color:#1d1d1f;background:#fff}img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}</style></head>
<body><article><h1>${esc(a.title)}</h1>${a.featured ? `<figure style="margin:0 0 1.5rem">${imgTag(a.featured)}</figure>` : ""}${a.bodyHtml}</article></body></html>`;
}

/** A bar at the top of the frame saying where the look came from. It sets its own styles so a theme can't restyle it. */
function withBar(html: string, note: string): string {
  const bar = `<div style="all:initial;display:block;box-sizing:border-box;width:100%;background:#1d1d1f;color:#fff;font:12px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;padding:6px 12px">${esc(note)}</div>`;
  return /<body\b[^>]*>/i.test(html) ? html.replace(/<body\b[^>]*>/i, (b) => b + bar) : bar + html;
}

/**
 * Build the preview. `templates` are site pages to try in order (the newest
 * live articles there, then the home page); the first that reads is used.
 */
export async function buildSitePreview(a: PreviewArticle, site: string | null, templates: string[]): Promise<SitePreview> {
  if (!site) {
    const note = "No site is connected, so this is a plain readable page — connect WordPress on the Website page to preview in your theme.";
    return { html: withBar(plainDocument(a), note), mode: "plain", from: null, note };
  }
  let lastError = "";
  for (const link of templates) {
    const got = await fetchSitePage(link, site);
    if ("error" in got) {
      lastError = got.error;
      continue;
    }
    const page = absoluteUrls(inertHtml(got.html), got.url);
    const filled = fillTemplate(page, a);
    if (filled) {
      const note = `In the theme of ${got.url}, with this article in place of that page's own. Scripts are off, so menus, sliders and anything a script draws won't work.${filled.placed.featured === "emptied" ? " This article has no approved featured image yet, so that slot is empty." : ""}`;
      return { html: withBar(filled.html, note), mode: "page", from: got.url, note };
    }
    const note = `With the stylesheets of ${got.url} — that page has no article layout to borrow, so the header, sidebar and widths may differ. Scripts are off.`;
    return { html: withBar(stylesDocument(page, a), note), mode: "styles", from: got.url, note };
  }
  const note = `The site couldn't be read (${lastError || "no page to try"}), so this is a plain readable page.`;
  return { html: withBar(plainDocument(a), note), mode: "plain", from: null, note };
}

export { PREVIEW_CSP } from "@/lib/csp";
