import { db } from "@/lib/db";
import { safeFetch } from "@/lib/net/safe-fetch";
import { storage } from "@/lib/storage";

/**
 * A feed item's picture for its draft post (E-SOC-20): the feed's own image
 * (media:content, media:thumbnail, an image enclosure, or the first <img> in
 * the item), else the linked page's og:image / twitter:image. The bytes are
 * fetched through safeFetch — the same private-network guard as the feed —
 * kept only if they are a PNG, JPEG, GIF or WebP under 8 MB, stored with the
 * workspace as owner, and added to the media library. Any failure means "no
 * picture", never a failed item: the draft goes out as text.
 */

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const IMAGE_BYTES = 8 * 1024 * 1024;
const PAGE_BYTES = 1_000_000;
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

const attr = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag)?.[1] ?? null;
const unescape = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** The picture an RSS <item> or Atom <entry> carries itself, if any. */
export function feedItemImage(block: string): string | null {
  for (const m of block.matchAll(/<media:(?:content|thumbnail)\b[^>]*>/gi)) {
    const url = attr(m[0], "url");
    const medium = attr(m[0], "medium");
    const type = attr(m[0], "type");
    if (url && (m[0].toLowerCase().startsWith("<media:thumbnail") || medium === "image" || type?.startsWith("image/") || (!medium && !type))) return unescape(url);
  }
  for (const m of block.matchAll(/<(?:enclosure|link)\b[^>]*>/gi)) {
    const type = attr(m[0], "type");
    const url = attr(m[0], "url") ?? (attr(m[0], "rel") === "enclosure" ? attr(m[0], "href") : null);
    if (url && type?.startsWith("image/")) return unescape(url);
  }
  // An <img> in the summary or full content, entity-encoded or in CDATA.
  const html = block.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  const img = /<img\b[^>]*>/i.exec(html);
  const src = img ? attr(img[0], "src") : null;
  return src ? unescape(src) : null;
}

/** og:image (or twitter:image) from a page's head, resolved against the page. */
export function pageImage(html: string, pageUrl: string): string | null {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(m[0], "property") ?? attr(m[0], "name") ?? "").toLowerCase();
    if (key !== "og:image" && key !== "og:image:secure_url" && key !== "twitter:image") continue;
    const content = attr(m[0], "content");
    if (!content) continue;
    try { return new URL(unescape(content), pageUrl).toString(); } catch { /* not a URL */ }
  }
  return null;
}

async function fetchPageImage(link: string, signal: AbortSignal): Promise<string | null> {
  const res = await safeFetch(link, { signal, headers: { "user-agent": "Mozilla/5.0 (compatible; MeYouSocial Publisher feed reader)", accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5" } });
  if (!res.ok || !/html/i.test(res.headers.get("content-type") ?? "")) { await res.body?.cancel().catch(() => {}); return null; }
  const html = (await res.text()).slice(0, PAGE_BYTES);
  return pageImage(html.split(/<\/head>/i)[0], res.url || link);
}

/**
 * Find, fetch and store the picture for one item. Returns the storage key, or
 * null with nothing stored. `deadline` caps the whole poll's image work.
 */
export async function storeItemImage(item: { title: string; link: string | null; image: string | null }, workspaceId: string, deadline: number): Promise<string | null> {
  const left = deadline - Date.now();
  if (left < 2_000) return null;
  const signal = AbortSignal.timeout(Math.min(left, 12_000));
  try {
    let url = item.image;
    if (url && item.link) url = new URL(url, item.link).toString();
    if (!url && item.link) url = await fetchPageImage(item.link, signal);
    if (!url) return null;
    const res = await safeFetch(url, { signal, headers: { accept: "image/png,image/jpeg,image/gif,image/webp;q=0.9" } });
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (!res.ok || !IMAGE_TYPES.has(type) || declared > IMAGE_BYTES) { await res.body?.cancel().catch(() => {}); return null; }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > IMAGE_BYTES) return null;
    const base = item.title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60).toLowerCase() || "feed-image";
    const name = `${base}.${EXT[type]}`;
    const stored = await storage.put(name, bytes, type, workspaceId);
    await db.mediaItem.create({ data: { workspaceId, key: stored.key, name, description: `From the feed item “${item.title.slice(0, 200)}”`, contentType: type } }).catch(() => undefined);
    return stored.key;
  } catch {
    return null;
  }
}
