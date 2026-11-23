import type { FrameLayout } from "@/lib/social/frame";

/**
 * The branded frame on a post image — typeset by us, never painted by the model (2026-11-23, the owner's
 * "posts … branded with head/footer/etc.").
 *
 * Same reasoning as the article lockup (lib/images/lockup.ts): an image model can't spell a name it was only told,
 * and it invents logos. So the picture is rendered text-free and this draws the rest on top with sharp: a headline,
 * the real logo on a white chip, the @handle, the networks' icons and the web address, in the brand kit's colours.
 * Deterministic: the same inputs make the same frame on every render.
 *
 * Three layouts (lib/social/frame.ts): `footer` (a strip along the bottom), `headline` (the headline over a
 * colour wash at the top, plus the strip) and `bands` (a solid band with the headline, the picture below it,
 * plus the strip). The canvas keeps the picture's size, so a square stays square for Instagram.
 *
 * ⚠ Fonts: the SVG names Liberation Sans, which the Railway image installs (nixpacks.toml fonts-liberation) and
 * which has Arial's metrics — so the width table below wraps headlines correctly there and on a machine with Arial.
 * The brand kit's heading font is not installed on the server, so it is not used. Emoji are stripped before this
 * (lib/social/frame.ts cleanHeadline): the server has no emoji font.
 */

export type FrameInput = {
  layout: Exclude<FrameLayout, "off">;
  /** Required by `headline` and `bands`; without one they fall back to `footer`. */
  headline: string | null;
  brandName: string;
  /** PNG/JPEG bytes of the logo, or null for the name in type. */
  logo: Buffer | null;
  handle: string | null;
  website: string | null;
  /** Platforms whose icons the footer shows ([] = none). */
  networks: string[];
  colors: { primary?: string | null; secondary?: string | null; accent?: string | null };
};

export type FrameResult = { bytes: Buffer; width: number; height: number; layout: Exclude<FrameLayout, "off">; contentType: "image/jpeg" };

const FONT = "'Liberation Sans', Arial, Helvetica, 'DejaVu Sans', sans-serif";

// ── colour ────────────────────────────────────────────────────────────────────────────────────────────

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

export function normHex(v: string | null | undefined): string | null {
  const m = String(v ?? "").trim().match(HEX);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return `#${h.toLowerCase()}`;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** White or near-black, whichever reads better on `bg`. */
export function inkOn(bg: string): string {
  return contrast("#ffffff", bg) >= contrast("#111827", bg) ? "#ffffff" : "#111827";
}

/** Mix toward black (amount < 0) or white (amount > 0). */
function shade(hex: string, amount: number): string {
  const t = amount < 0 ? 0 : 255;
  const p = Math.abs(amount);
  return `#${rgb(hex).map((c) => Math.round(c + (t - c) * p).toString(16).padStart(2, "0")).join("")}`;
}

export function framePalette(colors: FrameInput["colors"]) {
  const primary = normHex(colors.primary) ?? normHex(colors.secondary) ?? "#1f2937";
  let accent = normHex(colors.accent) ?? normHex(colors.secondary) ?? shade(primary, 0.45);
  // An accent the eye can't tell from the band it sits on is no accent.
  if (contrast(accent, primary) < 1.6) accent = luminance(primary) > 0.4 ? shade(primary, -0.45) : shade(primary, 0.55);
  const footer = shade(primary, -0.22);
  return { primary, accent, footer };
}

// ── type ──────────────────────────────────────────────────────────────────────────────────────────────

// Arial / Liberation Sans advance widths, 1/1000 em, for " " (32) to "~" (126).
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

/** Width of `s` at `size` px. Characters outside ASCII count as a wide letter, so wrapping errs on the safe side. */
export function textWidth(s: string, size: number, bold: boolean): number {
  const table = bold ? W_BOLD : W_REG;
  let units = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    units += c >= 32 && c <= 126 ? table[c - 32] : bold ? 680 : 640;
  }
  return (units / 1000) * size;
}

/** Words into lines no wider than `maxW`; a single word too long for a line is kept whole (the caller shrinks). */
export function wrap(s: string, size: number, maxW: number, bold: boolean): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (!line || textWidth(next, size, bold) <= maxW) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The largest size from `start` down to `min` at which `s` fits `maxLines` lines of `maxW`. */
export function fitHeadline(s: string, start: number, min: number, maxW: number, maxLines: number): { size: number; lines: string[] } {
  for (let size = start; size >= min; size = Math.floor(size * 0.94)) {
    const lines = wrap(s, size, maxW, true);
    if (lines.length <= maxLines && lines.every((l) => textWidth(l, size, true) <= maxW)) return { size, lines };
  }
  // Still too long at the smallest size: keep the lines that fit and end the last with an ellipsis.
  const lines = wrap(s, min, maxW, true).slice(0, maxLines);
  let last = lines[lines.length - 1] ?? "";
  while (last && textWidth(`${last}…`, min, true) > maxW) last = last.replace(/\s*\S+$/, "");
  lines[lines.length - 1] = `${last}…`;
  return { size: min, lines };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function textEl(s: string, x: number, y: number, size: number, fill: string, opts: { bold?: boolean; anchor?: "start" | "end" | "middle"; opacity?: number } = {}): string {
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${FONT}" font-size="${size.toFixed(1)}" font-weight="${opts.bold ? 700 : 400}" fill="${fill}"${opts.opacity != null ? ` fill-opacity="${opts.opacity}"` : ""} text-anchor="${opts.anchor ?? "start"}">${esc(s)}</text>`;
}

// ── network icons ─────────────────────────────────────────────────────────────────────────────────────

const ICON_ORDER = ["facebook", "instagram", "x", "linkedin", "youtube", "pinterest", "tiktok", "threads", "bluesky"];

/** Platforms as icons: known ones in a fixed order, duplicates and "twitter"/"x" folded, at most six. */
export function iconNetworks(platforms: string[]): string[] {
  const seen = new Set<string>();
  for (const p of platforms) {
    const k = p.toLowerCase().trim() === "twitter" ? "x" : p.toLowerCase().trim();
    if (k) seen.add(k);
  }
  const known = ICON_ORDER.filter((k) => seen.has(k));
  const other = [...seen].filter((k) => !ICON_ORDER.includes(k)).sort();
  return [...known, ...other].slice(0, 6);
}

/** One icon: a circle in `disc`, the network's mark in `mark`. */
function iconEl(net: string, cx: number, cy: number, d: number, disc: string, mark: string): string {
  const r = d / 2;
  const out = [`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${disc}"/>`];
  const g = d * 0.5;
  const letter = (t: string, size: number, dy: number) => out.push(textEl(t, cx, cy + dy, size, mark, { bold: true, anchor: "middle" }));
  switch (net) {
    case "facebook": letter("f", d * 0.68, d * 0.24); break;
    case "x": letter("X", d * 0.5, d * 0.18); break;
    case "linkedin": letter("in", d * 0.46, d * 0.16); break;
    case "pinterest": letter("P", d * 0.56, d * 0.2); break;
    case "threads": letter("@", d * 0.56, d * 0.19); break;
    case "instagram": {
      const sw = (d * 0.075).toFixed(1);
      out.push(`<rect x="${(cx - g / 2).toFixed(1)}" y="${(cy - g / 2).toFixed(1)}" width="${g.toFixed(1)}" height="${g.toFixed(1)}" rx="${(g * 0.3).toFixed(1)}" fill="none" stroke="${mark}" stroke-width="${sw}"/>`);
      out.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(g * 0.24).toFixed(1)}" fill="none" stroke="${mark}" stroke-width="${sw}"/>`);
      out.push(`<circle cx="${(cx + g * 0.27).toFixed(1)}" cy="${(cy - g * 0.27).toFixed(1)}" r="${(d * 0.04).toFixed(1)}" fill="${mark}"/>`);
      break;
    }
    case "youtube": {
      const w = g * 1.12, h = g * 0.8;
      out.push(`<rect x="${(cx - w / 2).toFixed(1)}" y="${(cy - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${(h * 0.28).toFixed(1)}" fill="${mark}"/>`);
      const t = h * 0.42;
      out.push(`<path d="M${(cx - t * 0.45).toFixed(1)},${(cy - t / 2).toFixed(1)} L${(cx + t * 0.6).toFixed(1)},${cy.toFixed(1)} L${(cx - t * 0.45).toFixed(1)},${(cy + t / 2).toFixed(1)} Z" fill="${disc}"/>`);
      break;
    }
    case "tiktok": {
      const sw = d * 0.09;
      out.push(`<rect x="${(cx + g * 0.02).toFixed(1)}" y="${(cy - g * 0.5).toFixed(1)}" width="${sw.toFixed(1)}" height="${(g * 0.82).toFixed(1)}" fill="${mark}"/>`);
      out.push(`<circle cx="${(cx - g * 0.16).toFixed(1)}" cy="${(cy + g * 0.3).toFixed(1)}" r="${(g * 0.22).toFixed(1)}" fill="${mark}"/>`);
      out.push(`<path d="M${(cx + g * 0.02 + sw).toFixed(1)},${(cy - g * 0.5).toFixed(1)} q${(g * 0.12).toFixed(1)},${(g * 0.3).toFixed(1)} ${(g * 0.38).toFixed(1)},${(g * 0.3).toFixed(1)}" fill="none" stroke="${mark}" stroke-width="${sw.toFixed(1)}"/>`);
      break;
    }
    case "bluesky": {
      out.push(`<ellipse cx="${(cx - g * 0.22).toFixed(1)}" cy="${(cy - g * 0.08).toFixed(1)}" rx="${(g * 0.26).toFixed(1)}" ry="${(g * 0.18).toFixed(1)}" transform="rotate(35 ${(cx - g * 0.22).toFixed(1)} ${(cy - g * 0.08).toFixed(1)})" fill="${mark}"/>`);
      out.push(`<ellipse cx="${(cx + g * 0.22).toFixed(1)}" cy="${(cy - g * 0.08).toFixed(1)}" rx="${(g * 0.26).toFixed(1)}" ry="${(g * 0.18).toFixed(1)}" transform="rotate(-35 ${(cx + g * 0.22).toFixed(1)} ${(cy - g * 0.08).toFixed(1)})" fill="${mark}"/>`);
      out.push(`<ellipse cx="${cx.toFixed(1)}" cy="${(cy + g * 0.22).toFixed(1)}" rx="${(g * 0.3).toFixed(1)}" ry="${(g * 0.14).toFixed(1)}" fill="${mark}"/>`);
      break;
    }
    default: letter(net.slice(0, 1).toUpperCase(), d * 0.52, d * 0.18);
  }
  return out.join("");
}

// ── the frame ─────────────────────────────────────────────────────────────────────────────────────────

type Placed = { svg: string[]; logo: { input: Buffer; left: number; top: number } | null };

/** The footer strip, drawn into `svg` (and the logo placed) for a canvas of W×H. */
async function footer(input: FrameInput, W: number, H: number, s: number, bg: string, accent: string, out: Placed): Promise<void> {
  const fh = Math.round(118 * s);
  const pad = Math.round(52 * s);
  const top = H - fh;
  const ink = inkOn(bg);
  out.svg.push(`<rect x="0" y="${top - Math.round(6 * s)}" width="${W}" height="${Math.round(6 * s)}" fill="${accent}"/>`);
  out.svg.push(`<rect x="0" y="${top}" width="${W}" height="${fh}" fill="${bg}"/>`);

  // Left: the logo on a white chip, else the name in type.
  let leftEdge = pad;
  if (input.logo) {
    try {
      const sharp = (await import("sharp")).default;
      const meta = await sharp(input.logo).metadata();
      const chipH = Math.round(fh * 0.64);
      const chipPad = Math.round(chipH * 0.15);
      const inner = chipH - 2 * chipPad;
      // Never more than 1.5× its own pixels: a small logo stays sharp and sits smaller.
      const h = Math.max(8, Math.min(inner, Math.round((meta.height ?? inner) * 1.5)));
      const logo = await sharp(input.logo).rotate().resize({ height: h, width: Math.round(fh * 2.8), fit: "inside" }).png().toBuffer();
      const lm = await sharp(logo).metadata();
      const lw = lm.width ?? h, lh = lm.height ?? h;
      const chipW = lw + 2 * chipPad;
      const chipTop = top + Math.round((fh - chipH) / 2);
      out.svg.push(`<rect x="${pad}" y="${chipTop}" width="${chipW}" height="${chipH}" rx="${Math.round(chipH * 0.22)}" fill="#ffffff"/>`);
      out.logo = { input: logo, left: pad + chipPad, top: chipTop + Math.round((chipH - lh) / 2) };
      leftEdge = pad + chipW;
    } catch {
      input = { ...input, logo: null };
    }
  }
  if (!input.logo) {
    const size = Math.round(fh * 0.27);
    const name = input.brandName.trim().slice(0, 40);
    out.svg.push(textEl(name, pad, top + fh / 2 + size * 0.36, size, ink, { bold: true }));
    leftEdge = pad + textWidth(name, size, true);
  }

  // Right: icons and the handle on one line, the website under them.
  const right = W - pad;
  const room = right - leftEdge - Math.round(40 * s);
  const h1 = Math.round(fh * 0.24), h2 = Math.round(fh * 0.2);
  const d = Math.round(fh * 0.31), gap = Math.round(d * 0.32);
  let icons = iconNetworks(input.networks);
  const handle = input.handle;
  let website = input.website;
  const iconsW = (n: number) => (n ? n * d + (n - 1) * gap : 0);
  const line1W = () => iconsW(icons.length) + (icons.length && handle ? gap * 1.4 : 0) + (handle ? textWidth(handle, h1, true) : 0);
  while (icons.length && line1W() > room) icons = icons.slice(0, -1);
  if (website && textWidth(website, h2, false) > room) website = null;
  const hasLine1 = icons.length > 0 || Boolean(handle);
  const two = hasLine1 && Boolean(website);
  const y1 = two ? top + fh * 0.4 : top + fh / 2;
  if (handle) out.svg.push(textEl(handle, right, y1 + h1 * 0.36, h1, ink, { bold: true, anchor: "end" }));
  let x = right - (handle ? textWidth(handle, h1, true) + gap * 1.4 : 0) - d / 2;
  for (let i = icons.length - 1; i >= 0; i--) {
    out.svg.push(iconEl(icons[i], x, y1, d, ink, bg));
    x -= d + gap;
  }
  if (website) out.svg.push(textEl(website, right, two ? top + fh * 0.78 : top + fh / 2 + h2 * 0.36, h2, ink, { anchor: "end", opacity: 0.92 }));
}

/**
 * Frame `base` (any image sharp reads). Returns a JPEG of the same size. Throws only on unreadable input;
 * callers keep the plain picture when it does.
 */
export async function frameSocialImage(base: Buffer, input: FrameInput): Promise<FrameResult> {
  const sharp = (await import("sharp")).default;
  const src = sharp(base).rotate();
  const meta = await src.metadata();
  const W = meta.autoOrient?.width ?? meta.width ?? 1080;
  const H = meta.autoOrient?.height ?? meta.height ?? 1080;
  const s = Math.min(W, H) / 1080;
  const pad = Math.round(56 * s);
  const { primary, accent, footer: footerBg } = framePalette(input.colors);
  const headline = (input.headline ?? "").trim();
  const layout = (input.layout === "headline" || input.layout === "bands") && !headline ? "footer" : input.layout;
  const out: Placed = { svg: [], logo: null };
  const layers: Array<{ input: Buffer; left: number; top: number }> = [];
  let canvas: Buffer;

  if (layout === "bands") {
    const fh = Math.round(118 * s);
    const hb = Math.round(H * (W > H ? 0.3 : 0.27));
    const picH = H - hb - fh;
    const pic = await sharp(base).rotate().resize(W, picH, { fit: "cover", position: sharp.strategy.attention }).toBuffer();
    canvas = await sharp({ create: { width: W, height: H, channels: 3, background: primary } }).png().toBuffer();
    layers.push({ input: pic, left: 0, top: hb });
    const ink = inkOn(primary);
    const maxW = W - 2 * pad;
    const { size, lines } = fitHeadline(headline, Math.round(76 * s), Math.round(40 * s), maxW, 3);
    const lh = size * 1.12;
    const block = lh * (lines.length - 1) + size * 0.74;
    let y = (hb - Math.round(6 * s)) / 2 - block / 2 + size * 0.74;
    for (const l of lines) {
      out.svg.push(textEl(l, pad, y, size, ink, { bold: true }));
      y += lh;
    }
    out.svg.push(`<rect x="0" y="${hb - Math.round(6 * s)}" width="${W}" height="${Math.round(6 * s)}" fill="${accent}"/>`);
    await footer(input, W, H, s, footerBg, accent, out);
  } else {
    canvas = await src.png().toBuffer();
    if (layout === "headline") {
      out.svg.push(
        `<defs><linearGradient id="wash" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${primary}" stop-opacity="0.9"/><stop offset="0.55" stop-color="${primary}" stop-opacity="0.55"/><stop offset="1" stop-color="${primary}" stop-opacity="0"/></linearGradient></defs>`,
        `<rect x="0" y="0" width="${W}" height="${Math.round(H * 0.56)}" fill="url(#wash)"/>`,
      );
      const ink = inkOn(primary);
      const maxW = Math.round(W * (W > H ? 0.7 : 0.86)) - pad;
      const { size, lines } = fitHeadline(headline, Math.round(84 * s), Math.round(44 * s), maxW, 3);
      const lh = size * 1.12;
      let y = pad + size * 0.8;
      for (const l of lines) {
        out.svg.push(textEl(l, pad, y, size, ink, { bold: true }));
        y += lh;
      }
      out.svg.push(`<rect x="${pad}" y="${Math.round(y - lh + size * 0.42)}" width="${Math.round(120 * s)}" height="${Math.round(8 * s)}" rx="${Math.round(4 * s)}" fill="${accent}"/>`);
    }
    await footer(input, W, H, s, layout === "footer" || layout === "headline" ? primary : footerBg, accent, out);
  }

  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.svg.join("")}</svg>`);
  layers.push({ input: svg, left: 0, top: 0 });
  if (out.logo) layers.push(out.logo);
  const bytes = await sharp(canvas).composite(layers).jpeg({ quality: 90, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();
  return { bytes, width: W, height: H, layout, contentType: "image/jpeg" };
}

/**
 * A stand-in picture for previews of the frame (Brand → Post images), so an admin sees the frame with their own
 * logo, colours and handle without paying for a render: soft shapes in neutral tones, no text.
 */
export async function sampleBackdrop(width: number, height: number): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9dde3"/><stop offset="1" stop-color="#8a96a6"/></linearGradient>
<radialGradient id="r" cx="0.62" cy="0.58" r="0.5"><stop offset="0" stop-color="#f4efe6"/><stop offset="1" stop-color="#f4efe6" stop-opacity="0"/></radialGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" fill="url(#r)"/>
<circle cx="${width * 0.64}" cy="${height * 0.6}" r="${Math.min(width, height) * 0.2}" fill="#5b6b7f" fill-opacity="0.55"/>
<rect x="${width * 0.2}" y="${height * 0.5}" width="${width * 0.3}" height="${height * 0.3}" rx="${Math.min(width, height) * 0.03}" fill="#3f4b5a" fill-opacity="0.45"/>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
