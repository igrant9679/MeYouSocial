/**
 * Branded frames on post images (2026-11-23, the owner's "I'd like posts to be able to be branded with
 * head/footer/etc." with four of LSI's, CommunityForce's and EDG's own designed posts attached).
 *
 * The model paints the picture and NEVER any text (lib/social/image-prompt.ts). The frame is typeset by Publisher
 * on top of it (lib/images/social-frame.ts): a headline, the logo, the @handle, the networks' icons and the web
 * address, in the brand's colours — so a name or an address can never come out misspelled or invented.
 *
 * Plain data and string helpers only: the Brand page and the composer ship this to the browser.
 */

export type FrameLayout = "off" | "footer" | "headline" | "bands";

export const FRAME_KEY = "social:frame";
/** "@LSIMedia" — blank = derived from the connected accounts' usernames. */
export const FRAME_HANDLE_KEY = "social:frame_handle";
/** "www.lsi-media.com" — blank = the connected WordPress site's address. */
export const FRAME_WEBSITE_KEY = "social:frame_website";
/** "false" = no network icons in the footer. Absent = shown. */
export const FRAME_ICONS_KEY = "social:frame_icons";
export const FRAME_SETTING_KEYS = [FRAME_KEY, FRAME_HANDLE_KEY, FRAME_WEBSITE_KEY, FRAME_ICONS_KEY] as const;

export const FRAME_LAYOUTS: Array<{ id: FrameLayout; label: string; blurb: string }> = [
  { id: "off", label: "No frame", blurb: "The picture alone, as until now." },
  { id: "footer", label: "Footer", blurb: "A brand-colour strip along the bottom: logo, @handle, network icons, website." },
  { id: "headline", label: "Headline + footer", blurb: "A short headline over the top of the picture, and the footer strip." },
  { id: "bands", label: "Headline band", blurb: "A solid brand-colour band with the headline, the picture below it, and the footer strip." },
];

export function parseFrameLayout(v: unknown): FrameLayout {
  return v === "footer" || v === "headline" || v === "bands" ? v : "off";
}

export function frameLabel(v: FrameLayout): string {
  return FRAME_LAYOUTS.find((l) => l.id === v)?.label ?? "No frame";
}

/** The layouts that carry a headline. */
export function frameHasHeadline(v: FrameLayout): boolean {
  return v === "headline" || v === "bands";
}

/** The longest headline the frame sets: three lines at the frame's size. */
export const HEADLINE_MAX = 70;

/**
 * A handle typed by a person, cleaned: one leading "@", no spaces, no URL. Null when nothing usable is left.
 * "LSI Media" is refused rather than becoming "@LSIMedia" — a handle that doesn't exist is worse than none.
 */
export function cleanHandle(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim().replace(/^@+/, "");
  if (!s || /\s/.test(s) || /[/:]/.test(s) || s.length > 40) return null;
  return `@${s}`;
}

/**
 * The handle the connected accounts share: the username most of them use (case-insensitively), as the most
 * common spelling. Numeric ids and usernames with spaces are skipped. Null when there's no username.
 */
export function handleFromAccounts(accounts: ReadonlyArray<{ username?: string | null }>): string | null {
  const counts = new Map<string, { n: number; spellings: Map<string, number> }>();
  for (const a of accounts) {
    const u = String(a.username ?? "").trim().replace(/^@+/, "");
    if (!u || /\s/.test(u) || /^\d+$/.test(u) || u.length > 40) continue;
    const k = u.toLowerCase();
    const row = counts.get(k) ?? { n: 0, spellings: new Map() };
    row.n++;
    row.spellings.set(u, (row.spellings.get(u) ?? 0) + 1);
    counts.set(k, row);
  }
  let best: { n: number; spellings: Map<string, number> } | null = null;
  for (const row of counts.values()) if (!best || row.n > best.n) best = row;
  if (!best) return null;
  const spelling = [...best.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return `@${spelling}`;
}

/**
 * A web address as a footer shows it: the host (and a short path, if one was given), no scheme, no trailing slash.
 * "https://www.lsi-media.com/" → "www.lsi-media.com". Null for anything that isn't an address.
 */
export function websiteLabel(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s || /\s/.test(s)) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!u.hostname.includes(".")) return null;
    const path = u.pathname.replace(/\/+$/, "");
    const label = `${u.hostname.toLowerCase()}${path.length > 1 && path.length <= 20 ? path : ""}`;
    return label.length <= 48 ? label : u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

// Emoji, pictographs, variation selectors and joiners: the server's fonts have none of them, and a headline is
// words. (Ranges, not \p{Extended_Pictographic}, so it compiles for every target.)
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0000}-\u{E007F}]/gu;

/**
 * A headline made safe to set: no links, hashtags, @mentions or emoji, quotes and a closing full stop gone, spaces
 * collapsed, cut at a word boundary to HEADLINE_MAX. Empty when nothing is left.
 */
export function cleanHeadline(raw: string | null | undefined): string {
  let s = String(raw ?? "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/(^|\s)[#@][\p{L}\p{N}_]+/gu, " ")
    .replace(EMOJI, " ")
    .replace(/[“”"«»]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^['‘’]+|['‘’]+$/g, "")
    .replace(/[.:;,–—-]+$/, "")
    .trim();
  if (s.length > HEADLINE_MAX) {
    const cut = s.slice(0, HEADLINE_MAX + 1);
    const at = cut.lastIndexOf(" ");
    s = (at > 20 ? cut.slice(0, at) : cut.slice(0, HEADLINE_MAX)).replace(/[.:;,–—-]+$/, "").trim();
  }
  return s;
}

/**
 * The headline taken from the post's own words, for when no model can write one: its first sentence (or line),
 * cleaned. Never a model's words — this is the fallback that can't invent anything.
 */
export function headlineFromText(text: string): string {
  const body = cleanHeadline(String(text ?? "").split(/\n+/).find((l) => cleanHeadline(l).length >= 3) ?? "");
  const first = body.match(/^(.{12,}?[.!?])(\s|$)/)?.[1] ?? body;
  return cleanHeadline(first);
}
