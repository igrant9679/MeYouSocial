import { readJson } from "@/lib/db/json";
import { normaliseSubFormat } from "@/lib/social/sub-formats";

/**
 * Per-network posting options beyond text and media — the Socialmonials
 * composer's per-network cards (2026-10-17). One place builds Zernio's
 * `platformSpecificData`, because Zernio STORES UNKNOWN KEYS WITHOUT
 * COMPLAINT (see zernio/index.ts): a misspelt field does nothing and returns
 * a clean 201. Every field emitted here is one Zernio documents:
 *
 *   firstComment   facebook, instagram, linkedin, youtube — docs.zernio.com/
 *                  platforms/<network>. Not Stories (FB/IG say so). Not X or
 *                  TikTok (no such field documented).
 *   tiktokSettings tiktok — privacy_level, allow_comment, allow_duet,
 *                  allow_stitch, video_made_with_ai, commercialContentType,
 *                  draft, content_preview_confirmed, express_consent_given.
 *                  A per-entry `platformSpecificData.tiktokSettings`
 *                  overrides the request root, so it lives per target here.
 *   contentType    story | reel — via social/sub-formats.ts, as before.
 */

/** Networks Zernio documents a first comment for. */
export const FIRST_COMMENT_NETWORKS = new Set(["facebook", "instagram", "linkedin", "youtube"]);

export function supportsFirstComment(provider: string, subFormat?: string | null): boolean {
  const p = provider.trim().toLowerCase();
  if (!FIRST_COMMENT_NETWORKS.has(p)) return false;
  // Facebook and Instagram both document "not Stories".
  return normaliseSubFormat(p, subFormat ?? null) !== "story";
}

// ── TikTok ─────────────────────────────────────────────────────────────────

export const TIKTOK_PRIVACY = [
  { value: "PUBLIC_TO_EVERYONE", label: "Everyone" },
  { value: "MUTUAL_FOLLOW_FRIENDS", label: "Friends (mutual followers)" },
  { value: "FOLLOWER_OF_CREATOR", label: "Followers" },
  { value: "SELF_ONLY", label: "Only me" },
] as const;
export type TikTokPrivacy = (typeof TIKTOK_PRIVACY)[number]["value"];

export const TIKTOK_COMMERCIAL = [
  { value: "none", label: "Not commercial" },
  { value: "brand_organic", label: "Your own brand" },
  { value: "brand_content", label: "Branded content (a paid partnership)" },
] as const;
export type TikTokCommercial = (typeof TIKTOK_COMMERCIAL)[number]["value"];

export type TikTokOptions = {
  /** Null = not chosen. TikTok's rules: no default; the person picks. */
  privacy: TikTokPrivacy | null;
  allowComment: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  aiGenerated: boolean;
  commercial: TikTokCommercial;
  /** Send to the creator's TikTok inbox to finish in the app, instead of publishing. */
  draft: boolean;
};

export const TIKTOK_DEFAULTS: TikTokOptions = {
  privacy: null,
  allowComment: false,
  allowDuet: false,
  allowStitch: false,
  aiGenerated: false,
  commercial: "none",
  draft: false,
};

export type TargetOptions = { tiktok?: TikTokOptions };

export function readTargetOptions(raw: string | null | undefined): TargetOptions {
  const o = readJson<TargetOptions>(raw, {});
  return o && typeof o === "object" ? o : {};
}

/** The composer's tiktok_* fields for one provider (UPPERCASED slug), or null when absent. */
export function tiktokOptionsFromForm(formData: FormData, providerUpper: string): TikTokOptions | null {
  const k = (n: string) => `tiktok_${n}_${providerUpper}`;
  if (formData.get(k("present")) == null) return null;
  const privacyRaw = String(formData.get(k("privacy")) ?? "");
  const privacy = (TIKTOK_PRIVACY.find((p) => p.value === privacyRaw)?.value ?? null) as TikTokPrivacy | null;
  const commercialRaw = String(formData.get(k("commercial")) ?? "none");
  const commercial = (TIKTOK_COMMERCIAL.find((c) => c.value === commercialRaw)?.value ?? "none") as TikTokCommercial;
  const on = (n: string) => String(formData.get(k(n)) ?? "") === "on";
  return {
    privacy,
    allowComment: on("comment"),
    allowDuet: on("duet"),
    allowStitch: on("stitch"),
    aiGenerated: on("ai"),
    commercial,
    draft: on("draft"),
  };
}

/**
 * Why a TikTok target cannot SEND as configured, or null when it can. Drafts
 * (in our app) are exempt — they can be finished later.
 */
export function tiktokRefusal(o: TikTokOptions | undefined | null): string | null {
  if (!o) return "TikTok needs its posting options — choose who can view the video.";
  if (!o.privacy) return "Choose who can view the TikTok video — TikTok requires a deliberate choice, there is no default.";
  if (o.commercial === "brand_content" && o.privacy === "SELF_ONLY") {
    return "Branded content can't be posted as “Only me” on TikTok — pick a wider audience or untick branded content.";
  }
  return null;
}

function tiktokSettings(o: TikTokOptions, isVideo: boolean): Record<string, unknown> {
  return {
    privacy_level: o.privacy,
    allow_comment: o.allowComment,
    // Duet and stitch do not apply to photo carousels.
    ...(isVideo ? { allow_duet: o.allowDuet, allow_stitch: o.allowStitch } : {}),
    // "Direct photo posts reject true" — only send the disclosure for video.
    ...(isVideo && o.aiGenerated ? { video_made_with_ai: true } : {}),
    commercialContentType: o.commercial,
    ...(o.draft ? { draft: true } : {}),
    // TikTok legal requirements, both must be true. They are true because the
    // composer shows TikTok's declaration beside the TikTok card and the
    // person chose to send with it.
    content_preview_confirmed: true,
    express_consent_given: true,
  };
}

/**
 * The whole `platformSpecificData` for one target, or null when the network's
 * defaults are wanted. The ONLY builder — publish.ts never hand-assembles it.
 */
export function buildPlatformData(input: {
  provider: string;
  subFormat: string | null;
  firstComment: string | null;
  options: TargetOptions;
  /** True when every media item this target sends is a video. */
  isVideo: boolean;
}): Record<string, unknown> | null {
  const p = input.provider.trim().toLowerCase();
  const out: Record<string, unknown> = {};
  const sf = normaliseSubFormat(p, input.subFormat);
  if (sf) out.contentType = sf;
  const fc = (input.firstComment ?? "").trim();
  if (fc && supportsFirstComment(p, sf)) out.firstComment = fc.slice(0, 2000);
  if (p === "tiktok" && input.options.tiktok) out.tiktokSettings = tiktokSettings(input.options.tiktok, input.isVideo);
  return Object.keys(out).length ? out : null;
}

// ── Links → first comment ───────────────────────────────────────────────────

const URL_RE = /\bhttps?:\/\/[^\s<>"')]+[^\s<>"').,;:!?]/gi;

/**
 * Take the links out of a caption and hand them to the first comment.
 * Returns the caption without them (blank lines tidied) and the links, in
 * order, de-duplicated. A caption with no links comes back unchanged.
 */
export function splitLinks(text: string): { caption: string; links: string[] } {
  const links = [...new Set(text.match(URL_RE) ?? [])];
  if (links.length === 0) return { caption: text, links: [] };
  const caption = text
    .replace(URL_RE, "")
    // "See https://x.com/a. Then…" must not leave "See . Then…" behind.
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { caption, links };
}
