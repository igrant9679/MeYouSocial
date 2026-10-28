import { db } from "@/lib/db";
import { googleApi } from "@/lib/google/service-account";
import { analyticsCredentialToken } from "@/lib/google/analytics-oauth";
import { getGa4Config } from "@/lib/analytics/ga4";

/**
 * Connect-time sanity checks (E-MEA-11): a Search Console site or a GA4
 * property that belongs to a different website verifies fine — Google only
 * checks access — and then quietly reports another site's traffic (CF's wrong
 * property). Compare what was connected with this workspace's own website.
 *
 * Warnings, never refusals: a site can legitimately move domains, and the
 * workspace's website is inferred, not declared.
 */

/** "https://www.Example.com/blog" or "sc-domain:example.com" → "example.com". */
export function bareHost(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;
  if (raw.startsWith("sc-domain:")) return raw.slice("sc-domain:".length).replace(/^www\./, "") || null;
  try {
    return new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** Same site, allowing a subdomain either way (blog.example.com ↔ example.com). */
export function sameSite(a: string, b: string): boolean {
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

export type SiteHost = { host: string; from: string };

/**
 * This workspace's website, best evidence first: the WordPress connection,
 * else the host most published articles live on, else the site-page inventory.
 */
export async function workspaceSiteHost(workspaceId: string): Promise<SiteHost | null> {
  const wp = await db.wordPressConnection.findUnique({ where: { workspaceId }, select: { baseUrl: true } }).catch(() => null);
  const wpHost = wp?.baseUrl ? bareHost(wp.baseUrl) : null;
  if (wpHost) return { host: wpHost, from: "its WordPress connection" };
  const commonest = (urls: Array<string | null>): string | null => {
    const n = new Map<string, number>();
    for (const u of urls) {
      const h = u ? bareHost(u) : null;
      if (h) n.set(h, (n.get(h) ?? 0) + 1);
    }
    return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const posts = await db.blogPost.findMany({ where: { workspaceId, publishedUrl: { not: null } }, select: { publishedUrl: true }, take: 200 });
  const fromPosts = commonest(posts.map((p) => p.publishedUrl));
  if (fromPosts) return { host: fromPosts, from: "its published articles" };
  const pages = await db.sitePage.findMany({ where: { workspaceId }, select: { url: true }, take: 200 });
  const fromPages = commonest(pages.map((p) => p.url));
  return fromPages ? { host: fromPages, from: "its site pages" } : null;
}

/** A sentence when the Search Console site isn't this workspace's website. */
export async function gscSiteWarning(workspaceId: string, siteUrl: string): Promise<string | null> {
  const connected = bareHost(siteUrl);
  const own = await workspaceSiteHost(workspaceId);
  if (!connected || !own || sameSite(connected, own.host)) return null;
  return `This workspace's website looks like ${own.host} (from ${own.from}), but the Search Console site is ${connected} — check it's the right property, or the numbers will be another site's.`;
}

/**
 * A sentence when none of the GA4 property's web streams is this workspace's
 * website. Reads the streams through the Analytics Admin API; when that isn't
 * readable (API off, no access) it says nothing rather than guessing.
 */
export async function ga4StreamWarning(workspaceId: string): Promise<string | null> {
  const [cfg, own] = await Promise.all([getGa4Config(workspaceId), workspaceSiteHost(workspaceId)]);
  if (!cfg || !own) return null;
  let hosts: string[];
  try {
    const token = await analyticsCredentialToken(workspaceId, cfg.cred, "https://www.googleapis.com/auth/analytics.readonly");
    const data = await googleApi<{ dataStreams?: Array<{ type?: string; webStreamData?: { defaultUri?: string } }> }>(
      `https://analyticsadmin.googleapis.com/v1beta/properties/${encodeURIComponent(cfg.propertyId)}/dataStreams`,
      token,
    );
    hosts = (data.dataStreams ?? [])
      .map((s) => s.webStreamData?.defaultUri)
      .filter((u): u is string => !!u)
      .map((u) => bareHost(u))
      .filter((h): h is string => !!h);
  } catch {
    return null;
  }
  if (!hosts.length || hosts.some((h) => sameSite(h, own.host))) return null;
  return `This workspace's website looks like ${own.host} (from ${own.from}), but GA4 property ${cfg.propertyId} measures ${[...new Set(hosts)].join(", ")} — check it's the right property, or the numbers will be another site's.`;
}
