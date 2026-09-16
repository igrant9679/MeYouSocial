import { env } from "@/lib/env";

// Search-data seam: monthly search volume, CPC and competition for a list of
// phrases. This is the "real numbers" side of the keyword strategy — the
// intent/cluster labels next to it are LLM-classified and the page says so.
//
// ⚠ NO MOCK, ON PURPOSE. Web search degrades to a labelled mock because a
// mock link is obviously a mock; a mock search volume is just a number, and
// the house rule is never to invent one. No key → `getSearchDataProvider`
// returns null and every consumer renders a dash with the reason.
//
// Vendors (DB Setting api_key:<vendor> per workspace → platform → env):
//   dataforseo          — `login:password` (Basic auth), Google Ads volume,
//                         up to 1000 phrases per call. docs.dataforseo.com
//   keywordseverywhere  — Bearer key, GKP data, 100 phrases per call, one
//                         credit per phrase returned. keywordseverywhere.com
// DataForSEO is checked first when both are present (bigger batches).

export type KeywordMetrics = {
  phrase: string;
  /** Average monthly searches. */
  volume: number | null;
  /** Cost per click, in the currency the vendor was asked for (USD). */
  cpc: number | null;
  /** 0..1 — the vendor's paid-competition index, normalised. */
  competition: number | null;
  /** Oldest → newest, at most 12 months. */
  trend: Array<{ year: number; month: number; volume: number }> | null;
};

export interface SearchDataProvider {
  vendor: SearchDataVendor;
  /** Phrases are lowercased and deduped by the caller; the map is keyed by phrase. */
  metrics(phrases: string[], country: string): Promise<Map<string, KeywordMetrics>>;
}

export type SearchDataVendor = "dataforseo" | "keywordseverywhere";
export const SEARCH_DATA_VENDORS: readonly SearchDataVendor[] = ["dataforseo", "keywordseverywhere"];

/** Countries both vendors understand. Code = Keywords Everywhere's `country`
 *  (and our setting value); name = DataForSEO's `location_name`. */
export const SEARCH_DATA_COUNTRIES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "us", name: "United States" },
  { code: "gb", name: "United Kingdom" },
  { code: "ca", name: "Canada" },
  { code: "au", name: "Australia" },
  { code: "ie", name: "Ireland" },
  { code: "nz", name: "New Zealand" },
  { code: "in", name: "India" },
  { code: "za", name: "South Africa" },
  { code: "de", name: "Germany" },
  { code: "fr", name: "France" },
  { code: "es", name: "Spain" },
  { code: "it", name: "Italy" },
  { code: "nl", name: "Netherlands" },
  { code: "br", name: "Brazil" },
  { code: "mx", name: "Mexico" },
];
export const DEFAULT_SEARCH_DATA_COUNTRY = "us";

export function isSearchDataCountry(code: string): boolean {
  return SEARCH_DATA_COUNTRIES.some((c) => c.code === code);
}

// ── Key resolution ───────────────────────────────────────────────────────────

async function resolveKeys(workspaceId?: string | null): Promise<Record<SearchDataVendor, string>> {
  const { getSetting } = await import("@/lib/settings");
  const [dataforseo, ke] = await Promise.all([
    getSetting("api_key:dataforseo", workspaceId),
    getSetting("api_key:keywordseverywhere", workspaceId),
  ]);
  return {
    dataforseo: dataforseo || env.DATAFORSEO_AUTH,
    keywordseverywhere: ke || env.KEYWORDS_EVERYWHERE_API_KEY,
  };
}

/** The workspace's search-data provider, or null when no key resolves. */
export async function getSearchDataProvider(workspaceId?: string | null): Promise<SearchDataProvider | null> {
  const keys = await resolveKeys(workspaceId);
  if (keys.dataforseo) return dataForSeoProvider(keys.dataforseo);
  if (keys.keywordseverywhere) return keywordsEverywhereProvider(keys.keywordseverywhere);
  return null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
const clamp01 = (n: number | null): number | null => (n == null ? null : Math.max(0, Math.min(1, n)));

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function readJson(res: Response, vendor: string): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) throw new Error(`${vendor} ${res.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${vendor} returned non-JSON: ${text.slice(0, 120)}`);
  }
}

// ── DataForSEO ───────────────────────────────────────────────────────────────
// POST /v3/keywords_data/google_ads/search_volume/live — one task, up to 1000
// keywords (≤80 chars each). Result rows: keyword, search_volume, cpc,
// competition ("LOW"|"MEDIUM"|"HIGH"), competition_index (0..100),
// monthly_searches [{year, month, search_volume}].

function dataForSeoProvider(auth: string): SearchDataProvider {
  const basic = Buffer.from(auth, "utf8").toString("base64");
  return {
    vendor: "dataforseo",
    async metrics(phrases, country) {
      const out = new Map<string, KeywordMetrics>();
      const location = SEARCH_DATA_COUNTRIES.find((c) => c.code === country)?.name ?? "United States";
      for (const batch of chunk(phrases.filter((p) => p.length <= 80), 1000)) {
        const res = await fetch("https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Basic ${basic}` },
          body: JSON.stringify([{ keywords: batch, location_name: location, language_code: "en" }]),
          signal: AbortSignal.timeout(60_000),
        });
        const json = (await readJson(res, "DataForSEO")) as {
          status_code?: number; status_message?: string;
          tasks?: Array<{ status_code?: number; status_message?: string; result?: Array<Record<string, unknown>> | null }>;
        };
        const task = json.tasks?.[0];
        if (!task) throw new Error(`DataForSEO: ${json.status_message ?? "no task in the response"}`);
        // 20000 = ok. Anything else is the vendor refusing (bad login, no
        // funds, a malformed task) — say so rather than storing nothing silently.
        if (task.status_code !== 20000) throw new Error(`DataForSEO: ${task.status_message ?? `status ${task.status_code}`}`);
        for (const row of task.result ?? []) {
          const phrase = String(row.keyword ?? "").toLowerCase();
          if (!phrase) continue;
          const months = Array.isArray(row.monthly_searches) ? (row.monthly_searches as Array<Record<string, unknown>>) : [];
          const trend = months
            .map((m) => ({ year: num(m.year) ?? 0, month: num(m.month) ?? 0, volume: num(m.search_volume) ?? 0 }))
            .filter((m) => m.year && m.month)
            .sort((a, b) => a.year - b.year || a.month - b.month)
            .slice(-12);
          out.set(phrase, {
            phrase,
            volume: num(row.search_volume),
            cpc: num(row.cpc),
            competition: clamp01(num(row.competition_index) == null ? null : (num(row.competition_index) as number) / 100),
            trend: trend.length ? trend : null,
          });
        }
      }
      return out;
    },
  };
}

// ── Keywords Everywhere ──────────────────────────────────────────────────────
// POST /v1/get_keyword_data — form-encoded kw[] (≤100), country, currency,
// dataSource=gkp. Rows: keyword, vol, cpc {currency, value}, competition
// (0..1), trend [{month: "Jan", year, value}]. One credit per keyword returned.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function keywordsEverywhereProvider(apiKey: string): SearchDataProvider {
  return {
    vendor: "keywordseverywhere",
    async metrics(phrases, country) {
      const out = new Map<string, KeywordMetrics>();
      for (const batch of chunk(phrases, 100)) {
        const body = new URLSearchParams();
        for (const p of batch) body.append("kw[]", p);
        body.set("country", country);
        body.set("currency", "usd");
        body.set("dataSource", "gkp");
        const res = await fetch("https://api.keywordseverywhere.com/v1/get_keyword_data", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Bearer ${apiKey}` },
          body,
          signal: AbortSignal.timeout(60_000),
        });
        const json = (await readJson(res, "Keywords Everywhere")) as { data?: Array<Record<string, unknown>>; error?: string };
        if (json.error) throw new Error(`Keywords Everywhere: ${json.error}`);
        for (const row of json.data ?? []) {
          const phrase = String(row.keyword ?? "").toLowerCase();
          if (!phrase) continue;
          const cpc = row.cpc && typeof row.cpc === "object" ? num((row.cpc as Record<string, unknown>).value) : num(row.cpc);
          const rawTrend = Array.isArray(row.trend) ? (row.trend as Array<Record<string, unknown>>) : [];
          const trend = rawTrend
            .map((t) => {
              const m = typeof t.month === "string" ? MONTHS.indexOf(t.month.slice(0, 3).toLowerCase()) + 1 : num(t.month) ?? 0;
              return { year: num(t.year) ?? 0, month: m, volume: num(t.value) ?? 0 };
            })
            .filter((m) => m.year && m.month)
            .sort((a, b) => a.year - b.year || a.month - b.month)
            .slice(-12);
          out.set(phrase, { phrase, volume: num(row.vol), cpc, competition: clamp01(num(row.competition)), trend: trend.length ? trend : null });
        }
      }
      return out;
    },
  };
}

/** Human label for a vendor id, for the page and the audit trail. */
export function searchDataVendorLabel(vendor: SearchDataVendor | string): string {
  return vendor === "dataforseo" ? "DataForSEO" : vendor === "keywordseverywhere" ? "Keywords Everywhere" : vendor;
}
