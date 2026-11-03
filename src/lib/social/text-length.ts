/**
 * How long a post is, the way its network counts (E-SOC-09). Most networks
 * count characters; X counts WEIGHTED characters: every link is 23 however long
 * it is, most Latin text weighs 1, and CJK, most other scripts and emoji weigh 2
 * — the 280 limit is 560 weight units. Counting X with `.length` refused a
 * short post with a long link and passed a CJK post X then rejected.
 *
 * Pure, so the composer's counter and the send-time check (lib/social/
 * validate.ts) are the same arithmetic.
 */

export const X_URL_LENGTH = 23;
const URL_RE = /https?:\/\/[^\s<>()[\]{}"']+/g;

/** twitter-text v3's weight-100 ranges; everything else weighs 200. */
const LIGHT: Array<[number, number]> = [[0x0000, 0x10ff], [0x2000, 0x200d], [0x2010, 0x201f], [0x2032, 0x2037]];
const isLight = (cp: number) => LIGHT.some(([a, b]) => cp >= a && cp <= b);
const EMOJI = /\p{Extended_Pictographic}/u;

/** X's weighted length: links as 23, then per grapheme — an emoji 2, else its code points' weights. */
export function xWeightedLength(text: string): number {
  let units = 0;
  // NFC first, as X does: an accent typed as a combining mark weighs as its letter.
  const withoutLinks = text.normalize("NFC").replace(URL_RE, () => {
    units += X_URL_LENGTH * 100;
    return "";
  });
  const graphemes = typeof Intl !== "undefined" && "Segmenter" in Intl
    ? Array.from(new Intl.Segmenter("en", { granularity: "grapheme" }).segment(withoutLinks), (s) => s.segment)
    : Array.from(withoutLinks);
  for (const g of graphemes) {
    if (EMOJI.test(g)) { units += 200; continue; }
    for (const ch of g) units += isLight(ch.codePointAt(0)!) ? 100 : 200;
  }
  return Math.ceil(units / 100);
}

const isX = (provider: string) => ["twitter", "x"].includes(provider.trim().toLowerCase());

/** The length a network judges `text` by. */
export function postLength(provider: string, text: string): number {
  return isX(provider) ? xWeightedLength(text) : text.length;
}

/** A short note on how the count was made, for the networks that don't count plainly. */
export function lengthNote(provider: string): string | null {
  return isX(provider) ? `X counts each link as ${X_URL_LENGTH}, and emoji and most non-Latin letters as 2` : null;
}
