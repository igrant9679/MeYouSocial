import { getSetting } from "@/lib/settings";
import { applyUtm, UTM_DEFAULTS, type UtmConfig } from "@/lib/social/utm-apply";

export { applyUtm, sourceForProvider, UTM_DEFAULTS, type UtmConfig } from "@/lib/social/utm-apply";

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

/**
 * Convenience for the publish path: resolve config then tag.
 *
 * `campaignOverride` is the post's Campaign.utmCampaign — a campaign's own tag
 * beats the workspace-wide one so a series is attributable as a series. Empty
 * or absent falls back to the workspace setting, exactly like every other
 * setting resolution in this codebase.
 */
export async function tagLinksForNetwork(
  text: string,
  workspaceId: string,
  provider: string,
  campaignOverride?: string | null,
): Promise<string> {
  const cfg = await getUtmConfig(workspaceId);
  const campaign = (campaignOverride ?? "").trim();
  return applyUtm(text, campaign ? { ...cfg, campaign } : cfg, provider);
}
