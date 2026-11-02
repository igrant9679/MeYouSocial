import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";

/**
 * The internal-link inventory (E-ART-12): every page this workspace's site is
 * known to have — its published articles (always; nothing to import) and the
 * site pages recorded by hand or read from WordPress — and the links between
 * them. Articles' links come from their own bodies here; a WordPress page's
 * from the last crawl (`SitePage.linksTo`). Computed when read.
 *
 * From it: pages nobody links to (orphans), and deterministic suggestions both
 * ways — other articles that mention this one's focus keyword and could link
 * to it, and pages whose keyword this article mentions and could link to.
 */

/** One form for comparing addresses: https, no www, no query, hash or trailing slash, lowercase host. */
export function normalizeUrl(raw: string, base?: string): string | null {
  try {
    const u = new URL(raw.trim(), base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = decodeURI(u.pathname).replace(/\/+$/, "") || "";
    return `https://${host}${path}`;
  } catch {
    return null;
  }
}

/** Every <a href> in an HTML body, as written. */
export function hrefs(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)')/gi)].map((m) => (m[2] ?? m[3] ?? "").trim()).filter(Boolean);
}

const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&quot;/g, '"');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Where `phrase` first appears as whole words in the body's text — outside any
 * tag, and outside any existing link — as [start, end] offsets into `html`, or
 * null. Matches within one text run (a phrase split by inline markup isn't found).
 */
export function findFreePhrase(html: string, phrase: string): [number, number] | null {
  const p = phrase.trim();
  if (p.length < 3) return null;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRe(p).replace(/\s+/g, "\\s+")})(?=$|[^\\p{L}\\p{N}])`, "iu");
  let depth = 0; // inside <a>…</a>
  let skip = 0; // inside <script>/<style>
  const tag = /<\/?([a-zA-Z][\w-]*)\b[^>]*>/g;
  let last = 0;
  const scan = (from: number, to: number): [number, number] | null => {
    if (depth > 0 || skip > 0 || to <= from) return null;
    const m = re.exec(html.slice(from, to));
    if (!m) return null;
    const start = from + m.index + m[1].length;
    return [start, start + m[2].length];
  };
  for (let t = tag.exec(html); t; t = tag.exec(html)) {
    const hit = scan(last, t.index);
    if (hit) return hit;
    const name = t[1].toLowerCase();
    const closing = t[0].startsWith("</");
    if (name === "a") depth = Math.max(0, depth + (closing ? -1 : 1));
    if (name === "script" || name === "style") skip = Math.max(0, skip + (closing ? -1 : 1));
    last = t.index + t[0].length;
  }
  return scan(last, html.length);
}

/** Wrap the phrase's first free occurrence in a link; null when there's none. Keeps the text as written. */
export function linkPhrase(html: string, phrase: string, url: string): { body: string; text: string } | null {
  const at = findFreePhrase(html, phrase);
  if (!at) return null;
  const text = html.slice(at[0], at[1]);
  const safe = url.replace(/"/g, "%22");
  return { body: `${html.slice(0, at[0])}<a href="${safe}">${text}</a>${html.slice(at[1])}`, text };
}

export type InventoryNode = {
  url: string; // normalized
  href: string; // as recorded, for links
  title: string;
  kind: "article" | "wordpress" | "manual";
  articleId?: string;
  keyword?: string | null;
  /** Normalized internal targets; null when this page's links are unknown (a hand-added page never read). */
  linksTo: string[] | null;
  inbound: string[];
};

export type Inventory = {
  nodes: Map<string, InventoryNode>;
  links: number;
  orphans: InventoryNode[];
  lastCrawl: Date | null;
};

export type ArticleRow = { id: string; title: string; publishedUrl: string | null; focusKeyword: string | null; body: string | null; protectedFromRewrite: boolean };

/** The inventory and the published articles it was built from (the offers need their bodies). */
export async function loadInventory(workspaceId: string): Promise<{ inv: Inventory; articles: ArticleRow[] }> {
  const [articles, pages] = await Promise.all([
    db.blogPost.findMany({
      // Live pages: published, or a published article back in review for a refresh — still at its URL.
      where: { workspaceId, publishedUrl: { not: null }, OR: [{ status: "published" }, { refreshStartedAt: { not: null } }] },
      select: { id: true, title: true, publishedUrl: true, focusKeyword: true, body: true, protectedFromRewrite: true },
      orderBy: { publishedAt: "desc" },
      take: 500,
    }),
    db.sitePage.findMany({ where: { workspaceId }, select: { url: true, title: true, topic: true, source: true, linksTo: true, crawledAt: true }, take: 1000 }),
  ]);
  return { inv: buildInventory(articles, pages), articles };
}

export function buildInventory(
  articles: ArticleRow[],
  pages: Array<{ url: string; title: string; topic: string | null; source: string; linksTo: string | null; crawledAt: Date | null }>,
): Inventory {
  const nodes = new Map<string, InventoryNode>();
  for (const a of articles) {
    const url = a.publishedUrl ? normalizeUrl(a.publishedUrl) : null;
    if (!url) continue;
    nodes.set(url, { url, href: a.publishedUrl!, title: a.title, kind: "article", articleId: a.id, keyword: a.focusKeyword, linksTo: [], inbound: [] });
  }
  for (const p of pages) {
    const url = normalizeUrl(p.url);
    if (!url) continue;
    const crawled = p.source === "wordpress" && p.linksTo != null ? readJson<string[]>(p.linksTo, []) : null;
    const known = nodes.get(url);
    if (known) {
      // An article's own body is the truth for its links; a crawl adds what the live page has beyond it.
      if (crawled) known.linksTo = [...new Set([...(known.linksTo ?? []), ...crawled])];
      continue;
    }
    nodes.set(url, { url, href: p.url, title: p.title, kind: p.source === "wordpress" ? "wordpress" : "manual", keyword: p.topic, linksTo: crawled, inbound: [] });
  }
  for (const a of articles) {
    const self = a.publishedUrl ? normalizeUrl(a.publishedUrl) : null;
    const node = self ? nodes.get(self) : undefined;
    if (!node || !a.body) continue;
    for (const h of hrefs(a.body)) {
      const t = normalizeUrl(h, a.publishedUrl!);
      if (t && t !== self && nodes.has(t)) node.linksTo = [...new Set([...(node.linksTo ?? []), t])];
    }
  }
  let links = 0;
  for (const n of nodes.values()) {
    for (const t of n.linksTo ?? []) {
      const target = nodes.get(t);
      if (!target || t === n.url) continue;
      target.inbound.push(n.url);
      links++;
    }
  }
  const orphans = [...nodes.values()].filter((n) => n.inbound.length === 0).sort((a, b) => (a.kind === "article" ? 0 : 1) - (b.kind === "article" ? 0 : 1) || a.title.localeCompare(b.title));
  const lastCrawl = pages.reduce<Date | null>((m, p) => (p.crawledAt && (!m || p.crawledAt > m) ? p.crawledAt : m), null);
  return { nodes, links, orphans, lastCrawl };
}

export type LinkOffer = { articleId: string; title: string; url: string; phrase: string };

/**
 * Other published articles that mention this one's focus keyword, in free text,
 * and don't link to it yet — each could carry a link here.
 */
export function inboundOffers(inv: Inventory, articles: ArticleRow[], targetId: string, max = 8): LinkOffer[] {
  const target = articles.find((a) => a.id === targetId);
  const url = target?.publishedUrl ? normalizeUrl(target.publishedUrl) : null;
  const kw = target?.focusKeyword?.trim();
  if (!target || !url || !kw) return [];
  const out: LinkOffer[] = [];
  for (const a of articles) {
    if (a.id === targetId || !a.body || a.protectedFromRewrite) continue;
    const from = a.publishedUrl ? normalizeUrl(a.publishedUrl) : null;
    if (from && inv.nodes.get(from)?.linksTo?.includes(url)) continue;
    const at = findFreePhrase(a.body, kw);
    if (!at) continue;
    out.push({ articleId: a.id, title: a.title, url: target.publishedUrl!, phrase: decode(a.body.slice(at[0], at[1])) });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Pages whose keyword this article mentions in free text and doesn't link to
 * yet — articles by their focus keyword, other pages by their recorded topic.
 */
export function outboundOffers(inv: Inventory, body: string | null, selfUrl: string | null, max = 8): Array<{ title: string; href: string; phrase: string; articleId?: string }> {
  if (!body) return [];
  const self = selfUrl ? normalizeUrl(selfUrl) : null;
  const linked = new Set(hrefs(body).map((h) => normalizeUrl(h, selfUrl ?? undefined)).filter((x): x is string => !!x));
  const out: Array<{ title: string; href: string; phrase: string; articleId?: string }> = [];
  const seen = new Set<string>();
  for (const n of inv.nodes.values()) {
    const kw = n.keyword?.trim();
    if (!kw || n.url === self || linked.has(n.url) || seen.has(kw.toLowerCase())) continue;
    const at = findFreePhrase(body, kw);
    if (!at) continue;
    seen.add(kw.toLowerCase());
    out.push({ title: n.title, href: n.href, phrase: decode(body.slice(at[0], at[1])), articleId: n.articleId });
    if (out.length >= max) break;
  }
  return out;
}
