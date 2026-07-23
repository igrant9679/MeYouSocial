/**
 * FR-7 — SEO plugin field mapping.
 *
 * Each supported plugin stores its SEO fields as WordPress post meta under its
 * own keys. We ship the keys we know, let each install override them, and then
 * — because "we sent it" is not the same as "WordPress stored it" — read the
 * post back after publishing and report which fields actually landed.
 *
 * Honesty note carried into the UI: WordPress only accepts `meta` over the REST
 * API for keys registered with `show_in_rest`. Yoast and Rank Math register
 * theirs in current versions; Squirrly keeps its SEO data in its own tables and
 * its REST-writable keys vary by version, so its map ships empty and must be
 * filled in per install. The read-back is what tells you whether it worked.
 */

export const SEO_PLUGINS = ["none", "yoast", "rankmath", "squirrly"] as const;
export type SeoPlugin = (typeof SEO_PLUGINS)[number];

export function isSeoPlugin(p: string): p is SeoPlugin {
  return (SEO_PLUGINS as readonly string[]).includes(p);
}

export const SEO_PLUGIN_LABELS: Record<SeoPlugin, string> = {
  none: "None (content only)",
  yoast: "Yoast SEO",
  rankmath: "Rank Math",
  squirrly: "Squirrly SEO",
};

/** Our canonical field names — the left-hand side of every map. */
export const SEO_FIELDS = [
  "title",
  "description",
  "focusKeyword",
  "canonical",
  "ogTitle",
  "ogDescription",
  "ogImage",
] as const;
export type SeoField = (typeof SEO_FIELDS)[number];

export const SEO_FIELD_LABELS: Record<SeoField, string> = {
  title: "SEO title",
  description: "Meta description",
  focusKeyword: "Focus keyword",
  canonical: "Canonical URL",
  ogTitle: "OG title",
  ogDescription: "OG description",
  ogImage: "OG image URL",
};

type FieldMap = Partial<Record<SeoField, string>>;

const DEFAULT_MAPS: Record<SeoPlugin, FieldMap> = {
  none: {},
  yoast: {
    title: "_yoast_wpseo_title",
    description: "_yoast_wpseo_metadesc",
    focusKeyword: "_yoast_wpseo_focuskw",
    canonical: "_yoast_wpseo_canonical",
    ogTitle: "_yoast_wpseo_opengraph-title",
    ogDescription: "_yoast_wpseo_opengraph-description",
    ogImage: "_yoast_wpseo_opengraph-image",
  },
  rankmath: {
    title: "rank_math_title",
    description: "rank_math_description",
    focusKeyword: "rank_math_focus_keyword",
    canonical: "rank_math_canonical_url",
    ogTitle: "rank_math_facebook_title",
    ogDescription: "rank_math_facebook_description",
    ogImage: "rank_math_facebook_image",
  },
  // Squirrly's REST-writable keys differ per install — fill these in on the
  // settings page and confirm with the publish read-back.
  squirrly: {},
};

/** Parse the per-install override JSON, keeping only known fields. */
export function parseFieldMap(json: string | null | undefined): FieldMap {
  if (!json) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object") return {};
  const out: FieldMap = {};
  for (const field of SEO_FIELDS) {
    const v = (raw as Record<string, unknown>)[field];
    if (typeof v === "string" && v.trim()) out[field] = v.trim().slice(0, 120);
  }
  return out;
}

/** Built-in keys for the plugin, with the install's overrides applied on top. */
export function effectiveFieldMap(plugin: SeoPlugin, overrides: string | null | undefined): FieldMap {
  return { ...DEFAULT_MAPS[plugin], ...parseFieldMap(overrides) };
}

export function defaultFieldMap(plugin: SeoPlugin): FieldMap {
  return { ...DEFAULT_MAPS[plugin] };
}

export type SeoValues = Partial<Record<SeoField, string>>;

/** Turn our values into the `meta` object WordPress expects for this plugin. */
export function buildSeoMeta(map: FieldMap, values: SeoValues): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const field of SEO_FIELDS) {
    const key = map[field];
    const value = values[field];
    if (key && value) meta[key] = value;
  }
  return meta;
}

export type SeoFieldOutcome = {
  field: SeoField;
  key: string;
  sent: string;
  stored: string | null;
  accepted: boolean;
};

/**
 * Compare what we sent against what the post actually holds now. `storedMeta`
 * is the `meta` object from a `context=edit` read of the created post.
 */
export function verifySeoMeta(
  map: FieldMap,
  values: SeoValues,
  storedMeta: Record<string, unknown> | null,
): SeoFieldOutcome[] {
  const out: SeoFieldOutcome[] = [];
  for (const field of SEO_FIELDS) {
    const key = map[field];
    const sent = values[field];
    if (!key || !sent) continue;
    const rawStored = storedMeta ? storedMeta[key] : undefined;
    const stored =
      typeof rawStored === "string"
        ? rawStored
        : Array.isArray(rawStored) && typeof rawStored[0] === "string"
          ? (rawStored[0] as string)
          : null;
    out.push({ field, key, sent, stored, accepted: stored === sent });
  }
  return out;
}

// ---- Slug conventions (FR-7: one canonical rule) ---------------------------------

export type SlugRules = {
  maxWords: number;
  stripStopWords: boolean;
  prefix: string | null;
};

export const DEFAULT_SLUG_RULES: SlugRules = { maxWords: 6, stripStopWords: true, prefix: null };

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "in", "is",
  "it", "of", "on", "or", "that", "the", "to", "was", "will", "with", "your", "you",
]);

export function parseSlugRules(json: string | null | undefined): SlugRules {
  if (!json) return { ...DEFAULT_SLUG_RULES };
  try {
    const raw = JSON.parse(json) as Partial<SlugRules>;
    const maxWords = Number(raw.maxWords);
    return {
      maxWords: Number.isFinite(maxWords) && maxWords >= 1 && maxWords <= 15 ? Math.round(maxWords) : DEFAULT_SLUG_RULES.maxWords,
      stripStopWords: typeof raw.stripStopWords === "boolean" ? raw.stripStopWords : DEFAULT_SLUG_RULES.stripStopWords,
      prefix: typeof raw.prefix === "string" && raw.prefix.trim() ? slugify(raw.prefix.trim()) : null,
    };
  } catch {
    return { ...DEFAULT_SLUG_RULES };
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The one canonical slug rule, applied to a title or an existing slug. */
export function applySlugConvention(input: string, rules: SlugRules): string {
  let words = slugify(input).split("-").filter(Boolean);
  if (rules.stripStopWords) {
    const kept = words.filter((w) => !STOP_WORDS.has(w));
    // Never strip a slug down to nothing — a title of pure stop words keeps them.
    if (kept.length) words = kept;
  }
  words = words.slice(0, rules.maxWords);
  const body = words.join("-");
  return rules.prefix ? `${rules.prefix}-${body}`.slice(0, 96) : body.slice(0, 96);
}

export function slugMatchesConvention(slug: string | null, rules: SlugRules): boolean {
  if (!slug) return false;
  const words = slug.split("-").filter(Boolean);
  if (words.length > rules.maxWords + (rules.prefix ? rules.prefix.split("-").length : 0)) return false;
  if (rules.prefix && !slug.startsWith(`${rules.prefix}-`)) return false;
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);
}
