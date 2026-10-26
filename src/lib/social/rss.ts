import { db } from "@/lib/db";
import { safeFetch } from "@/lib/net/safe-fetch";
import { writeAudit } from "@/lib/governance";
import { cleanTitle } from "@/lib/list-marker";

/**
 * RSS feeds (Socialmonials parity, phase 4, 2026-10-17). A workspace follows a
 * feed; each NEW item becomes either
 *   - a social IDEA on the board (mode "ideas", the default): source "rss",
 *     its link kept, and it WAITS for a person — the social gate only
 *     auto-approves the engine's own ideas, never a feed's; or
 *   - a DRAFT post, title + link (mode "drafts"). ⚠ Under full autonomy the
 *     sweep queues unscheduled drafts on its own, so on LSI/CF this mode is
 *     "posts itself" — the page says so in those words.
 *
 * Polled from the autopilot cycle at most hourly per feed. The FIRST read
 * takes only items from the last 7 days, at most 5, and marks the rest seen —
 * subscribing to a busy feed must not flood the board with its archive.
 *
 * ⚠ The server fetches a URL a person typed, so it stays off the private
 * network: http(s) only, no localhost / private / link-local names, and the
 * name's DNS answer is checked too (a public name pointing at 10.x is refused),
 * on every redirect hop — lib/net/safe-fetch.ts.
 */

// The guard itself is shared (lib/net/safe-fetch.ts); re-exported for the RSS actions.
export { assertPublicUrl } from "@/lib/net/safe-fetch";

export type FeedItem = { guid: string; link: string | null; title: string; summary: string | null; publishedAt: Date | null };
export type ParsedFeed = { title: string | null; items: FeedItem[] };

const decode = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
const stripTags = (s: string) => decode(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tag = (block: string, name: string) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return m ? m[1] : null;
};

/** RSS 2.0 <item> and Atom <entry>, enough for title, link, id, date, summary. */
export function parseFeed(xml: string): ParsedFeed {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const channelTitle = tag(isAtom ? xml : (tag(xml, "channel") ?? xml), "title");
  const blocks = xml.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  const items: FeedItem[] = [];
  for (const b of blocks.slice(0, 50)) {
    const title = stripTags(tag(b, "title") ?? "");
    if (!title) continue;
    let link: string | null = null;
    if (isAtom) {
      const alt = /<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i.exec(b) ?? /<link[^>]*href=["']([^"']+)["']/i.exec(b);
      link = alt ? decode(alt[1]) : null;
    } else {
      link = stripTags(tag(b, "link") ?? "") || null;
    }
    const guid = stripTags(tag(b, isAtom ? "id" : "guid") ?? "") || link || title;
    const dateRaw = stripTags(tag(b, isAtom ? "updated" : "pubDate") ?? tag(b, "published") ?? tag(b, "dc:date") ?? "");
    const d = dateRaw ? new Date(dateRaw) : null;
    const summary = stripTags(tag(b, isAtom ? "summary" : "description") ?? tag(b, "content") ?? "") || null;
    items.push({ guid: guid.slice(0, 500), link: link?.slice(0, 1000) ?? null, title: title.slice(0, 300), summary: summary?.slice(0, 600) ?? null, publishedAt: d && !Number.isNaN(d.getTime()) ? d : null });
  }
  return { title: channelTitle ? stripTags(channelTitle).slice(0, 200) : null, items };
}

export async function fetchFeed(url: string): Promise<ParsedFeed> {
  const res = await safeFetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: { "user-agent": "Mozilla/5.0 (compatible; MeYouSocial Publisher feed reader)", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5" },
  });
  if (!res.ok) throw new Error(`The feed answered ${res.status}.`);
  const text = (await res.text()).slice(0, 3_000_000);
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(text)) throw new Error("That address isn't an RSS or Atom feed.");
  return parseFeed(text);
}

const FIRST_READ_DAYS = 7;
const FIRST_READ_MAX = 5;
const PER_POLL_MAX = 10;

/** Read one feed and act on what's new. Returns how many items became something. */
export async function pollFeed(feedId: string): Promise<{ made: number; seen: number; error: string | null }> {
  const feed = await db.rssFeed.findUnique({ where: { id: feedId }, include: { _count: { select: { items: true } } } });
  if (!feed || !feed.active) return { made: 0, seen: 0, error: null };
  let parsed: ParsedFeed;
  try {
    parsed = await fetchFeed(feed.url);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.rssFeed.update({ where: { id: feed.id }, data: { lastCheckedAt: new Date(), lastError: error.slice(0, 300) } });
    return { made: 0, seen: 0, error };
  }
  const known = new Set((await db.rssItem.findMany({ where: { feedId: feed.id, guid: { in: parsed.items.map((i) => i.guid) } }, select: { guid: true } })).map((r) => r.guid));
  const fresh = parsed.items.filter((i) => !known.has(i.guid));
  const firstRead = feed._count.items === 0;
  const cutoff = Date.now() - FIRST_READ_DAYS * 86_400_000;
  const actOn = (firstRead
    ? fresh.filter((i) => !i.publishedAt || i.publishedAt.getTime() >= cutoff).slice(0, FIRST_READ_MAX)
    : fresh.slice(0, PER_POLL_MAX));
  const actIds = new Set(actOn.map((i) => i.guid));

  let made = 0;
  for (const it of fresh) {
    let socialIdeaId: string | null = null;
    let postId: string | null = null;
    if (actIds.has(it.guid)) {
      if (feed.mode === "drafts") {
        const post = await db.socialPost.create({
          data: {
            workspaceId: feed.workspaceId,
            createdById: null,
            source: "rss",
            topicId: feed.topicId,
            category: feed.category,
            text: [it.title, it.link].filter(Boolean).join("\n\n"),
            mediaKeys: "[]",
            status: "draft",
          },
        });
        postId = post.id;
      } else {
        const idea = await db.socialIdea.create({
          data: {
            workspaceId: feed.workspaceId,
            topicId: feed.topicId,
            hook: cleanTitle(it.title, 240),
            angle: it.summary ? it.summary.slice(0, 300) : null,
            source: "rss",
            sourceUrl: it.link,
            status: "discovered",
          },
        });
        socialIdeaId = idea.id;
      }
      made++;
    }
    await db.rssItem.create({
      data: { feedId: feed.id, guid: it.guid, link: it.link, title: it.title, summary: it.summary, publishedAt: it.publishedAt, socialIdeaId, postId },
    }).catch(() => undefined); // a concurrent poll already recorded it
  }
  await db.rssFeed.update({ where: { id: feed.id }, data: { lastCheckedAt: new Date(), lastError: null, ...(parsed.title && !feed.title ? { title: parsed.title } : {}) } });
  if (made) await writeAudit({ workspaceId: feed.workspaceId, action: "social.rss_items", entityType: "rss_feed", entityId: feed.id, meta: { made, mode: feed.mode, firstRead } });
  return { made, seen: fresh.length, error: null };
}

/** The sweep's step: every active feed not read in the last hour. */
export async function pollDueFeeds(workspaceId: string): Promise<number> {
  const due = await db.rssFeed.findMany({
    where: { workspaceId, active: true, OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(Date.now() - 60 * 60_000) } }] },
    select: { id: true },
    take: 5,
  });
  let made = 0;
  for (const f of due) made += (await pollFeed(f.id)).made;
  return made;
}
