import { loadBrandLogo } from "@/lib/images/lockup";

/**
 * The logo watermark (Socialmonials parity, 2026-10-17): the workspace's own
 * mark composited onto an IMAGE at send time, in the corner the author chose.
 * The stored original is never touched — the watermark exists only in the
 * bytes uploaded to the network, so turning it off for a re-send just works.
 *
 * The mark comes from `loadBrandLogo` (the same source the brand lockup uses:
 * Workspace.logoKey, then the brand kit) with a LOWER floor than the lockup's
 * 96px — a watermark is small, and LSI's stored mark is 76×61. It is never
 * scaled UP past its own pixels, so a small logo stays sharp and simply sits
 * smaller. No logo on file → the composer doesn't offer it; and if the logo
 * has since gone, the image goes out plain rather than the send failing — a
 * watermark is decoration, never a gate.
 */

/** Smallest logo side worth watermarking with. */
export const WATERMARK_MIN_LOGO_PX = 40;

import { normaliseWatermark, WATERMARK_POSITIONS, type WatermarkPosition } from "@/lib/social/watermark-options";
export { normaliseWatermark, WATERMARK_POSITIONS, type WatermarkPosition };

/** Workspace has a usable logo — the composer's gate for the option. */
export async function canWatermark(workspaceId: string): Promise<boolean> {
  return (await loadBrandLogo(workspaceId, WATERMARK_MIN_LOGO_PX).catch(() => null)) != null;
}

/**
 * Composite the logo onto one image. Width ≈ 14% of the image's shorter side
 * scaled to the long edge, inset 3%, at 85% opacity. GIFs and anything sharp
 * can't read are returned untouched (an animated GIF would lose its frames).
 */
export async function applyWatermark(
  bytes: Uint8Array,
  contentType: string,
  position: WatermarkPosition,
  logo: Buffer,
): Promise<Uint8Array> {
  if (!/^image\/(png|jpe?g|webp)$/i.test(contentType)) return bytes;
  const sharp = (await import("sharp")).default;
  const base = sharp(Buffer.from(bytes)).rotate();
  const meta = await base.metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) return bytes;
  // EXIF-rotated images swap their axes after rotate().
  const swap = (meta.orientation ?? 1) >= 5;
  const w = swap ? H : W;
  const h = swap ? W : H;
  const logoMeta = await sharp(logo).metadata();
  const natural = Math.max(logoMeta.width ?? 0, logoMeta.height ?? 0) || 9999;
  // Never upscale: a 76px mark stays 76px rather than going soft.
  const target = Math.min(natural, Math.max(32, Math.round(Math.min(w, h) * 0.16)));
  const mark = await sharp(logo)
    .resize({ width: target, height: target, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    // 85% opacity: multiply the alpha channel.
    .composite([{ input: Buffer.from([255, 255, 255, Math.round(255 * 0.85)]), raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: "dest-in" }])
    .png()
    .toBuffer({ resolveWithObject: true });
  const mw = mark.info.width;
  const mh = mark.info.height;
  const inset = Math.round(Math.min(w, h) * 0.03);
  const left = position.endsWith("r") ? w - mw - inset : inset;
  const top = position.startsWith("b") ? h - mh - inset : inset;
  const out = await base.composite([{ input: mark.data, left: Math.max(0, left), top: Math.max(0, top) }]).toBuffer();
  return new Uint8Array(out);
}

/** One logo load per send, shared by every image in it. */
export async function watermarkerFor(workspaceId: string, position: WatermarkPosition | null) {
  if (!position) return null;
  const logo = await loadBrandLogo(workspaceId, WATERMARK_MIN_LOGO_PX).catch(() => null);
  if (!logo) {
    console.warn(`[social] watermark ${position} requested for ${workspaceId} but no usable logo is on file — sending plain`);
    return null;
  }
  return (bytes: Uint8Array, contentType: string) =>
    applyWatermark(bytes, contentType, position, logo).catch((e) => {
      console.warn("[social] watermark failed — sending plain:", e instanceof Error ? e.message : e);
      return bytes;
    });
}
