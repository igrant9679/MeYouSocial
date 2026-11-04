import { db } from "@/lib/db";

/**
 * Retiring or merging a live article (E-IDE-04) leaves work outside the app:
 * a 301 from the old address, internal links that still point at it, and the
 * old post itself. This module finds that work so a checklist can show it —
 * and does the part the app can do: repointing links in the workspace's OWN
 * articles (each change snapshotted first, so it can be undone from Versions).
 *
 * ⚠ Nothing here touches a site by itself. A 301 lives on the host or in a
 *   WordPress redirect plugin; the checklist hands over the exact lines.
 */

/** The forms one address takes inside an article body: as written, without the trailing slash, and as a site path. Pure. */
export function addressForms(url: string): string[] {
  const out = new Set<string>();
  const clean = url.trim();
  if (!clean) return [];
  out.add(clean);
  out.add(clean.replace(/\/+$/, ""));
  out.add(clean.endsWith("/") ? clean : `${clean}/`);
  try {
    const u = new URL(clean);
    const path = u.pathname || "/";
    if (path !== "/") {
      out.add(path);
      out.add(path.replace(/\/+$/, ""));
      out.add(path.endsWith("/") ? path : `${path}/`);
    }
    out.add(`${u.protocol}//${u.hostname.replace(/^www\./, "")}${path}`);
    out.add(`${u.protocol}//www.${u.hostname.replace(/^www\./, "")}${path}`);
  } catch {
    // not a URL — only the literal form
  }
  return [...out].filter(Boolean);
}

/** How many links in `html` point at any form of `url`. Pure. */
export function countLinksTo(html: string, url: string): number {
  const forms = new Set(addressForms(url).map((f) => f.toLowerCase()));
  let n = 0;
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])([^"']+)\1/gi)) {
    const href = m[2].split("#")[0].split("?")[0].toLowerCase();
    if (forms.has(href)) n++;
  }
  return n;
}

/** The same body with every link to `from` pointing at `to` instead (query and fragment dropped with the old address). Pure. */
export function repointBody(html: string, from: string, to: string): { html: string; changed: number } {
  const forms = new Set(addressForms(from).map((f) => f.toLowerCase()));
  let changed = 0;
  const out = html.replace(/(<a\b[^>]*\bhref\s*=\s*)(["'])([^"']+)\2/gi, (m, pre: string, q: string, href: string) => {
    const bare = href.split("#")[0].split("?")[0].toLowerCase();
    if (!forms.has(bare)) return m;
    changed++;
    return `${pre}${q}${to}${q}`;
  });
  return { html: out, changed };
}

export type LinkingArticle = { id: string; title: string; status: string; links: number; live: boolean };

/** The workspace's articles (other than this one) whose bodies link to `url`. */
export async function articlesLinkingTo(workspaceId: string, url: string, exceptId: string): Promise<LinkingArticle[]> {
  const forms = addressForms(url);
  if (!forms.length) return [];
  const candidates = await db.blogPost.findMany({
    where: { workspaceId, id: { not: exceptId }, OR: forms.map((f) => ({ body: { contains: f } })) },
    select: { id: true, title: true, status: true, body: true, wpPostId: true },
    take: 200,
  });
  return candidates
    .map((p) => ({ id: p.id, title: p.title, status: p.status, links: countLinksTo(p.body ?? "", url), live: p.status === "published" && p.wpPostId != null }))
    .filter((p) => p.links > 0);
}

/** The redirect rule in the forms people paste. Pure. */
export function redirectLines(from: string, to: string): { htaccess: string; nginx: string; csv: string } {
  let path = from;
  try {
    path = new URL(from).pathname;
  } catch {
    // already a path
  }
  return {
    htaccess: `Redirect 301 ${path} ${to}`,
    nginx: `location = ${path} { return 301 ${to}; }`,
    csv: `"${path}","${to}",301`,
  };
}
