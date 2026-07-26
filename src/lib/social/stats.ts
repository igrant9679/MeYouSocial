/**
 * Reading engagement numbers out of a social-post payload.
 *
 * ── Why this is a tolerant mapper rather than a typed response ──────────────
 * Unipile normalizes several networks behind one API, and the exact field names
 * it returns for post statistics could NOT be verified while building this:
 * there is no connected account on this deployment, so no real response was
 * ever seen. Guessing one shape and hard-coding it would fail silently the
 * first time it ran — the worst possible outcome for a metrics feed, because
 * "no engagement" and "we didn't understand the reply" would look identical.
 *
 * So instead: accept any of the plausible spellings each network/API version
 * uses, search a few nesting levels, and — crucially — report which keys were
 * ACTUALLY matched plus the keys that were present but unrecognised. The sync
 * surfaces that, so the first live pull tells the operator exactly what to add
 * here instead of quietly writing nulls forever.
 *
 * The honesty contract from the metrics spine applies: a field we could not
 * find is `null` (unknown), never 0. A network that genuinely reports zero
 * likes gives us a real 0, and that is a different fact.
 */

export type SocialStats = {
  impressions: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  clicks: number | null;
};

export const EMPTY_STATS: SocialStats = {
  impressions: null, likes: null, comments: null, shares: null, clicks: null,
};

/**
 * Accepted spellings per metric, lowercased with separators stripped, so
 * `impression_count`, `impressionCount` and `IMPRESSIONS` all collapse together.
 * Order matters only for readability — matching is by set membership.
 */
const ALIASES: Record<keyof SocialStats, string[]> = {
  impressions: ["impressions", "impressioncount", "views", "viewcount", "viewscount", "reach", "reachcount", "seencount"],
  likes: ["likes", "likecount", "likescount", "reactions", "reactioncount", "reactionscount", "favorites", "favoritecount", "favouritecount"],
  comments: ["comments", "commentcount", "commentscount", "replies", "replycount", "repliescount"],
  shares: ["shares", "sharecount", "sharescount", "reposts", "repostcount", "retweets", "retweetcount", "reshares", "resharecount"],
  clicks: ["clicks", "clickcount", "clickscount", "linkclicks", "linkclickcount", "urlclicks"],
};

/** Containers worth descending into when the counts aren't at the top level. */
const NESTED_KEYS = ["statistics", "stats", "metrics", "insights", "public_metrics", "publicmetrics", "counts", "engagement", "reaction_counts", "summary", "data", "post"];

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[\s_\-.]/g, "");
}

/**
 * Coerce a reported count. Rejects anything that isn't a finite, non-negative
 * number — a string like "1.2K" is NOT silently turned into 1.2, and a negative
 * is treated as unusable rather than stored as fact.
 */
function toCount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
  // Plain integer strings are common in JSON APIs and are unambiguous.
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

export type StatsParse = {
  stats: SocialStats;
  /** Which payload keys produced each value — provenance for the audit trail. */
  matched: Partial<Record<keyof SocialStats, string>>;
  /** Numeric-looking keys we did NOT recognise. The map's to-do list. */
  unrecognisedNumericKeys: string[];
  /** True when nothing at all was understood — distinct from "all zeros". */
  empty: boolean;
};

/**
 * Pull stats out of an arbitrary payload.
 *
 * Walks the top level and one level into known container keys. Deliberately
 * NOT a deep recursive search: a blind walk would happily read an unrelated
 * `author.followers.count` as `likes`, and a wrong number is worse than a null.
 */
export function parseSocialStats(payload: unknown): StatsParse {
  const stats: SocialStats = { ...EMPTY_STATS };
  const matched: Partial<Record<keyof SocialStats, string>> = {};
  const unrecognised = new Set<string>();

  if (!payload || typeof payload !== "object") {
    return { stats, matched, unrecognisedNumericKeys: [], empty: true };
  }

  const scopes: { prefix: string; obj: Record<string, unknown> }[] = [
    { prefix: "", obj: payload as Record<string, unknown> },
  ];
  for (const nk of NESTED_KEYS) {
    const child = (payload as Record<string, unknown>)[nk];
    if (child && typeof child === "object" && !Array.isArray(child)) {
      scopes.push({ prefix: `${nk}.`, obj: child as Record<string, unknown> });
    }
  }

  for (const { prefix, obj } of scopes) {
    for (const [rawKey, rawVal] of Object.entries(obj)) {
      const norm = normalizeKey(rawKey);
      const count = toCount(rawVal);
      let claimed = false;
      for (const field of Object.keys(ALIASES) as (keyof SocialStats)[]) {
        if (!ALIASES[field].includes(norm)) continue;
        claimed = true;
        // First scope wins: the top level is more authoritative than a nested
        // container, and re-reading the same figure twice changes nothing.
        if (stats[field] === null && count !== null) {
          stats[field] = count;
          matched[field] = `${prefix}${rawKey}`;
        }
        break;
      }
      if (!claimed && count !== null) unrecognised.add(`${prefix}${rawKey}`);
    }
  }

  return {
    stats,
    matched,
    unrecognisedNumericKeys: [...unrecognised].sort(),
    empty: Object.values(stats).every((v) => v === null),
  };
}

/** Likes + comments + shares. Null when NONE of the three was reported. */
export function engagementOf(s: SocialStats): number | null {
  const parts = [s.likes, s.comments, s.shares].filter((v): v is number => v !== null);
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
}

/** Whether a reading is worth storing at all. */
export function hasAnyStat(s: SocialStats): boolean {
  return Object.values(s).some((v) => v !== null);
}
