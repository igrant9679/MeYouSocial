import { env } from "@/lib/env";

// Web search seam. Real providers: Tavily and Serper (Google results) — active
// as soon as a key resolves (DB Setting api_key:tavily / api_key:serper first,
// then TAVILY_API_KEY / SERPER_API_KEY env); then Exa through Reach (its key, or
// its free hosted endpoint — 2026-11-09). Setting USE_MOCK_SEARCH=true forces the
// mock regardless (testing). Only with free public services off and no key at
// all does it fall to the mock, clearly labeled.

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export interface SearchProvider {
  search(query: string, limit?: number): Promise<SearchResult[]>;
}

const mock: SearchProvider = {
  async search(query, limit = 5) {
    return Array.from({ length: limit }, (_, i) => ({
      title: `Result ${i + 1} for "${query}" (mock)`,
      url: `https://example.com/r/${i + 1}?q=${encodeURIComponent(query)}`,
      snippet: "This is a mock search result. Add a Tavily, Serper or Exa key under Settings → Keys, or turn free public sources back on there, to get real results.",
    }));
  },
};

// ── Key resolution (DB first, env fallback, 30s cache) ──────────────────────

type SearchVendor = "tavily" | "serper";
const ENV_KEYS: Record<SearchVendor, string> = {
  tavily: env.TAVILY_API_KEY,
  serper: env.SERPER_API_KEY,
};

async function resolveKeys(workspaceId?: string | null): Promise<Record<SearchVendor, string>> {
  // Multi-tenant: workspace's own key → platform Setting → env. Caching lives
  // in the shared settings layer (workspace-aware).
  const { getSetting } = await import("@/lib/settings");
  const [tavily, serper] = await Promise.all([
    getSetting("api_key:tavily", workspaceId),
    getSetting("api_key:serper", workspaceId),
  ]);
  return { tavily: tavily || ENV_KEYS.tavily, serper: serper || ENV_KEYS.serper };
}

export function invalidateSearchKeyCache(): void {
  // Kept for the admin save action's existing import; the shared settings
  // cache is the real store now.
  void import("@/lib/settings").then((m) => m.invalidateSettingsCache());
}

// ── Real providers ───────────────────────────────────────────────────────────

function tavilyProvider(apiKey: string): SearchProvider {
  return {
    async search(query, limit = 5) {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query, max_results: Math.min(limit, 10) }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
      const data = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
      return (data.results ?? []).map((r) => ({
        title: r.title ?? "Untitled",
        url: r.url ?? "",
        snippet: (r.content ?? "").slice(0, 400),
      }));
    },
  };
}

function serperProvider(apiKey: string): SearchProvider {
  return {
    async search(query, limit = 5) {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
        body: JSON.stringify({ q: query, num: Math.min(limit, 10) }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`Serper HTTP ${res.status}`);
      const data = (await res.json()) as { organic?: Array<{ title?: string; link?: string; snippet?: string }> };
      return (data.organic ?? []).map((r) => ({
        title: r.title ?? "Untitled",
        url: r.link ?? "",
        snippet: (r.snippet ?? "").slice(0, 400),
      }));
    },
  };
}

// ── Selection ────────────────────────────────────────────────────────────────

/**
 * Exa through Reach (Agent-Reach's web search): a workspace's Exa key, else
 * Exa's free hosted endpoint. Real results; a failure (the free limit, an
 * outage) is NO results and the reason logged — never placeholders, so a
 * citation search can't mistake an outage for evidence.
 */
function exaProvider(workspaceId?: string | null): SearchProvider {
  return {
    async search(query, limit = 5) {
      const { webSearch } = await import("@/lib/reach/web");
      try {
        const { items } = await webSearch(workspaceId, query, { limit });
        return items.filter((i) => i.url).map((i) => ({ title: i.title ?? i.url!, url: i.url!, snippet: i.text.replace(/\s+/g, " ").slice(0, 400) }));
      } catch (e) {
        const { reasonOf } = await import("@/lib/reach/core");
        console.warn(`[search] exa: ${reasonOf(e)}`);
        return [];
      }
    },
  };
}

export async function getSearchProvider(workspaceId?: string | null): Promise<{ provider: SearchProvider; real: boolean; vendor: string }> {
  if (env.USE_MOCK_SEARCH) return { provider: mock, real: false, vendor: "mock" };
  const keys = await resolveKeys(workspaceId);
  if (keys.tavily) return { provider: tavilyProvider(keys.tavily), real: true, vendor: "tavily" };
  if (keys.serper) return { provider: serperProvider(keys.serper), real: true, vendor: "serper" };
  // No paid key: Exa (Reach). With its own key, or the free hosted endpoint
  // unless the workspace turned free public services off.
  const { keyFor, freeServicesOn } = await import("@/lib/reach/core");
  if (await keyFor("exa", workspaceId)) return { provider: exaProvider(workspaceId), real: true, vendor: "exa" };
  if (await freeServicesOn(workspaceId)) return { provider: exaProvider(workspaceId), real: true, vendor: "exa-free" };
  return { provider: mock, real: false, vendor: "mock" };
}

/** Legacy call-site surface — resolves the live provider per call (platform keys). */
export const search: SearchProvider = {
  async search(query, limit) {
    const { provider } = await getSearchProvider();
    return provider.search(query, limit);
  },
};
