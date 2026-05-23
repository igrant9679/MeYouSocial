import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

// FR-INTEL-05 severity bands.
export function outlierBand(score: number | null | undefined): { color: string; soft: string; label: string } {
  const s = score ?? 0;
  if (s >= 5)  return { color: "#E5482F", soft: "#FDE7E1", label: "exceptional" };
  if (s >= 2)  return { color: "#D97706", soft: "#FBEED5", label: "strong" };
  if (s >= 1)  return { color: "#2563EB", soft: "#E5EDFD", label: "average" };
  return { color: "#6B7280", soft: "#F5F7FA", label: "under" };
}

// FR-INTEL-04 — flag fast-growing channels.
export function isFastGrowing(velocityScore: number | null | undefined): boolean {
  return (velocityScore ?? 0) >= 5;
}

// FR-INTEL-06 — views/sub high indicator.
export function viewsPerSubBand(ratio: number | null | undefined): { color: string; soft: string; label: string } | null {
  const r = ratio ?? 0;
  if (r >= 0.5) return { color: "#15924B", soft: "#E0F2E8", label: "high" };
  if (r >= 0.1) return { color: "#2563EB", soft: "#E5EDFD", label: "ok" };
  return null;
}

export type IntelSearchParams = {
  q?: string;
  subsMin?: number;
  subsMax?: number;
  velocityMin?: number;
  language?: string;
  format?: "short" | "long" | "";
};

// FR-INTEL-01 — natural-language-ish search. Keywords 'channel'/'niche' bias toward
// channel results; otherwise we surface videos.
export async function searchIntel(params: IntelSearchParams) {
  const q = (params.q ?? "").trim();
  const biasChannels = /\b(channel|niche|creator|account)s?\b/i.test(q);

  const channelWhere: Prisma.IntelChannelWhereInput = {
    AND: [
      q
        ? {
            OR: [
              { name: { contains: q } },
              { handle: { contains: q } },
              { category: { contains: q } },
            ],
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
      q ? { title: { contains: q } } : {},
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
