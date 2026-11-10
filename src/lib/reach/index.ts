import { ReachError, hostIs, reasonOf, type ReachItem, type ReachSource } from "@/lib/reach/core";
import { readGithub, readReddit, readYoutube, searchGithub, searchReddit, searchSocial, socialPlatformOf, videoIdOf } from "@/lib/reach/channels";
import { webRead, webSearch } from "@/lib/reach/web";

export { ReachError, reasonOf, quoteForPrompt, QUOTED_MATERIAL_RULE, reachHealth, CHANNEL_LABEL, type ReachItem, type ReachSource } from "@/lib/reach/core";
export { webSearch, webRead } from "@/lib/reach/web";
export { searchReddit, readReddit, searchGithub, readGithub, readYoutube, videoIdOf, searchSocial, socialPlatformOf, SOCIAL_PLATFORMS } from "@/lib/reach/channels";

/** A post read as a page carries the site's Markdown chrome — pictures, menu links. Keep the words. */
export function tidyPost(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\((?:[^()]|\([^)]*\))*\)/g, "") // pictures (avatars, icons)
    .replace(/\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, "$1") // a link → its words
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Which channel reads a link. */
export function linkKind(url: string): ReachSource {
  if (videoIdOf(url) && hostIs(url, "youtube.com", "youtu.be")) return "youtube";
  if (hostIs(url, "reddit.com", "redd.it")) return "reddit";
  if (hostIs(url, "github.com")) return "github";
  if (socialPlatformOf(url)) return "social";
  return "web";
}

/**
 * Read any public link with the channel made for it — Agent-Reach's `read
 * <url>`: a YouTube video's captions, a Reddit thread with its comments, a
 * GitHub repository's README or an issue with its comments, a public social
 * post as its text, any other page as clean text.
 */
export async function readLink(workspaceId: string | null | undefined, url: string, maxChars = 20_000): Promise<{ item: ReachItem; via: string }> {
  const kind = linkKind(url.trim());
  if (kind === "youtube") return readYoutube(workspaceId, url, { maxChars });
  if (kind === "reddit") return readReddit(workspaceId, url, maxChars);
  // A social post reads like a page (Jina, then Exa — Quora's bot check and Medium's blocks fall through to Exa),
  // read long and tidied, since the site's chrome (menus, avatars) comes back with it.
  if (kind === "social") {
    const r = await webRead(workspaceId, url, { maxChars: Math.min(maxChars * 2, 120_000), channel: "social", source: "social" });
    return { ...r, item: { ...r.item, text: tidyPost(r.item.text).slice(0, maxChars) } };
  }
  if (kind === "github") {
    // A repo, issue or PR goes through the API; a file or anything else is a page.
    try {
      return await readGithub(workspaceId, url, maxChars);
    } catch (e) {
      if (!(e instanceof ReachError && e.code === "BAD_INPUT")) throw e;
    }
  }
  return webRead(workspaceId, url, { maxChars });
}

// ── Listening: what people are saying about a subject ───────────────────────

export type Signal = { n: number; title: string; url: string; source: ReachSource; snippet: string; publishedAt: string | null };
export type Listening = { signals: Signal[]; notes: string[] };

/**
 * What people are discussing about a subject right now, from the channels
 * that answer without anyone's login: Reddit threads, public social posts
 * (Threads, Quora, Hacker News, Bluesky, LinkedIn, Medium, YouTube, Pinterest),
 * the web (articles and forums), and — when the subject is technical — GitHub
 * repositories. Each channel is asked once; one that fails is named in `notes`
 * and the others still count. Taken in turns across channels (a first from
 * each, then a second …), so a caller that keeps only the first few still
 * hears every channel. Numbered, so a prompt can cite them as [n].
 */
export async function listen(workspaceId: string | null | undefined, subject: string, opts: { perSource?: number; github?: boolean; social?: boolean; freshDays?: number } = {}): Promise<Listening> {
  const per = Math.max(1, Math.min(8, opts.perSource ?? 4));
  const tasks: Array<[string, Promise<{ items: ReachItem[] }>]> = [
    ["Reddit", searchReddit(workspaceId, subject, per)],
    ["the web", webSearch(workspaceId, subject, { limit: per, freshDays: opts.freshDays ?? 120 })],
  ];
  if (opts.social !== false) tasks.push(["Social posts", searchSocial(workspaceId, subject, per)]);
  if (opts.github) tasks.push(["GitHub", searchGithub(workspaceId, subject, Math.min(per, 4))]);
  const settled = await Promise.allSettled(tasks.map(([, p]) => p));
  const notes: string[] = [];
  const lists = settled.map((r, i) => {
    if (r.status === "fulfilled") return r.value.items;
    notes.push(`${tasks[i][0]}: ${reasonOf(r.reason)}`);
    return [];
  });
  const seen = new Set<string>();
  const signals: Signal[] = [];
  for (let round = 0; lists.some((l) => l[round]); round++) {
    for (const l of lists) {
      const it = l[round];
      if (!it?.url || seen.has(it.url)) continue;
      seen.add(it.url);
      const stars = typeof it.meta?.stars === "number" ? ` (${it.meta.stars.toLocaleString()} stars)` : "";
      signals.push({
        n: signals.length + 1,
        title: ((it.title ?? it.url) + stars).slice(0, 200),
        url: it.url,
        source: it.source,
        snippet: (it.text || String(it.meta?.description ?? "")).replace(/\s+/g, " ").trim().slice(0, 600),
        publishedAt: it.publishedAt ?? null,
      });
    }
  }
  return { signals, notes };
}

export const SOURCE_LABEL: Record<ReachSource, string> = { web: "Web", reddit: "Reddit", github: "GitHub", youtube: "YouTube", social: "Social" };

/** What to call where an item came from: the platform for a social post (Threads, LinkedIn …), else the channel. */
export function sourceLabel(source: string | null | undefined, url?: string | null): string {
  if (source === "social") return (url && socialPlatformOf(url)?.label) || "Social";
  return SOURCE_LABEL[source as ReachSource] ?? "Web";
}
