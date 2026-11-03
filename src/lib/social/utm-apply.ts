/**
 * The pure half of UTM tagging (lib/social/utm.ts reads the settings): what a
 * tagged link looks like, with no database — so the composer's previews (E-SOC-09)
 * show the links exactly as the send will tag them, from the same code.
 */

export type UtmConfig = {
  enabled: boolean;
  source: string; // "" = use the network name (linkedin / x / instagram)
  medium: string;
  campaign: string;
};

export const UTM_DEFAULTS: UtmConfig = { enabled: false, source: "", medium: "social", campaign: "" };

/** Network → a clean utm_source value. LINKEDIN → linkedin. */
export function sourceForProvider(provider: string): string {
  return provider.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") || "social";
}

// Trailing punctuation is almost always sentence punctuation, not part of the
// URL — capture it separately so "see https://x.com/a." doesn't tag ".".
const URL_RE = /https?:\/\/[^\s<>()[\]{}"']+/g;

/**
 * Append UTM params to every eligible link in `text`. Pure and synchronous so
 * it can be fixture-tested without a database.
 */
export function applyUtm(text: string, cfg: UtmConfig, provider: string): string {
  if (!cfg.enabled || !text) return text;
  const source = cfg.source || sourceForProvider(provider);

  return text.replace(URL_RE, (match) => {
    // Peel trailing punctuation back off the match.
    let url = match;
    let trailing = "";
    while (url.length > 0 && /[.,;:!?]$/.test(url)) {
      trailing = url.slice(-1) + trailing;
      url = url.slice(0, -1);
    }
    try {
      const parsed = new URL(url);
      // Never touch a link that is already tagged.
      for (const key of parsed.searchParams.keys()) {
        if (key.toLowerCase().startsWith("utm_")) return match;
      }
      parsed.searchParams.set("utm_source", source);
      if (cfg.medium) parsed.searchParams.set("utm_medium", cfg.medium);
      if (cfg.campaign) parsed.searchParams.set("utm_campaign", cfg.campaign);
      return parsed.toString() + trailing;
    } catch {
      return match; // unparseable — leave the author's text untouched
    }
  });
}

