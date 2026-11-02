/**
 * How an article's title and description will look in a Google result
 * (E-ART-06). Google cuts by rendered width, not characters: about 600px of a
 * 20px title and about 920px of a 14px description on desktop. Widths here use
 * Arial's metrics (the same as Helvetica's), so the cut is an estimate — the
 * page says so, and Google may rewrite a title entirely. Import-free: the
 * preview runs in the browser as the fields are typed.
 */

// Advance widths in 1/1000 em for printable ASCII, from the Helvetica/Arial
// metrics; anything else counts as an average lowercase letter.
const W: Record<string, number> = {
  " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667, "'": 191, "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556, "8": 556, "9": 556, ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  "[": 278, "\\": 278, "]": 278, "^": 469, _: 556, "`": 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  "{": 334, "|": 260, "}": 334, "~": 584, "…": 1000, "–": 556, "—": 1000, "’": 222, "‘": 222, "“": 333, "”": 333,
};
const AVG = 556;

export const SERP = { titlePx: 20, titleMax: 600, descPx: 14, descMax: 920, ellipsis: " ..." } as const;

/** Rendered width in pixels of `s` at `px` font size. */
export function textWidth(s: string, px: number): number {
  let units = 0;
  for (const ch of s) units += W[ch] ?? AVG;
  return Math.round((units * px) / 1000);
}

export type Fitted = { text: string; cut: boolean; width: number };

/** The text as shown within `max` pixels: whole words, then " ..." when it doesn't fit. */
export function fitWidth(raw: string, px: number, max: number): Fitted {
  const s = raw.replace(/\s+/g, " ").trim();
  const width = textWidth(s, px);
  if (width <= max) return { text: s, cut: false, width };
  const room = max - textWidth(SERP.ellipsis, px);
  let out = "";
  for (const word of s.split(" ")) {
    const next = out ? `${out} ${word}` : word;
    if (textWidth(next, px) > room) break;
    out = next;
  }
  // One word longer than the whole line: cut it by characters.
  if (!out) for (const ch of s) { if (textWidth(out + ch, px) > room) break; out += ch; }
  return { text: out.replace(/[\s,;:–—-]+$/, "") + SERP.ellipsis, cut: true, width };
}

/** "example.com › blog › my-post" from a site address and a slug. */
export function breadcrumb(site: string | null, slug: string | null): string {
  let host = "your-site";
  let parts: string[] = [];
  try {
    if (site) {
      const u = new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`);
      host = u.hostname.replace(/^www\./, "");
      parts = u.pathname.split("/").filter(Boolean);
    }
  } catch { /* not a URL — keep the placeholder */ }
  const tail = (slug ?? "").replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  return [host, ...parts, ...tail].join(" › ");
}
