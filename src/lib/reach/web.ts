import { ReachError, firstThatWorks, freeServicesOn, getText, hostIs, keyFor, publicLink, type Backend, type ReachItem, REACH_UA } from "@/lib/reach/core";

/**
 * Web — read any page as clean text, and search the web (Agent-Reach's `web`
 * channel). Reading: Jina Reader → Exa → our own fetch. Search: Exa's API with a
 * workspace key, else Exa's free hosted endpoint. The search here is the free
 * fallback — lib/search still prefers a workspace's Tavily or Serper key.
 */

const EXA_MCP = "https://mcp.exa.ai/mcp";
const EXA_API = "https://api.exa.ai";

// ── Jina Reader ──────────────────────────────────────────────────────────────

/**
 * Jina answers 200 even when the TARGET refused it: the body then says
 * "Warning: Target URL returned error 403" over the site's block page (Reddit
 * does this). And a Cloudflare challenge comes back as a page of its own.
 * Neither is the page's text.
 */
function jinaRefusal(body: string): ReachError | null {
  const head = body.slice(0, 4096);
  const target = head.match(/^Warning: Target URL returned error (\d{3})/m);
  if (target) {
    const code = Number(target[1]);
    return new ReachError(code === 404 || code === 410 ? "NOT_FOUND" : code === 429 ? "RATE_LIMITED" : "BLOCKED", `the page answered ${code}`);
  }
  const lower = head.toLowerCase();
  const challenge = ["title: just a moment...", "## performing security verification", "title: attention required! | cloudflare"].some((m) => lower.includes(m));
  if (challenge || (lower.includes("warning:") && lower.includes("requiring captcha"))) {
    return new ReachError("BLOCKED", "a bot-check page came back instead of the content");
  }
  return null;
}

export function parseJina(url: string, body: string): ReachItem {
  const title = body.match(/^Title:\s*(.*)$/m)?.[1]?.trim() || null;
  const published = body.match(/^Published Time:\s*(.*)$/m)?.[1]?.trim() || null;
  const content = (body.includes("Markdown Content:") ? body.split("Markdown Content:").slice(1).join("Markdown Content:") : body).trim();
  return { title, url, publishedAt: published, text: content, source: "web", via: "jina" };
}

async function jinaRead(url: string, key: string): Promise<ReachItem> {
  const { status, text } = await getText(`https://r.jina.ai/${url}`, {
    headers: { accept: "text/plain", "user-agent": REACH_UA, ...(key ? { authorization: `Bearer ${key}` } : {}) },
    timeoutMs: 35_000,
  });
  if (status === 429) throw new ReachError("RATE_LIMITED", "Jina Reader's free limit (add a Jina key on Settings → Keys)");
  if (status === 401 || status === 403) throw new ReachError("UPSTREAM", key ? "Jina refused the key" : `Jina answered ${status}`);
  if (status >= 400) throw new ReachError(status === 404 ? "NOT_FOUND" : "UPSTREAM", `Jina answered ${status}`);
  const refusal = jinaRefusal(text);
  if (refusal) throw refusal;
  const item = parseJina(url, text);
  if (item.text.length < 40) throw new ReachError("UPSTREAM", "Jina returned no readable text");
  return item;
}

// ── Exa ──────────────────────────────────────────────────────────────────────

const LIMIT_RE = /\b429\b|rate[ _-]?limit|too many requests|\bquota\b|(?:usage|request|daily|monthly|free)[ _-]+limit|(?:out of|insufficient|exhausted).{0,20}credits?/i;

/** One tool call on Exa's free hosted MCP endpoint (no key). */
async function exaHosted(tool: "web_search_exa" | "web_fetch_exa", args: Record<string, unknown>, timeoutMs = 40_000): Promise<string> {
  const { status, text } = await getText(EXA_MCP, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "user-agent": REACH_UA },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }),
    timeoutMs,
  });
  if (status === 429) throw new ReachError("RATE_LIMITED", "Exa's free hosted limit (add an Exa key on Settings → Keys)");
  if (status >= 400) throw new ReachError("UPSTREAM", `Exa answered ${status}`);
  const payloads = text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
  let msg: { error?: { message?: string; code?: number | string }; result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean } };
  try {
    msg = JSON.parse(payloads.at(-1) ?? text);
  } catch {
    throw new ReachError("UPSTREAM", "Exa's answer wasn't readable");
  }
  if (msg.error) {
    const m = String(msg.error.message ?? "error");
    throw new ReachError(String(msg.error.code) === "429" || LIMIT_RE.test(m) ? "RATE_LIMITED" : "UPSTREAM", `Exa: ${m.slice(0, 200)}`);
  }
  const body = (msg.result?.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
  if (msg.result?.isError) throw new ReachError(LIMIT_RE.test(body) ? "RATE_LIMITED" : "UPSTREAM", `Exa: ${body.slice(0, 200)}`);
  return body;
}

const na = (v?: string) => (!v || v === "N/A" ? null : v);

/** Header lines ("URL: …", "Published: …") from `start`; returns the fields and where the body begins. */
function exaHeaders(lines: string[], start: number): { fields: Record<string, string>; next: number } {
  const fields: Record<string, string> = {};
  let i = start;
  for (; i < lines.length; i++) {
    const m = lines[i].match(/^(Title|URL|Published|Author):\s*(.*)$/);
    if (!m) break;
    fields[m[1].toLowerCase()] = m[2].trim();
  }
  return { fields, next: i };
}

/** Exa's hosted SEARCH answer: one "Title: / URL: / Published: / Author:" block per hit, then highlights. */
export function parseExaText(text: string, source: ReachItem["source"] = "web"): ReachItem[] {
  const items: ReachItem[] = [];
  for (const raw of ("\n" + text.trim()).split(/\n(?=Title: )/)) {
    const block = raw.trim();
    if (!block.startsWith("Title:")) continue;
    const lines = block.split("\n");
    const { fields, next } = exaHeaders(lines, 0);
    const body = lines.slice(next).filter((l) => !/^(Highlights|Text):\s*$/.test(l.trim())).join("\n").trim();
    if (!na(fields.url)) continue;
    items.push({ title: na(fields.title), url: na(fields.url), author: na(fields.author), publishedAt: na(fields.published), text: body, source, via: "exa" });
  }
  return items;
}

/** Exa's hosted FETCH answer: "# Title", header lines, then the page — whose own "#" headings stay in the body. */
export function parseExaFetch(text: string, url: string, source: ReachItem["source"] = "web"): ReachItem {
  const lines = text.trim().split("\n");
  let title: string | null = null;
  let start = 0;
  if (lines[0]?.startsWith("# ")) { title = lines[0].slice(2).trim() || null; start = 1; }
  const { fields, next } = exaHeaders(lines, start);
  return {
    title: title ?? na(fields.title),
    url: na(fields.url) ?? url,
    author: na(fields.author),
    publishedAt: na(fields.published),
    text: lines.slice(next).join("\n").trim(),
    source,
    via: "exa",
  };
}

type ExaApiResult = { title?: string | null; url?: string; author?: string | null; publishedDate?: string | null; text?: string; highlights?: string[]; summary?: string };

async function exaApi(path: "/search" | "/contents", key: string, body: Record<string, unknown>): Promise<ExaApiResult[]> {
  const { status, text } = await getText(`${EXA_API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "user-agent": REACH_UA },
    body: JSON.stringify(body),
    timeoutMs: 40_000,
  });
  if (status === 401 || status === 403) throw new ReachError("UPSTREAM", "Exa refused the key");
  if (status === 429 || status === 402) throw new ReachError("RATE_LIMITED", `Exa answered ${status} (credits or rate limit)`);
  if (status >= 400) throw new ReachError("UPSTREAM", `Exa answered ${status}: ${text.slice(0, 160)}`);
  try {
    return (JSON.parse(text) as { results?: ExaApiResult[] }).results ?? [];
  } catch {
    throw new ReachError("UPSTREAM", "Exa's answer wasn't readable");
  }
}

const fromApi = (r: ExaApiResult, source: ReachItem["source"], via: string): ReachItem => ({
  title: r.title ?? null,
  url: r.url ?? null,
  author: r.author ?? null,
  publishedAt: r.publishedDate ?? null,
  text: (r.text || r.highlights?.join("\n\n") || r.summary || "").trim(),
  source,
  via,
});

// ── Public surface ───────────────────────────────────────────────────────────

export type WebSearchOptions = {
  limit?: number;
  /** Only these sites (e.g. ["reddit.com"]). */
  sites?: string[];
  /** Only pages published in the last N days (honoured with an Exa key). */
  freshDays?: number;
  source?: ReachItem["source"];
};

/** The free web search: Exa with a workspace key, else Exa's hosted endpoint. */
export async function webSearch(workspaceId: string | null | undefined, query: string, opts: WebSearchOptions = {}, channel: "web.search" | "reddit" = "web.search"): Promise<{ items: ReachItem[]; via: string }> {
  const q = query.trim().slice(0, 400);
  if (!q) throw new ReachError("BAD_INPUT", "nothing to search for");
  const limit = Math.max(1, Math.min(10, opts.limit ?? 5));
  const source = opts.source ?? "web";
  const [key, free] = await Promise.all([keyFor("exa", workspaceId), freeServicesOn(workspaceId)]);
  const keep = (items: ReachItem[]) => {
    const hits = opts.sites?.length ? items.filter((i) => i.url && opts.sites!.some((s) => hostIs(i.url!, s))) : items;
    if (!hits.length) throw new ReachError("NOT_FOUND", "no results");
    return hits.slice(0, limit);
  };
  const backends: Backend<ReachItem[]>[] = [];
  if (key) backends.push({ via: "exa-api", run: async () => keep((await exaApi("/search", key, {
    query: q, numResults: limit, type: "auto",
    ...(opts.sites?.length ? { includeDomains: opts.sites } : {}),
    ...(opts.freshDays ? { startPublishedDate: new Date(Date.now() - opts.freshDays * 86_400_000).toISOString() } : {}),
    contents: { highlights: { numSentences: 3, highlightsPerUrl: 2 } },
  })).map((r) => fromApi(r, source, "exa-api"))) });
  if (free) backends.push({ via: "exa", run: async () => keep(parseExaText(await exaHosted("web_search_exa", {
    query: opts.sites?.length ? `${opts.sites.map((s) => `site:${s}`).join(" OR ")} ${q}` : q,
    numResults: Math.min(10, limit + (opts.sites?.length ? 3 : 0)),
  }), source)) });
  const { value, via } = await firstThatWorks(workspaceId, channel, backends);
  return { items: value, via };
}

/** Read one public page as clean text: Jina Reader → Exa → our own fetch. */
export async function webRead(workspaceId: string | null | undefined, rawUrl: string, opts: { maxChars?: number; skipJina?: boolean; channel?: "web.read" | "reddit"; source?: ReachItem["source"] } = {}): Promise<{ item: ReachItem; via: string }> {
  const url = await publicLink(rawUrl);
  const maxChars = opts.maxChars ?? 20_000;
  const source = opts.source ?? "web";
  const [jinaKey, exaKey, free] = await Promise.all([keyFor("jina", workspaceId), keyFor("exa", workspaceId), freeServicesOn(workspaceId)]);
  const backends: Backend<ReachItem>[] = [];
  if (!opts.skipJina && (jinaKey || free)) backends.push({ via: "jina", run: () => jinaRead(url, jinaKey) });
  if (exaKey) backends.push({ via: "exa-api", run: async () => {
    const [r] = await exaApi("/contents", exaKey, { urls: [url], text: { maxCharacters: maxChars } });
    if (!r || !(r.text ?? "").trim()) throw new ReachError("UPSTREAM", "Exa returned no content");
    return fromApi({ ...r, url: r.url ?? url }, source, "exa-api");
  } });
  if (free) backends.push({ via: "exa", run: async () => {
    const text = await exaHosted("web_fetch_exa", { urls: [url], maxCharacters: maxChars });
    const item = parseExaFetch(text, url, source);
    if (item.text.length < 40) throw new ReachError("UPSTREAM", "Exa returned no readable text");
    return item;
  } });
  // Our own fetch last: no third party, but it only sees the server's HTML.
  backends.push({ via: "local", run: async () => {
    const { fetchPageText } = await import("@/lib/assistant/context");
    const r = await fetchPageText(url, maxChars);
    if (!r.ok) throw new ReachError(/answered 40[13]/.test(r.reason) ? "BLOCKED" : "UPSTREAM", r.reason);
    if (r.text.length < 40) throw new ReachError("UPSTREAM", "the page had no readable text (it may be built by scripts)");
    return { title: r.title || null, url, text: r.text, source, via: "local" };
  } });
  const { value, via } = await firstThatWorks(workspaceId, opts.channel ?? "web.read", backends);
  return { item: { ...value, text: value.text.slice(0, maxChars), source }, via };
}
