/**
 * What the live article page actually tells Facebook, LinkedIn and X (E-ART-05).
 *
 * Publishing uploads the OG image to the WordPress media library and maps it to
 * the SEO plugin's og:image field (ART-06), and the read-back says the field
 * was STORED — but stored is not shown: a theme without wp_head, a page cache
 * serving the old copy, or a second SEO plugin can all leave the page's <head>
 * with a different image or none. So after a publish the page itself is read
 * and its social tags are checked against what we sent.
 *
 * ⚠ Only a page on the connected site's own host is fetched — the same trust
 * the WordPress connection already has (the REST calls go to that host), and
 * every redirect hop must stay on it too. Nothing else is ever requested.
 */

export type SocialHead = {
  ogImage: string | null;
  ogUrl: string | null;
  ogTitle: string | null;
  twitterCard: string | null;
  twitterImage: string | null;
  canonical: string | null;
};

export type HeadCheck = { tag: string; state: "ok" | "warn" | "missing"; note: string };

export type LiveHead = {
  at: string;
  url: string;
  error?: string;
  head?: SocialHead;
  checks?: HeadCheck[];
};

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

/** The social tags in a page's <head> (or the whole page, when it has no closing head). */
export function parseSocialHead(html: string): SocialHead {
  const end = html.search(/<\/head>/i);
  const head = end >= 0 ? html.slice(0, end) : html.slice(0, 200_000);
  const metas = new Map<string, string>();
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = (tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1] ?? "").toLowerCase();
    const content = tag.match(/\bcontent\s*=\s*"([^"]*)"/i)?.[1] ?? tag.match(/\bcontent\s*=\s*'([^']*)'/i)?.[1];
    // The first one wins — that is the one the networks read.
    if (key && content !== undefined && !metas.has(key)) metas.set(key, decode(content));
  }
  let canonical: string | null = null;
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    if (/\brel\s*=\s*["']canonical["']/i.test(m[0])) {
      canonical = decode(m[0].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] ?? "") || null;
      break;
    }
  }
  const get = (k: string) => metas.get(k) || null;
  return {
    ogImage: get("og:image") ?? get("og:image:url") ?? get("og:image:secure_url"),
    ogUrl: get("og:url"),
    ogTitle: get("og:title"),
    twitterCard: get("twitter:card"),
    twitterImage: get("twitter:image") ?? get("twitter:image:src"),
    canonical,
  };
}

/** The file an image URL names, without WordPress's "-1200x630" size suffix. */
export function imageStem(url: string | null | undefined): string {
  if (!url) return "";
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.split(/[?#]/)[0];
  }
  const file = decodeURIComponent(path.split("/").pop() ?? "").toLowerCase();
  return file.replace(/\.[a-z0-9]+$/, "").replace(/-\d+x\d+$/, "").replace(/-scaled$/, "");
}

const sameUrl = (a: string | null, b: string | null) => {
  const n = (u: string | null) => (u ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
  return !!a && !!b && n(a) === n(b);
};

/**
 * Judge the page against what was sent. `ogImageUrl` is the public image the
 * publish put in the media library (null when the article had none — then the
 * plugin's own choice, usually the featured image, is fine).
 */
export function judgeSocialHead(head: SocialHead, expected: { ogImageUrl: string | null; permalink: string }): HeadCheck[] {
  const out: HeadCheck[] = [];
  if (!head.ogImage) {
    out.push({ tag: "og:image", state: "missing", note: "The page has no og:image — shares show a text-only card, or whatever picture the network guesses. The site's SEO plugin (or theme) isn't printing it." });
  } else if (expected.ogImageUrl && imageStem(head.ogImage) !== imageStem(expected.ogImageUrl)) {
    out.push({ tag: "og:image", state: "warn", note: `The page shows a different image (${head.ogImage}) from the OG image this publish uploaded — another plugin may be overriding it, or a page cache is serving an older copy.` });
  } else {
    out.push({ tag: "og:image", state: "ok", note: expected.ogImageUrl ? "The OG image this publish uploaded." : "The site's own choice (no OG image was sent, so it uses the featured image)." });
  }
  if (!head.ogUrl) out.push({ tag: "og:url", state: "missing", note: "No og:url — networks fall back to the address that was shared, so the same article can count as several links." });
  else if (!sameUrl(head.ogUrl, expected.permalink) && !sameUrl(head.ogUrl, head.canonical)) out.push({ tag: "og:url", state: "warn", note: `og:url points elsewhere (${head.ogUrl}).` });
  else out.push({ tag: "og:url", state: "ok", note: "Points at the article." });
  if (!head.twitterCard) out.push({ tag: "twitter:card", state: "missing", note: "No twitter:card — X shows a bare link. Yoast and Rank Math print one when their X/Twitter card setting is on." });
  else if (head.twitterCard !== "summary_large_image") out.push({ tag: "twitter:card", state: "warn", note: `"${head.twitterCard}" — a small square card. "summary_large_image" shows the picture full width.` });
  else out.push({ tag: "twitter:card", state: "ok", note: "Large image card." });
  return out;
}

const sameHost = (a: URL, b: URL) => a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, "");

/**
 * Read the live page and judge its social tags. Never throws: a page that
 * can't be read comes back with `error` and no checks.
 */
export async function checkLiveHead(link: string, siteBaseUrl: string, ogImageUrl: string | null): Promise<LiveHead> {
  const at = new Date().toISOString();
  let url: URL;
  let site: URL;
  try {
    url = new URL(link);
    site = new URL(siteBaseUrl);
  } catch {
    return { at, url: link, error: "The article's address isn't a valid URL." };
  }
  if (!/^https?:$/.test(url.protocol) || !sameHost(url, site)) {
    return { at, url: link, error: `The article isn't on the connected site (${site.hostname}), so it isn't read.` };
  }
  try {
    let res: Response | null = null;
    for (let hop = 0; hop < 4; hop++) {
      res = await fetch(url, { redirect: "manual", headers: { "user-agent": "facebookexternalhit/1.1 (MeYouSocial live check)", accept: "text/html" }, signal: AbortSignal.timeout(15_000) });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!loc) break;
      await res.body?.cancel().catch(() => {});
      const next = new URL(loc, url);
      if (!sameHost(next, site)) return { at, url: link, error: `The page redirects off the site (${next.hostname}), so it isn't followed.` };
      url = next;
      res = null;
    }
    if (!res) return { at, url: link, error: "Too many redirects." };
    if (!res.ok) return { at, url: link, error: `The page answered ${res.status}.` };
    const html = (await res.text()).slice(0, 1_000_000);
    const head = parseSocialHead(html);
    return { at, url: url.toString(), head, checks: judgeSocialHead(head, { ogImageUrl, permalink: link }) };
  } catch (e) {
    return { at, url: link, error: e instanceof Error && e.name === "TimeoutError" ? "The page took longer than 15 seconds." : `Couldn't read the page: ${e instanceof Error ? e.message : String(e)}` };
  }
}
