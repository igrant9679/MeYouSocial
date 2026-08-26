import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

/**
 * A video's thumbnail URL. The sync has never actually stored `thumbnailUrl`
 * (all 99 CF rows were null when the owner asked "why can't I see this
 * short?", 2026-08-26), but YouTube thumbs are derivable from the id —
 * `hqdefault` always exists where `maxres` may not (the same fallback
 * vision.ts documents). A stored value wins if the sync ever starts writing
 * one.
 */
export function intelThumbUrl(v: { thumbnailUrl: string | null; youtubeId: string }): string | null {
  if (v.thumbnailUrl) return v.thumbnailUrl;
  return /^[A-Za-z0-9_-]{6,20}$/.test(v.youtubeId) ? `https://i.ytimg.com/vi/${v.youtubeId}/hqdefault.jpg` : null;
}

// severity bands.
export function outlierBand(score: number | null | undefined): { color: string; soft: string; label: string } {
  const s = score ?? 0;
  if (s >= 5)  return { color: "var(--brand-on)", soft: "var(--brand-soft)", label: "exceptional" };
  if (s >= 2)  return { color: "var(--amber-on)", soft: "var(--amber-soft)", label: "strong" };
  if (s >= 1)  return { color: "var(--blue-on)", soft: "var(--blue-soft)", label: "average" };
  return { color: "var(--mute)", soft: "var(--zebra)", label: "under" };
}

// flag fast-growing channels.
export function isFastGrowing(velocityScore: number | null | undefined): boolean {
  return (velocityScore ?? 0) >= 5;
}

// views/sub high indicator.
export function viewsPerSubBand(ratio: number | null | undefined): { color: string; soft: string; label: string } | null {
  const r = ratio ?? 0;
  if (r >= 0.5) return { color: "var(--green-on)", soft: "var(--green-soft)", label: "high" };
  if (r >= 0.1) return { color: "var(--blue-on)", soft: "var(--blue-soft)", label: "ok" };
  return null;
}

export type IntelSearchParams = {
  /** Tenant boundary — Intel is workspace-scoped like everything else. */
  workspaceId: string;
  q?: string;
  subsMin?: number;
  subsMax?: number;
  velocityMin?: number;
  language?: string;
  format?: "short" | "long" | "";
};

/**
 * Parse advanced query syntax embedded in the free-text q:
 *   subs:>100k  subs:<1m  velocity:>5  engagement:>0.05  views:>1m
 *   format:short  format:long  lang:en
 * Returns the cleaned text (with the tokens stripped) plus the extracted filters.
 */
export function parseAdvancedQuery(raw: string): { cleaned: string; extra: Partial<IntelSearchParams & { engagementMin: number; viewsMin: number }> } {
  const extra: Partial<IntelSearchParams & { engagementMin: number; viewsMin: number }> = {};
  let cleaned = raw;
  function num(s: string): number {
    const m = s.trim().toLowerCase();
    if (m.endsWith("m")) return Number(m.slice(0, -1)) * 1_000_000;
    if (m.endsWith("k")) return Number(m.slice(0, -1)) * 1_000;
    return Number(m);
  }
  const tokenRE = /\b(\w+)\s*:\s*([<>]?=?)\s*([^\s]+)/g;
  cleaned = cleaned.replace(tokenRE, (match, key: string, op: string, valRaw: string) => {
    const v = num(valRaw);
    switch (key.toLowerCase()) {
      case "subs":     case "subscribers":
        if (op.startsWith(">")) extra.subsMin = Number.isFinite(v) ? v : undefined;
        else if (op.startsWith("<")) extra.subsMax = Number.isFinite(v) ? v : undefined;
        return "";
      case "velocity":
        if (op.startsWith(">") && Number.isFinite(v)) extra.velocityMin = v;
        return "";
      case "engagement":
        if (op.startsWith(">") && Number.isFinite(v)) extra.engagementMin = v;
        return "";
      case "views":
        if (op.startsWith(">") && Number.isFinite(v)) extra.viewsMin = v;
        return "";
      case "format":
        if (valRaw === "short" || valRaw === "long") extra.format = valRaw;
        return "";
      case "lang":     case "language":
        extra.language = valRaw;
        return "";
      default:
        return match; // unknown, keep as-is in cleaned
    }
  });
  return { cleaned: cleaned.replace(/\s+/g, " ").trim(), extra };
}

// natural-language search. Free text + parsed advanced tokens combine.
// Keywords 'channel'/'niche' bias toward channel results; otherwise videos.
export async function searchIntel(params: IntelSearchParams) {
  // Apply advanced-syntax tokens lifted from q
  const parsed = parseAdvancedQuery(params.q ?? "");
  const merged = { ...params, ...parsed.extra, q: parsed.cleaned } as IntelSearchParams;
  return searchIntelRaw(merged);
}

// Words that carry no signal in a research query — matching on them would make
// "AI for nonprofit management" hit every row containing "for".
const STOPWORDS = new Set(["a", "an", "and", "for", "in", "of", "on", "or", "the", "to", "with"]);

/**
 * Split a query into match tokens. ⚠ Two field lessons baked in:
 * Prisma `contains` is case-SENSITIVE on Postgres unless mode:"insensitive" —
 * "AI marketing" silently missed "AI Marketing" right after indexing it; and
 * phrase-matching the whole query meant a multi-word search only hit rows
 * containing the exact phrase. Tokens match ANY-of (OR), insensitively.
 */
function queryTokens(q: string): string[] {
  return q
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOPWORDS.has(t.toLowerCase()))
    .slice(0, 10);
}

async function searchIntelRaw(params: IntelSearchParams) {
  const q = (params.q ?? "").trim();
  const biasChannels = /\b(channel|niche|creator|account)s?\b/i.test(q);
  const tokens = queryTokens(q);

  const channelWhere: Prisma.IntelChannelWhereInput = {
    AND: [
      { workspaceId: params.workspaceId },
      tokens.length
        ? {
            OR: tokens.flatMap((t) => [
              { name: { contains: t, mode: "insensitive" as const } },
              { handle: { contains: t, mode: "insensitive" as const } },
              { category: { contains: t, mode: "insensitive" as const } },
            ]),
          }
        : {},
      params.subsMin != null ? { subscribers: { gte: params.subsMin } } : {},
      params.subsMax != null ? { subscribers: { lte: params.subsMax } } : {},
      params.velocityMin != null ? { velocityScore: { gte: params.velocityMin } } : {},
      params.language ? { language: params.language } : {},
    ],
  };

  const videoWhere: Prisma.IntelVideoWhereInput = {
    AND: [
      { intelChannel: { workspaceId: params.workspaceId } },
      tokens.length
        ? { OR: tokens.map((t) => ({ title: { contains: t, mode: "insensitive" as const } })) }
        : {},
      params.format ? { format: params.format } : {},
      params.velocityMin != null ? { intelChannel: { velocityScore: { gte: params.velocityMin } } } : {},
      params.language ? { intelChannel: { language: params.language } } : {},
      params.subsMin != null ? { intelChannel: { subscribers: { gte: params.subsMin } } } : {},
      params.subsMax != null ? { intelChannel: { subscribers: { lte: params.subsMax } } } : {},
    ],
  };

  const [channels, videos] = await Promise.all([
    db.intelChannel.findMany({ where: channelWhere, orderBy: { subscribers: "desc" }, take: 30 }),
    db.intelVideo.findMany({
      where: videoWhere,
      orderBy: { outlierScore: "desc" },
      take: 30,
      include: { intelChannel: true },
    }),
  ]);
  return { channels, videos, biasChannels };
}

export function formatNum(n: number | bigint | null | undefined): string {
  const v = typeof n === "bigint" ? Number(n) : (n ?? 0);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(v >= 100_000 ? 0 : 1) + "K";
  return String(v);
}
