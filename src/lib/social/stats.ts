import type { ZernioMetrics } from "@/lib/zernio";

/**
 * Engagement numbers for one posted target.
 *
 * ── Why this file shrank ────────────────────────────────────────────────────
 * Against Unipile this was a tolerant field-name guesser: the statistics
 * endpoint and payload were undocumented and unverifiable without a connected
 * account, so it accepted a dozen spellings per metric and reported what it
 * didn't recognise. Zernio documents its analytics block exactly, so the
 * guessing is gone — mapping is now a direct, checkable correspondence.
 *
 * What survives from that design is the part that was never about Unipile: the
 * honesty contract. A figure a platform didn't report is `null` (unknown), never
 * 0. Zernio omits metrics a network doesn't provide, and "nobody reported
 * impressions" must not render as "0 impressions".
 */

export type SocialStats = {
  impressions: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
  views: number | null;
};

export const EMPTY_STATS: SocialStats = {
  impressions: null, reach: null, likes: null, comments: null,
  shares: null, saves: null, clicks: null, views: null,
};

/** Accept only a finite, non-negative number; anything else is unknown. */
function count(v: number | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
}

/** Zernio's documented metric block → our storage shape. */
export function fromZernioMetrics(m: ZernioMetrics | undefined): SocialStats {
  if (!m) return { ...EMPTY_STATS };
  return {
    impressions: count(m.impressions),
    reach: count(m.reach),
    likes: count(m.likes),
    comments: count(m.comments),
    shares: count(m.shares),
    saves: count(m.saves),
    clicks: count(m.clicks),
    views: count(m.views),
  };
}

/**
 * Likes + comments + shares + saves. Null when NONE of the four was reported —
 * which is different from a post that genuinely earned nothing and reports
 * zeros.
 *
 * Deliberately not Zernio's own `engagementRate`: that is computed per platform
 * against a denominator we can't see, so it can't be summed or compared across
 * networks. We derive the rate ourselves from figures we hold.
 */
export function engagementOf(s: SocialStats): number | null {
  const parts = [s.likes, s.comments, s.shares, s.saves].filter((v): v is number => v !== null);
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
}

/** Whether a reading is worth storing at all. */
export function hasAnyStat(s: SocialStats): boolean {
  return Object.values(s).some((v) => v !== null);
}
