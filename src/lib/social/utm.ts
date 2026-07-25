import { getSetting } from "@/lib/settings";

/**
 * UTM tagging for social links.
 *
 * The point is attribution: without it, every click from every network lands in
 * GA4 as undifferentiated referral traffic, so the analytics sync can tell you a
 * page got sessions but never that LinkedIn out-pulled X. Tagging at publish
 * time — per network — is what makes the social side measurable by the same
 * spine that measures the blog.
 *
 * Rules that keep this safe to run on real posts:
 *   - a link that ALREADY carries any utm_* param is left completely alone
 *     (someone tagged it deliberately; we must not fight them),
 *   - only http(s) links are touched,
 *   - existing query strings and fragments are preserved,
 *   - if anything about a URL fails to parse, the original text is kept.
 */

export type UtmConfig = {
  enabled: boolean;
  source: string; // "" = use the network name (linkedin / x / instagram)
  medium: string;
  campaign: string;
};

export const UTM_DEFAULTS: UtmConfig = { enabled: false, source: "", medium: "social", campaign: "" };

export async function getUtmConfig(workspaceId?: string | null): Promise<UtmConfig> {
  const [enabled, source, medium, campaign] = await Promise.all([
    getSetting("social:utm_enabled", workspaceId).catch(() => ""),
    getSetting("social:utm_source", workspaceId).catch(() => ""),
    getSetting("social:utm_medium", workspaceId).catch(() => ""),
    getSetting("social:utm_campaign", workspaceId).catch(() => ""),
  ]);
  return {
    enabled: enabled === "true",
    source: (source ?? "").trim(),
    medium: (medium ?? "").trim() || UTM_DEFAULTS.medium,
    campaign: (campaign ?? "").trim(),
  };
}

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

/** Convenience for the publish path: resolve config then tag. */
export async function tagLinksForNetwork(text: string, workspaceId: string, provider: string): Promise<string> {
  const cfg = await getUtmConfig(workspaceId);
  return applyUtm(text, cfg, provider);
}
