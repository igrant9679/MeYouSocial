// "Add live link" (2026-11-23, the owner's "Yes, build it"): the rules for
// saving the web address of an article that is already published but has none
// in Publisher. Pure, so the action and a probe judge the same way.

/** A full http(s) address, normalised the way `new URL` writes it; null for anything else. */
export function parseLiveLink(raw: string): string | null {
  const s = raw.trim();
  if (!s || /\s/.test(s)) return null;
  try {
    const u = new URL(s);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || !u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** The site's home page (no path, no query): pasted by mistake far more often than meant for one article. */
export function isHomePage(url: string): boolean {
  try {
    const u = new URL(url);
    return u.pathname === "/" && !u.search;
  } catch {
    return false;
  }
}

/** Host without "www." plus the path analytics matches on (lib/analytics/sync `urlKey`'s rule): lower case, no query, no hash, no trailing slash. */
function pageKey(url: string): string | null {
  try {
    const u = new URL(url);
    let path = u.pathname.toLowerCase();
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${path}`;
  } catch {
    return null;
  }
}

/**
 * True when two addresses are the same page for Publisher: same site, same
 * path, whatever the scheme, "www.", trailing slash, query or hash. Analytics
 * attaches a page's numbers by its path, so two articles on one page would
 * share (and split) them.
 */
export function sameLivePage(a: string, b: string): boolean {
  const ka = pageKey(a);
  return ka != null && ka === pageKey(b);
}
