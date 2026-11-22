/**
 * How each network draws a post — for the composer's "Preview as posted" (2026-11-21, the owner: "click to preview it
 * so I see exactly what it looks like as posted on the social account").
 *
 * Facts about each network's feed, as data: its colours and type, where a long caption folds behind "more", whether a
 * link in the caption is tappable and how it is written, whether a bare link turns into a card, the shapes pictures
 * are cropped to, and the buttons under a post. One entry per network, so a redesign is one entry to change — and kept
 * out of .tsx, where raw colours are refused (scripts/check-type-colors.mts): these are the networks' colours, not the
 * app's, and must not follow the app's theme.
 *
 * Pure: the tokenizer and the fold are shared with nothing that sends, so a change here can't alter what is posted —
 * the preview is always handed the text AS SENT (SocialComposer `sendFor`, links tagged, first comment split out).
 */

export type SkinLayout = "feed" | "vertical" | "pin" | "video" | "chat" | "reddit" | "business";

export type Skin = {
  /** The network's own name for the tab and the footnote. */
  label: string;
  layout: SkinLayout;
  /** Page, text, secondary text, hairlines, a tappable link, a hashtag or @mention. */
  bg: string;
  ink: string;
  mute: string;
  line: string;
  link: string;
  tag: string;
  /** A second surface: the link card's band, a chat bubble, a button. */
  panel: string;
  font: string;
  /** The caption's size in the feed, in px (the networks' own, not the app's type scale). */
  size?: number;
  avatar: "circle" | "square";
  /**
   * The caption folds after this many characters or lines, whichever comes first, behind `more` (tapping it opens the
   * rest, as on the network). Null: the network shows the whole caption.
   */
  fold: { chars: number; lines: number; more: string } | null;
  /** Links in the caption are tappable and coloured. False on Instagram, TikTok, Pinterest and Snapchat: plain text. */
  linksLive: boolean;
  /** X writes a link without its scheme and cuts it after 23 characters ("example.com/a-long-pa…"). */
  shortLinks?: boolean;
  /** Hashtags are drawn bold (TikTok, LinkedIn). */
  tagsBold?: boolean;
  /** Threads makes only the post's FIRST hashtag a topic tag; later ones stay plain text. */
  firstTagOnly?: boolean;
  /**
   * A bare link (no picture or video attached) becomes a card with the page's picture and title. "maybe": the network
   * shows one only when the app that sends the post builds it (Bluesky). Checked 2026-11-22: Zernio's OpenAPI spec
   * (zernio.com/openapi.yaml) says link previews are generated for LinkedIn (`disableLinkPreview`, "auto-generated when
   * no media is attached"), Facebook and Telegram, and its BlueskyPlatformData and docs.zernio.com/platforms/bluesky
   * say nothing about cards or facets. Only a real post to a connected Bluesky account would settle it.
   */
  linkCard: "yes" | "no" | "maybe";
  /** The shapes a picture is cropped to in the feed, as width ÷ height: [tallest, widest]. */
  aspect: [number, number];
  /** Several pictures: a grid in the post, or a carousel showing one with dots. */
  multi: "grid" | "carousel";
  /** How the network writes the time of a post just made. */
  when: string;
  /** How a handle is written under the name, or null where the feed shows none. */
  handle: "@" | "u/" | null;
};

const SYSTEM = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const SKINS: Record<string, Skin> = {
  twitter: {
    label: "X", layout: "feed",
    bg: "#FFFFFF", ink: "#0F1419", mute: "#536471", line: "#EFF3F4", link: "#1D9BF0", tag: "#1D9BF0", panel: "#F7F9F9",
    font: SYSTEM, avatar: "circle", fold: null, linksLive: true, shortLinks: true,
    linkCard: "yes", aspect: [0.75, 1.91], multi: "grid", when: "now", handle: "@",
  },
  linkedin: {
    label: "LinkedIn", layout: "feed",
    bg: "#FFFFFF", ink: "#191919", mute: "#666666", line: "#E8E8E8", link: "#0A66C2", tag: "#0A66C2", panel: "#EEF3F8",
    font: "-apple-system, system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', 'Fira Sans', Ubuntu, Oxygen, Cantarell, Helvetica, Arial, sans-serif",
    avatar: "square", fold: { chars: 210, lines: 3, more: "…more" }, linksLive: true, tagsBold: true,
    linkCard: "yes", aspect: [0.8, 1.91], multi: "grid", when: "Now", handle: null,
  },
  facebook: {
    label: "Facebook", layout: "feed",
    bg: "#FFFFFF", ink: "#050505", mute: "#65676B", line: "#CED0D4", link: "#0064D1", tag: "#0064D1", panel: "#F0F2F5",
    font: "'Segoe UI Historic', 'Segoe UI', Helvetica, Arial, sans-serif",
    avatar: "circle", fold: { chars: 280, lines: 5, more: "See more" }, linksLive: true,
    linkCard: "yes", aspect: [0.8, 1.91], multi: "grid", when: "Just now", handle: null,
  },
  instagram: {
    label: "Instagram", layout: "feed",
    bg: "#FFFFFF", ink: "#000000", mute: "#737373", line: "#DBDBDB", link: "#000000", tag: "#00376B", panel: "#EFEFEF",
    font: SYSTEM, avatar: "circle", fold: { chars: 125, lines: 2, more: "more" }, linksLive: false,
    linkCard: "no", aspect: [0.8, 1.91], multi: "carousel", when: "Just now", handle: null,
  },
  threads: {
    label: "Threads", layout: "feed",
    bg: "#FFFFFF", ink: "#000000", mute: "#999999", line: "#E5E5E5", link: "#0095F6", tag: "#0095F6", panel: "#F5F5F5",
    font: SYSTEM, avatar: "circle", fold: null, linksLive: true, firstTagOnly: true,
    linkCard: "yes", aspect: [0.75, 1.91], multi: "carousel", when: "now", handle: null,
  },
  bluesky: {
    label: "Bluesky", layout: "feed",
    bg: "#FFFFFF", ink: "#0B0F14", mute: "#6F869F", line: "#D4DBE2", link: "#1083FE", tag: "#1083FE", panel: "#F1F3F5",
    font: "InterVariable, Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    avatar: "circle", fold: null, linksLive: true,
    linkCard: "maybe", aspect: [0.75, 1.91], multi: "grid", when: "now", handle: "@",
  },
  tiktok: {
    label: "TikTok", layout: "vertical",
    bg: "#000000", ink: "#FFFFFF", mute: "#D0D0D0", line: "#333333", link: "#FFFFFF", tag: "#FFFFFF", panel: "#FE2C55",
    font: "'TikTok Sans', 'Proxima Nova', Arial, Tahoma, sans-serif",
    avatar: "circle", fold: { chars: 70, lines: 2, more: "more" }, linksLive: false, tagsBold: true,
    linkCard: "no", aspect: [0.5625, 0.5625], multi: "carousel", when: "", handle: "@",
  },
  youtube: {
    label: "YouTube", layout: "video",
    bg: "#FFFFFF", ink: "#0F0F0F", mute: "#606060", line: "#E5E5E5", link: "#065FD4", tag: "#065FD4", panel: "#F2F2F2",
    font: "Roboto, Arial, sans-serif", avatar: "circle", fold: { chars: 150, lines: 2, more: "...more" }, linksLive: true,
    linkCard: "no", aspect: [1.7778, 1.7778], multi: "carousel", when: "Just now", handle: "@",
  },
  pinterest: {
    label: "Pinterest", layout: "pin",
    bg: "#FFFFFF", ink: "#111111", mute: "#767676", line: "#EFEFEF", link: "#111111", tag: "#111111", panel: "#E60023",
    font: SYSTEM, avatar: "circle", fold: { chars: 160, lines: 3, more: "more" }, linksLive: false,
    linkCard: "no", aspect: [0.5, 1.25], multi: "carousel", when: "", handle: null,
  },
  reddit: {
    label: "Reddit", layout: "reddit",
    bg: "#FFFFFF", ink: "#1A1A1B", mute: "#576F76", line: "#EDEFF1", link: "#0079D3", tag: "#1A1A1B", panel: "#EAEDEF",
    font: "'IBM Plex Sans', -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
    avatar: "circle", fold: { chars: 300, lines: 6, more: "Read more" }, linksLive: true,
    linkCard: "yes", aspect: [0.75, 1.91], multi: "carousel", when: "just now", handle: "u/",
  },
  googlebusiness: {
    label: "Google Business", layout: "business",
    bg: "#FFFFFF", ink: "#202124", mute: "#5F6368", line: "#DADCE0", link: "#1A73E8", tag: "#202124", panel: "#1A73E8",
    font: "Roboto, Arial, sans-serif", avatar: "circle", fold: { chars: 200, lines: 4, more: "More" }, linksLive: true,
    linkCard: "no", aspect: [1.333, 1.333], multi: "carousel", when: "Just now", handle: null,
  },
  telegram: {
    label: "Telegram", layout: "chat",
    bg: "#D6E2EA", ink: "#000000", mute: "#8B9BA8", line: "#E4E9ED", link: "#168ACD", tag: "#168ACD", panel: "#FFFFFF",
    font: "-apple-system, 'Segoe UI', Roboto, 'Open Sans', sans-serif", avatar: "circle", fold: null, linksLive: true,
    linkCard: "yes", aspect: [0.75, 1.91], multi: "grid", when: "now", handle: null,
  },
  whatsapp: {
    label: "WhatsApp", layout: "chat",
    bg: "#EFEAE2", ink: "#111B21", mute: "#667781", line: "#E9EDEF", link: "#027EB5", tag: "#111B21", panel: "#FFFFFF",
    font: "'Segoe UI', Helvetica, 'Helvetica Neue', Arial, sans-serif", avatar: "circle", fold: { chars: 700, lines: 14, more: "Read more" },
    linksLive: true, linkCard: "yes", aspect: [0.75, 1.91], multi: "grid", when: "now", handle: null,
  },
  discord: {
    label: "Discord", layout: "chat",
    bg: "#313338", ink: "#DBDEE1", mute: "#949BA4", line: "#3F4147", link: "#00A8FC", tag: "#DBDEE1", panel: "#2B2D31",
    font: "'gg sans', 'Noto Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif", avatar: "circle", fold: null, linksLive: true,
    linkCard: "yes", aspect: [0.75, 1.91], multi: "grid", when: "Today", handle: null,
  },
  snapchat: {
    label: "Snapchat", layout: "vertical",
    bg: "#000000", ink: "#FFFFFF", mute: "#D0D0D0", line: "#333333", link: "#FFFFFF", tag: "#FFFFFF", panel: "#FFFC00",
    font: "'Avenir Next', 'Helvetica Neue', Arial, sans-serif", avatar: "circle", fold: { chars: 80, lines: 2, more: "more" },
    linksLive: false, linkCard: "no", aspect: [0.5625, 0.5625], multi: "carousel", when: "", handle: null,
  },
};

/** Each network's caption size (px) on a phone. */
const TEXT_PX: Record<string, number> = {
  twitter: 15, linkedin: 14, facebook: 15, instagram: 14, threads: 15, bluesky: 15, tiktok: 14, youtube: 14,
  pinterest: 14, reddit: 14, googlebusiness: 14, telegram: 15, whatsapp: 14, discord: 16, snapchat: 14,
};
for (const [k, px] of Object.entries(TEXT_PX)) if (SKINS[k]) SKINS[k].size = px;

/** Legacy Unipile spellings → Zernio slugs (as lib/social/networks.ts). */
const LEGACY: Record<string, string> = { x: "twitter", "twitter/x": "twitter" };

/** The skin a provider is drawn with; an unknown network gets a plain feed card in Facebook's neutral colours. */
export function skinFor(provider: string): Skin {
  const key = provider.trim().toLowerCase();
  return SKINS[LEGACY[key] ?? key] ?? { ...SKINS.facebook, label: provider };
}

/** Story / Reel on Instagram and Facebook are full-screen vertical; a Story shows no caption at all. */
export function skinForFormat(provider: string, subFormat: string | null | undefined): Skin {
  const base = skinFor(provider);
  if (subFormat === "story" || subFormat === "reel") {
    return { ...base, layout: "vertical", bg: "#000000", ink: "#FFFFFF", mute: "#D0D0D0", line: "#333333", link: "#FFFFFF", tag: "#FFFFFF", aspect: [0.5625, 0.5625], multi: "carousel", fold: { chars: 70, lines: 2, more: "more" }, when: "" };
  }
  return base;
}

// ── The caption, as the network colours it ───────────────────────────────────

export type Part = { kind: "text" | "link" | "tag" | "mention"; text: string };

// A link ends before trailing sentence punctuation (the same rule as platform-options splitLinks); a hashtag or
// @mention starts a word. Letters and digits of any script count, as every network allows.
const TOKEN = /(\bhttps?:\/\/[^\s<>"')]+[^\s<>"').,;:!?])|((?<![\p{L}\p{N}_&/])#[\p{L}\p{N}_]*[\p{L}_][\p{L}\p{N}_]*)|((?<![\p{L}\p{N}_/.])@[A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?)/gu;

/** The caption split into plain text, links, hashtags and @mentions, in order. Joining every part's text gives the input back. */
export function richParts(text: string): Part[] {
  const out: Part[] = [];
  let at = 0;
  for (const m of text.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ kind: "text", text: text.slice(at, i) });
    out.push({ kind: m[1] ? "link" : m[2] ? "tag" : "mention", text: m[0] });
    at = i + m[0].length;
  }
  if (at < text.length) out.push({ kind: "text", text: text.slice(at) });
  return out;
}

/** How the network writes a link in the caption: X drops the scheme and "www." and cuts after 23 characters. */
export function displayLink(url: string, skin: Pick<Skin, "shortLinks">): string {
  if (!skin.shortLinks) return url;
  const bare = url.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  return bare.length > 23 ? `${bare.slice(0, 22)}…` : bare;
}

/** The first link in a caption, or null. */
export function firstLink(text: string): string | null {
  for (const p of richParts(text)) if (p.kind === "link") return p.text;
  return null;
}

/** "example.com" from a URL ("www." dropped), or the input when it isn't one. */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

/** A link with its tracking tags taken off, for reading the page's card (the tags matter at send, not here). */
export function untagged(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Where the network folds the caption: after `fold.chars` characters or `fold.lines` lines, whichever comes first,
 * backed up to the last space so a word isn't cut. Unfolded when the whole caption fits.
 */
export function foldCaption(text: string, fold: Skin["fold"]): { shown: string; folded: boolean } {
  if (!fold) return { shown: text, folded: false };
  let end = Math.min(text.length, fold.chars);
  let byLine = false;
  let nl = -1;
  for (let i = 0; i < fold.lines; i++) {
    nl = text.indexOf("\n", nl + 1);
    if (nl < 0) break;
  }
  if (nl >= 0 && nl < end) {
    end = nl;
    byLine = true;
  }
  if (end >= text.length) return { shown: text, folded: false };
  // A fold at a line break keeps the whole line; one by characters backs up to the last space.
  const space = byLine ? -1 : text.lastIndexOf(" ", end);
  const cut = space > end * 0.6 ? space : end;
  return { shown: text.slice(0, cut).replace(/\s+$/, ""), folded: true };
}

/**
 * The aspect a picture shows at in this feed: its own shape, held inside the network's [tallest, widest] range.
 * `natural` is width ÷ height (null until the picture has loaded — then the widest the network allows).
 */
export function feedAspect(natural: number | null, skin: Pick<Skin, "aspect">): number {
  const [tall, wide] = skin.aspect;
  if (natural == null || !Number.isFinite(natural) || natural <= 0) return wide;
  return Math.min(wide, Math.max(tall, natural));
}
