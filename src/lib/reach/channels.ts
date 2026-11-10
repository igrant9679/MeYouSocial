import { ReachError, firstThatWorks, freeServicesOn, getText, hostIs, keyFor, REACH_UA, type Backend, type ReachItem } from "@/lib/reach/core";
import { webRead, webSearch } from "@/lib/reach/web";

// ── Reddit ───────────────────────────────────────────────────────────────────
//
// Reddit refuses anonymous reads from servers — its public .json answers 403,
// and through Jina it serves a "you've been blocked" page. Agent-Reach answers
// that with a logged-in browser; a hosted app can't borrow anyone's session.
// So: FIND threads with a site-restricted search (Exa indexes Reddit), and
// READ a thread through Exa's fetch, which returns the post and its comments.

export async function searchReddit(workspaceId: string | null | undefined, query: string, limit = 5): Promise<{ items: ReachItem[]; via: string }> {
  const r = await webSearch(workspaceId, query, { limit, sites: ["reddit.com"], source: "reddit", freshDays: 365 }, "reddit");
  // Threads only — a subreddit's front page or a user page isn't a discussion.
  const threads = r.items.filter((i) => i.url && /\/comments\/[a-z0-9]+/i.test(i.url)).map((i) => ({ ...i, source: "reddit" as const }));
  if (!threads.length) throw new ReachError("NOT_FOUND", "no Reddit threads matched");
  return { items: threads, via: r.via };
}

export async function readReddit(workspaceId: string | null | undefined, url: string, maxChars = 12_000) {
  if (!hostIs(url, "reddit.com", "redd.it")) throw new ReachError("BAD_INPUT", "not a Reddit link");
  // Only Exa can read Reddit for a server: without its key and with free
  // sources off, say that rather than let our own fetch read a block page.
  const [exaKey, free] = await Promise.all([keyFor("exa", workspaceId), freeServicesOn(workspaceId)]);
  if (!exaKey && !free) throw new ReachError("OFF", "Reddit threads are read through Exa — add an Exa key or turn free public sources on (Settings → Keys → Live sources)");
  // Jina is skipped: Reddit blocks it and the block page would read as text.
  return webRead(workspaceId, url, { maxChars, skipJina: true, channel: "reddit", source: "reddit" });
}

// ── Public social posts ──────────────────────────────────────────────────────
//
// What people post in public on Threads, Quora, Hacker News, Bluesky, LinkedIn,
// Medium, YouTube and Pinterest: FOUND by site-restricted search, the way Reddit
// is, with no login and no platform API. Two searches, not one. Asked together,
// LinkedIn's product and company pages filled every slot (tested 2026-11-10), so
// the conversation sites are asked apart from the article and video sites. Only
// a post-shaped link counts: a profile, a product page or the platform's own
// help page isn't anyone's post.
// ⚠ X, Instagram, TikTok and Facebook are NOT here. Search finds almost none of
// their posts and their pages are login walls; reaching them needs their paid
// APIs or someone's own login, which a shared server must never borrow.

export type SocialPlatform = { label: string; sites: string[]; post: RegExp; group: "talk" | "posts" };

export const SOCIAL_PLATFORMS: SocialPlatform[] = [
  { label: "Threads", sites: ["threads.com", "threads.net"], post: /^\/@[^/]+\/post\/[\w-]+/, group: "talk" },
  { label: "Quora", sites: ["quora.com"], post: /^\/(?!profile\/|topic\/|search\b|about\b|resources\/)[^/?#]*-[^/?#]*/, group: "talk" },
  { label: "Hacker News", sites: ["news.ycombinator.com"], post: /^\/item\?id=\d+/, group: "talk" },
  { label: "Bluesky", sites: ["bsky.app"], post: /^\/profile\/[^/]+\/post\/\w+/, group: "talk" },
  { label: "LinkedIn", sites: ["linkedin.com"], post: /^\/(?:pulse|posts)\/[^/?#]+/, group: "posts" },
  { label: "Medium", sites: ["medium.com"], post: /-[0-9a-f]{8,12}(?:[/?#]|$)/, group: "posts" },
  { label: "YouTube", sites: ["youtube.com"], post: /^\/(?:watch\?(?:[^#]*&)?v=[\w-]{11}|shorts\/[\w-]{11})/, group: "posts" },
  { label: "Pinterest", sites: ["pinterest.com"], post: /^\/pin\/\d+/, group: "posts" },
];

/** The platform a link is a public post on, or null (a profile, a company page, another site). */
export function socialPlatformOf(url: string): SocialPlatform | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const p = SOCIAL_PLATFORMS.find((x) => hostIs(url, ...x.sites));
  return p && p.post.test(u.pathname + u.search) ? p : null;
}

export async function searchSocial(workspaceId: string | null | undefined, query: string, limit = 5, opts: { freshDays?: number } = {}): Promise<{ items: ReachItem[]; via: string }> {
  const [exaKey, free] = await Promise.all([keyFor("exa", workspaceId), freeServicesOn(workspaceId)]);
  if (!exaKey && !free) throw new ReachError("OFF", "social posts are found through Exa — add an Exa key or turn free public sources on (Settings → Keys → Live sources)");
  const groups = (["talk", "posts"] as const).map((g) => SOCIAL_PLATFORMS.filter((p) => p.group === g).flatMap((p) => p.sites));
  const settled = await Promise.allSettled(groups.map((sites) => webSearch(workspaceId, query, { limit: 10, sites, source: "social", freshDays: opts.freshDays ?? 365 }, "social")));
  const byPlatform = new Map<string, ReachItem[]>();
  const seen = new Set<string>();
  let via = "";
  for (const r of settled) {
    if (r.status === "rejected") continue;
    via ||= r.value.via;
    for (const it of r.value.items) {
      const p = it.url ? socialPlatformOf(it.url) : null;
      if (!p || seen.has(it.url!)) continue;
      seen.add(it.url!);
      byPlatform.set(p.label, [...(byPlatform.get(p.label) ?? []), { ...it, source: "social", meta: { ...it.meta, platform: p.label } }]);
    }
  }
  // One from each platform before a second from any, so one loud site can't fill the list.
  const lists = [...byPlatform.values()];
  const spread: ReachItem[] = [];
  for (let round = 0; lists.some((l) => l[round]); round++) for (const l of lists) if (l[round]) spread.push(l[round]);
  if (!spread.length) {
    const failed = settled.flatMap((r) => (r.status === "rejected" ? [r.reason] : []));
    // Both searches failed: say why (a limit or a block says more than "no results").
    if (failed.length === settled.length) throw failed.find((e) => e instanceof ReachError && e.code !== "NOT_FOUND") ?? failed[0];
    throw new ReachError("NOT_FOUND", "no public social posts matched");
  }
  return { items: spread.slice(0, limit), via };
}

// ── GitHub ───────────────────────────────────────────────────────────────────
//
// The public REST API: 60 requests an hour without a token, 5,000 with one (a
// fine-grained token with no scopes is enough for public data).

const GH = "https://api.github.com";
const TARGET_RE = /^(?:https?:\/\/(?:www\.)?github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:issues|pull)\/(\d+))?\/?(?:[?#].*)?$/;

async function ghGet<T>(path: string, token: string, accept = "application/vnd.github+json"): Promise<T> {
  const { status, text, headers } = await getText(`${GH}${path}`, {
    headers: { accept, "user-agent": REACH_UA, "x-github-api-version": "2022-11-28", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    timeoutMs: 20_000,
  });
  if (status === 404) throw new ReachError("NOT_FOUND", "GitHub has no such repository or issue");
  if (status === 429 || (status === 403 && (headers.get("x-ratelimit-remaining") === "0" || headers.get("retry-after")))) {
    throw new ReachError("RATE_LIMITED", token ? "GitHub's rate limit" : "GitHub's limit without a token (60 an hour) — add a GitHub token on Settings → Keys");
  }
  if (status === 401) throw new ReachError("UPSTREAM", "GitHub refused the token");
  if (status >= 400) throw new ReachError("UPSTREAM", `GitHub answered ${status}`);
  return (accept.endsWith("raw") ? text : JSON.parse(text)) as T;
}

type GhRepo = { full_name: string; html_url: string; description: string | null; stargazers_count: number; forks_count: number; language: string | null; topics?: string[]; pushed_at: string; created_at: string; owner?: { login: string }; archived?: boolean; license?: { spdx_id?: string } | null };

const repoItem = (r: GhRepo, readme?: string | null): ReachItem => ({
  title: r.full_name,
  url: r.html_url,
  author: r.owner?.login ?? null,
  publishedAt: r.created_at,
  text: (readme ?? r.description ?? "").trim(),
  source: "github",
  via: "github-api",
  meta: { stars: r.stargazers_count, forks: r.forks_count, language: r.language, topics: r.topics ?? [], pushedAt: r.pushed_at, archived: !!r.archived, license: r.license?.spdx_id ?? null, description: r.description },
});

export async function searchGithub(workspaceId: string | null | undefined, query: string, limit = 5): Promise<{ items: ReachItem[]; via: string }> {
  const q = query.trim().slice(0, 200);
  if (!q) throw new ReachError("BAD_INPUT", "nothing to search for");
  const token = await keyFor("github", workspaceId);
  const { value, via } = await firstThatWorks(workspaceId, "github", [{ via: "github-api", run: async () => {
    // GitHub's own relevance order — sorting by stars put a famous, unrelated repo first.
    const r = await ghGet<{ items: GhRepo[] }>(`/search/repositories?${new URLSearchParams({ q, per_page: String(Math.min(10, limit)) })}`, token);
    return r.items.slice(0, limit).map((x) => repoItem(x));
  } }]);
  return { items: value, via };
}

export async function readGithub(workspaceId: string | null | undefined, target: string, maxChars = 20_000): Promise<{ item: ReachItem; via: string }> {
  const m = target.trim().match(TARGET_RE);
  if (!m) throw new ReachError("BAD_INPUT", "not a GitHub repository, issue or pull request link");
  const [, owner, repo, num] = m;
  const token = await keyFor("github", workspaceId);
  const { value, via } = await firstThatWorks(workspaceId, "github", [{ via: "github-api", run: async () => {
    if (!num) {
      const info = await ghGet<GhRepo>(`/repos/${owner}/${repo}`, token);
      const readme = await ghGet<string>(`/repos/${owner}/${repo}/readme`, token, "application/vnd.github.raw").catch((e) => {
        if (e instanceof ReachError && e.code === "NOT_FOUND") return null;
        throw e;
      });
      return repoItem(info, readme ? readme.slice(0, maxChars) : null);
    }
    type Issue = { title: string; html_url: string; body: string | null; user?: { login: string }; created_at: string; state: string; comments: number; pull_request?: unknown; labels?: Array<{ name: string }> };
    const issue = await ghGet<Issue>(`/repos/${owner}/${repo}/issues/${num}`, token);
    const comments = await ghGet<Array<{ user?: { login: string }; body: string | null }>>(`/repos/${owner}/${repo}/issues/${num}/comments?per_page=50`, token);
    const text = [issue.body ?? "", ...comments.map((c) => `\n@${c.user?.login ?? ""}: ${c.body ?? ""}`)].join("\n").trim().slice(0, maxChars);
    return { title: issue.title, url: issue.html_url, author: issue.user?.login ?? null, publishedAt: issue.created_at, text, source: "github" as const, via: "github-api", meta: { state: issue.state, comments: issue.comments, pullRequest: !!issue.pull_request, labels: (issue.labels ?? []).map((l) => l.name) } };
  } }]);
  return { item: value, via };
}

// ── YouTube captions ─────────────────────────────────────────────────────────
//
// Agent-Reach reads subtitles with yt-dlp. Here: YouTube's own player API
// asked as the Android app, which lists the caption tracks with addresses that
// answer without a key or a sign-in — no binary to ship. ⚠ YouTube refuses
// some datacenter addresses ("confirm you're not a bot"); that comes back as
// BLOCKED, said plainly, never as an empty transcript.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function videoIdOf(input: string): string | null {
  const s = input.trim();
  if (VIDEO_ID.test(s)) return s;
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

type Track = { baseUrl: string; languageCode: string; kind?: string; name?: { simpleText?: string; runs?: Array<{ text: string }> } };
type Player = {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: { title?: string; author?: string; shortDescription?: string; lengthSeconds?: string; viewCount?: string };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: Track[] } };
};

/** Caption events (json3) to plain text, one line per caption, repeats collapsed. */
export function json3ToText(body: string): string {
  const data = JSON.parse(body) as { events?: Array<{ segs?: Array<{ utf8?: string }> }> };
  const out: string[] = [];
  for (const e of data.events ?? []) {
    const line = (e.segs ?? []).map((s) => s.utf8 ?? "").join("").replace(/\s+/g, " ").trim();
    if (line && out.at(-1) !== line) out.push(line);
  }
  return out.join("\n");
}

export async function readYoutube(workspaceId: string | null | undefined, target: string, opts: { langs?: string[]; maxChars?: number } = {}): Promise<{ item: ReachItem; via: string }> {
  const id = videoIdOf(target);
  if (!id) throw new ReachError("BAD_INPUT", "not a YouTube video link or id");
  const langs = opts.langs?.length ? opts.langs : ["en", "en-US", "en-GB"];
  const maxChars = opts.maxChars ?? 40_000;
  const backends: Backend<ReachItem>[] = [{ via: "innertube", run: async () => {
    const ua = "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip";
    const { status, text } = await getText("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": ua },
      body: JSON.stringify({ context: { client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 34, hl: "en" } }, videoId: id }),
      timeoutMs: 20_000,
    });
    if (status === 429) throw new ReachError("RATE_LIMITED", "YouTube is limiting requests from this server");
    if (status >= 400) throw new ReachError("UPSTREAM", `YouTube answered ${status}`);
    const p = JSON.parse(text) as Player;
    const play = p.playabilityStatus?.status;
    if (play === "LOGIN_REQUIRED" && /bot/i.test(p.playabilityStatus?.reason ?? "")) throw new ReachError("BLOCKED", "YouTube asked this server to confirm it isn't a bot");
    if (play === "ERROR") throw new ReachError("NOT_FOUND", p.playabilityStatus?.reason ?? "video unavailable");
    const tracks = p.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const d = p.videoDetails ?? {};
    const header = { title: d.title ?? null, url: `https://www.youtube.com/watch?v=${id}`, author: d.author ?? null, source: "youtube" as const, via: "innertube" };
    if (!tracks.length) {
      // No captions: the description is still the creator's own words — but say it's not a transcript.
      if (play && play !== "OK") throw new ReachError("BLOCKED", p.playabilityStatus?.reason ?? `YouTube answered ${play}`);
      throw new ReachError("NOT_FOUND", "this video has no captions");
    }
    // Hand-made captions in a wanted language first, then auto ones, then anything.
    const rank = (t: Track) => {
      const li = langs.findIndex((l) => t.languageCode === l || t.languageCode.startsWith(l.split("-")[0]));
      return (li < 0 ? 100 : li * 2) + (t.kind === "asr" ? 1 : 0);
    };
    const track = [...tracks].sort((a, b) => rank(a) - rank(b))[0];
    const cap = await getText(track.baseUrl.replace(/&fmt=[^&]*/, "") + "&fmt=json3", { headers: { "user-agent": ua }, timeoutMs: 20_000 });
    if (cap.status >= 400 || !cap.text.trim()) throw new ReachError(cap.status === 429 ? "RATE_LIMITED" : "BLOCKED", `the caption track answered ${cap.status}${cap.text.trim() ? "" : " with nothing"}`);
    const transcript = json3ToText(cap.text);
    if (!transcript) throw new ReachError("UPSTREAM", "the caption track was empty");
    return {
      ...header,
      text: transcript.slice(0, maxChars),
      meta: { lang: track.languageCode, auto: track.kind === "asr", description: (d.shortDescription ?? "").slice(0, 2000), seconds: Number(d.lengthSeconds) || null, views: Number(d.viewCount) || null, chars: transcript.length },
    };
  } }];
  const { value, via } = await firstThatWorks(workspaceId, "youtube", backends);
  return { item: value, via };
}
