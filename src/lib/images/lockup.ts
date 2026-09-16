import { db } from "@/lib/db";
import { storage } from "@/lib/storage";

// The brand lockup on a generated image — composited by us, never painted by
// the model.
//
// Why: every branded OG brief used to ask the image model to "place the logo
// lockup", and the model obliged with a lockup for a company it made up:
// "GRYPHON & BISHOP EST. 1876", "ARC-TEC MODELING SYSTEMS", "COMPASS",
// "QForms", and once the literal word "LOGO" (CF + LSI, 2026-08-25 → 09-11).
// The vision reviewer rightly refused every one, the brake tripped, and the
// article sat held. Image models cannot spell a name they were only told;
// sharp can. So the scene is rendered text-free and the real mark + name go
// on afterwards, bottom-left, on a translucent pill — deterministic, same on
// every render, and "invented brand" stops being a failure class.
//
// ⚠ Fonts: the SVG names Liberation Sans, which the Railway image installs
// (nixpacks.toml aptPkgs fonts-liberation); locally it falls through to
// Arial/DejaVu. No font at all would render an empty pill — the caller
// treats a failed composite as "not branded", never as branded.

export type LockupInput = {
  brandName: string;
  /** PNG/JPEG bytes of the mark, or null for a text-only wordmark. */
  logo: Buffer | null;
  width: number;
  height: number;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Smallest side a stored logo must have to be worth placing (else text only). */
export const MIN_LOGO_PX = 96;

/**
 * The workspace's mark for the lockup: the app-chrome logo (Workspace.logoKey)
 * first, then the brand kit's logoUrl (storage or http). Null when nothing is
 * on file or the file is too small to scale up honestly (LSI's stored mark is
 * 76×61 — it would be a blur at 64px on a 1200-wide card).
 */
export async function loadBrandLogo(workspaceId: string): Promise<Buffer | null> {
  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { logoKey: true } });
  const kit = await db.brandKit.findUnique({ where: { workspaceId }, select: { logoUrl: true } });
  const candidates: Array<() => Promise<Buffer | null>> = [];
  if (ws?.logoKey) candidates.push(() => storage.get(ws.logoKey!));
  if (kit?.logoUrl) {
    const key = kit.logoUrl.match(/\/(?:uploads|api\/files)\/([^"'\s)?]+)/)?.[1];
    if (key) candidates.push(() => storage.get(decodeURIComponent(key)));
    else if (/^https?:\/\//i.test(kit.logoUrl)) {
      candidates.push(async () => {
        const res = await fetch(kit.logoUrl!, { signal: AbortSignal.timeout(10_000) });
        return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
      });
    }
  }
  for (const load of candidates) {
    try {
      const buf = await load();
      if (!buf || buf.length < 64) continue;
      const sharp = (await import("sharp")).default;
      const meta = await sharp(buf).metadata();
      if (!meta.width || !meta.height) continue;
      if (Math.min(meta.width, meta.height) < MIN_LOGO_PX) continue;
      return buf;
    } catch {
      // try the next source
    }
  }
  return null;
}

/** The SVG overlay: a translucent pill, the mark (if any) and the name. */
export async function lockupSvg(input: LockupInput): Promise<{ svg: Buffer; left: number; top: number }> {
  // Long names are cut at a word boundary — "…Long Name I" reads as a typo.
  let name = input.brandName.trim();
  if (name.length > 40) {
    const cut = name.slice(0, 40);
    name = cut.includes(" ") ? cut.slice(0, cut.lastIndexOf(" ")) : cut;
  }
  // Scale with the canvas so a 1920-wide featured and a 1200-wide OG read alike.
  const unit = Math.max(0.6, Math.min(1.6, input.width / 1200));
  const fontSize = Math.round(40 * unit);
  const markH = Math.round(64 * unit);
  const padX = Math.round(28 * unit);
  const padY = Math.round(16 * unit);
  const gap = Math.round(20 * unit);
  const margin = Math.round(40 * unit);

  let markW = 0;
  let markHref: string | null = null;
  if (input.logo) {
    const sharp = (await import("sharp")).default;
    // Normalise to PNG at the lockup height so librsvg gets a small, known
    // raster (a 4000px source would bloat the SVG and slow the composite).
    const png = await sharp(input.logo).resize({ height: markH, withoutEnlargement: false }).png().toBuffer();
    const meta = await sharp(png).metadata();
    markW = meta.width ?? markH;
    markHref = `data:image/png;base64,${png.toString("base64")}`;
  }
  // Liberation Sans Bold averages ~0.58em per glyph; a slight over-estimate
  // keeps the pill from clipping the last letter.
  const textW = Math.ceil(name.length * fontSize * 0.6);
  const pillW = padX + (markHref ? markW + gap : 0) + textW + padX;
  const pillH = Math.max(markH, fontSize) + padY * 2;
  const radius = Math.round(pillH / 2);
  const textX = padX + (markHref ? markW + gap : 0);
  const textY = Math.round(pillH / 2 + fontSize * 0.36);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pillW}" height="${pillH}" viewBox="0 0 ${pillW} ${pillH}">` +
    `<rect x="0" y="0" width="${pillW}" height="${pillH}" rx="${radius}" ry="${radius}" fill="rgba(12,14,18,0.66)"/>` +
    (markHref ? `<image x="${padX}" y="${Math.round((pillH - markH) / 2)}" width="${markW}" height="${markH}" href="${markHref}" preserveAspectRatio="xMidYMid meet"/>` : "") +
    `<text x="${textX}" y="${textY}" font-family="Liberation Sans, Arial, Helvetica, DejaVu Sans, sans-serif" font-weight="700" font-size="${fontSize}" fill="#ffffff" letter-spacing="0.5">${esc(name)}</text>` +
    `</svg>`;
  return { svg: Buffer.from(svg), left: margin, top: input.height - margin - pillH };
}

/**
 * Composite the lockup onto the finished image bytes. Throws on failure so the
 * caller can record "not branded" instead of guessing.
 */
export async function applyBrandLockup(base: Buffer, input: LockupInput): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const { svg, left, top } = await lockupSvg(input);
  return sharp(base).composite([{ input: svg, left: Math.max(0, left), top: Math.max(0, top) }]).toBuffer();
}
