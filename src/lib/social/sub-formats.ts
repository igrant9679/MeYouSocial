/**
 * Publishing a post as a Story or a Reel rather than a feed post.
 *
 * ⚠ THIS IS MUCH SMALLER THAN THE INDUSTRY MAKES IT SOUND. Competitors sell
 * "Reels, Stories and Shorts as separate destinations". In Zernio's API only
 * two networks take an explicit choice at all; the rest infer the format from
 * the media you attach. Taken from each platform's own documentation page on
 * 2026-08-09, not from the shape of a request Zernio happened to accept:
 *
 *   Facebook   contentType: "story" | "reel" — "Defaults to feed post if
 *              omitted." A Reel may also carry its own `title`, separate from
 *              the caption.
 *   Instagram  contentType: "story" only — "No contentType field is needed:
 *              feed is the default", and "Default posts become Reels or feed
 *              depending on media." So Reel-vs-feed is Instagram's call, and
 *              `shareToFeed` (default true) decides whether a Reel also lands
 *              on the profile grid.
 *   YouTube    NOTHING TO CHOOSE — "Shorts are auto-detected from duration and
 *              aspect ratio (not a separate post type)."
 *   TikTok     NOTHING TO CHOOSE — video vs photo carousel follows the media.
 *
 * ⚠ Zernio stores unknown keys in `platformSpecificData` without complaint —
 * an early probe sent `postType: "reel"` and got it echoed back happily, which
 * would have shipped a picker that silently did nothing. `contentType` is the
 * field the API actually reads. Same family of trap as `content` vs
 * `customContent`; only the documentation settled it.
 */

export type SubFormatOption = {
  /** Stored on SocialPostTarget.subFormat. Empty string = the network's default. */
  value: string;
  label: string;
  hint: string;
  /** Refuse to send this without media — a Story or Reel cannot be text. */
  requiresMedia: boolean;
  /** Reels are video; an image-only Reel is rejected by the network. */
  requiresVideo?: boolean;
};

export const SUB_FORMATS: Record<string, SubFormatOption[]> = {
  facebook: [
    { value: "", label: "Feed post", hint: "The default — a normal Page post.", requiresMedia: false },
    { value: "story", label: "Story", hint: "Page Story, disappears after 24 hours.", requiresMedia: true },
    { value: "reel", label: "Reel", hint: "Short vertical video. Needs a video, not an image.", requiresMedia: true, requiresVideo: true },
  ],
  instagram: [
    {
      value: "",
      label: "Feed or Reel (automatic)",
      hint: "Instagram decides from the media: a video becomes a Reel, an image goes to the feed.",
      requiresMedia: true,
    },
    { value: "story", label: "Story", hint: "Disappears after 24 hours.", requiresMedia: true },
  ],
};

/** Networks where the format follows the media and there is nothing to pick. */
export const AUTOMATIC_SUB_FORMAT: Record<string, string> = {
  youtube: "YouTube detects Shorts from a video's duration and aspect ratio — it isn't a separate post type.",
  tiktok: "TikTok decides between a video and a photo carousel from the media you attach.",
};

export function subFormatsFor(provider: string): SubFormatOption[] {
  return SUB_FORMATS[provider.trim().toLowerCase()] ?? [];
}

export function subFormatLabel(provider: string, value: string | null): string | null {
  if (!value) return null;
  return subFormatsFor(provider).find((o) => o.value === value)?.label ?? value;
}

/** Only values the network actually accepts survive a round-trip through here. */
export function normaliseSubFormat(provider: string, value: string | null | undefined): string | null {
  const v = String(value ?? "").trim();
  if (!v) return null;
  return subFormatsFor(provider).some((o) => o.value === v) ? v : null;
}

/**
 * The `platformSpecificData` object for one target, or null when the network's
 * default is wanted. Kept here so the publish path never hand-builds it.
 */
export function platformDataFor(provider: string, subFormat: string | null): Record<string, unknown> | null {
  const v = normaliseSubFormat(provider, subFormat);
  if (!v) return null;
  return { contentType: v };
}
