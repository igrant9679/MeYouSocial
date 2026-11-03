import { db } from "@/lib/db";
import { normalizeUrl } from "@/lib/link-inventory";

/**
 * A link-in-bio page (E-SOC-11): `/l/<slug>` lists the links in a workspace's
 * recently sent posts — newest first, one per destination — for the one link a
 * profile allows. Off until an admin turns it on under Settings → Schedule.
 *
 * Only what has already been published goes on it (a post that was sent), so
 * the page shows nothing the networks didn't. Every link is re-tagged
 * utm_source=linkinbio: the sent copy may carry the network's own tags, and a
 * click from the bio page credited to LinkedIn would be the wrong story.
 */

export const LIB_ENABLED = "linkinbio:enabled";
export const LIB_SLUG = "linkinbio:slug";
export const LIB_LIMIT = 12;
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

const URL_RE = /https?:\/\/[^\s<>"'()]+/gi;

/** The links in a post's text, trailing punctuation peeled off. */
export function extractLinks(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(URL_RE)) {
    let u = m[0];
    while (/[.,;:!?]$/.test(u)) u = u.slice(0, -1);
    try { out.push(new URL(u).toString()); } catch { /* not a URL */ }
  }
  return out;
}

/** The link as the bio page sends it: any utm_* removed, then its own tags. */
export function bioTag(url: string, campaign: string | null): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (k.toLowerCase().startsWith("utm_")) u.searchParams.delete(k);
    u.searchParams.set("utm_source", "linkinbio");
    u.searchParams.set("utm_medium", "social");
    u.searchParams.set("utm_campaign", campaign || "link_in_bio");
    return u.toString();
  } catch {
    return url;
  }
}

/** A post's words with its links taken out, cut to a title. */
export function titleFrom(text: string): string {
  const words = text.replace(URL_RE, " ").replace(/[#@]\w+/g, (m) => m.slice(1)).replace(/\s+/g, " ").trim();
  const first = words.split(/(?<=[.!?])\s/)[0] ?? words;
  return (first.length > 90 ? `${first.slice(0, 88).replace(/\s+\S*$/, "")}…` : first) || "Link";
}

export type BioLink = { href: string; title: string; host: string; at: Date };

/** The newest sent link per destination, with an article's own title where the link is one of ours. */
export async function bioLinks(workspaceId: string, limit = LIB_LIMIT): Promise<BioLink[]> {
  const [posts, articles] = await Promise.all([
    db.socialPost.findMany({
      where: { workspaceId, status: { in: ["posted", "partial"] }, publishedAt: { not: null } },
      orderBy: { publishedAt: "desc" },
      take: 200,
      select: { text: true, publishedAt: true, campaign: { select: { utmCampaign: true } } },
    }),
    db.blogPost.findMany({ where: { workspaceId, status: "published", publishedUrl: { not: null } }, select: { title: true, publishedUrl: true } }),
  ]);
  const titleFor = new Map(articles.map((a) => [normalizeUrl(a.publishedUrl!), a.title] as const).filter(([k]) => !!k) as Array<[string, string]>);
  const seen = new Set<string>();
  const out: BioLink[] = [];
  for (const p of posts) {
    const link = extractLinks(p.text)[0];
    if (!link) continue;
    const key = normalizeUrl(link);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ href: bioTag(link, p.campaign?.utmCampaign ?? null), title: titleFor.get(key) ?? titleFrom(p.text), host: new URL(link).hostname.replace(/^www\./, ""), at: p.publishedAt! });
    if (out.length >= limit) break;
  }
  return out;
}

/** The workspace a slug belongs to, when its page is on. */
export async function workspaceForSlug(slug: string): Promise<{ id: string; name: string } | null> {
  if (!SLUG_RE.test(slug)) return null;
  const row = await db.workspaceSetting.findFirst({ where: { key: LIB_SLUG, value: slug, workspace: { deletedAt: null } }, select: { workspaceId: true, workspace: { select: { name: true } } } });
  if (!row) return null;
  const on = await db.workspaceSetting.findUnique({ where: { workspaceId_key: { workspaceId: row.workspaceId, key: LIB_ENABLED } }, select: { value: true } });
  return on?.value === "true" ? { id: row.workspaceId, name: row.workspace.name } : null;
}
