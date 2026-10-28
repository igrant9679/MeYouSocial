// The networks Zernio posts to, with no client code — safe in the browser.
// ⚠ PRF-03: lib/social/networks imported these from lib/zernio, which pulls
// in node:crypto (webhook signatures) and the settings/database layer, so
// every page with the composer or calendar shipped a ~500 KB crypto
// polyfill, twice. Keep this file free of imports.

export type ZernioPlatform = {
  /** The exact slug the API uses, in the connect path and platforms[].platform. */
  slug: string;
  label: string;
  /** Post-text ceiling. These are the PLATFORMS' own published limits, not
   *  Zernio's — its docs don't state them, so treat as best-effort guidance for
   *  the composer's counter rather than something the API enforces. */
  charLimit: number;
  requiresMedia?: boolean;
  /** Takes a video and nothing else (YouTube). The app attaches images only, so
   *  such a leg can't succeed until video upload exists (SOC-13). */
  requiresVideo?: boolean;
  color: string;
};

export const ZERNIO_PLATFORMS: ZernioPlatform[] = [
  { slug: "linkedin", label: "LinkedIn", charLimit: 3000, color: "#0A66C2" },
  { slug: "twitter", label: "X (Twitter)", charLimit: 280, color: "#111111" },
  { slug: "facebook", label: "Facebook", charLimit: 63206, color: "#1877F2" },
  { slug: "instagram", label: "Instagram", charLimit: 2200, requiresMedia: true, color: "#E1306C" },
  { slug: "threads", label: "Threads", charLimit: 500, color: "#000000" },
  { slug: "bluesky", label: "Bluesky", charLimit: 300, color: "#0285FF" },
  { slug: "tiktok", label: "TikTok", charLimit: 2200, requiresMedia: true, color: "#010101" },
  { slug: "youtube", label: "YouTube", charLimit: 5000, requiresMedia: true, requiresVideo: true, color: "#FF0000" },
  { slug: "pinterest", label: "Pinterest", charLimit: 500, requiresMedia: true, color: "#E60023" },
  { slug: "reddit", label: "Reddit", charLimit: 40000, color: "#FF4500" },
  { slug: "googlebusiness", label: "Google Business", charLimit: 1500, color: "#4285F4" },
  { slug: "telegram", label: "Telegram", charLimit: 4096, color: "#26A5E4" },
  { slug: "snapchat", label: "Snapchat", charLimit: 250, requiresMedia: true, color: "#FFFC00" },
  { slug: "whatsapp", label: "WhatsApp", charLimit: 4096, color: "#25D366" },
  { slug: "discord", label: "Discord", charLimit: 2000, color: "#5865F2" },
];

export function platformFor(slug: string): ZernioPlatform | undefined {
  return ZERNIO_PLATFORMS.find((p) => p.slug === slug.toLowerCase());
}
