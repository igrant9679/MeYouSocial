import { ZERNIO_PLATFORMS, platformFor, type ZernioPlatform } from "@/lib/zernio";

/**
 * The networks the social scheduler can target.
 *
 * Since 2026-07-26 this is a view over Zernio's platform list — the single
 * source of truth for what can actually be posted to. It used to be a
 * hand-maintained set of three (LinkedIn, X, Instagram), which was all Unipile
 * still supported; Zernio covers fifteen including Facebook and Twitter/X,
 * which is why the integration moved.
 *
 * `provider` holds the Zernio slug and is LOWERCASE (`twitter`, not `X`).
 * Anything comparing providers must be case-insensitive: SocialPostTarget rows
 * written before the migration hold uppercase Unipile names.
 */

export type Network = {
  /** Zernio platform slug — what goes in platforms[].platform. */
  provider: string;
  label: string;
  charLimit: number;
  requiresMedia?: boolean;
  color: string;
};

function toNetwork(p: ZernioPlatform): Network {
  return { provider: p.slug, label: p.label, charLimit: p.charLimit, requiresMedia: p.requiresMedia, color: p.color };
}

export const NETWORKS: Network[] = ZERNIO_PLATFORMS.map(toNetwork);

/** Legacy Unipile spellings → Zernio slugs, so pre-migration history still
 *  renders with a proper label and colour instead of a bare uppercase string. */
const LEGACY: Record<string, string> = { x: "twitter", "twitter/x": "twitter" };

export function networkFor(provider: string): Network | undefined {
  const key = provider.trim().toLowerCase();
  const p = platformFor(key) ?? (LEGACY[key] ? platformFor(LEGACY[key]) : undefined);
  return p ? toNetwork(p) : undefined;
}

/** The tightest char limit among the chosen providers — what the composer warns against. */
export function tightestLimit(providers: string[]): number {
  const limits = providers.map((p) => networkFor(p)?.charLimit).filter((n): n is number => typeof n === "number");
  return limits.length ? Math.min(...limits) : 3000;
}
