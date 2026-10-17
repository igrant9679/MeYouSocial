/**
 * The watermark positions, client-safe. Kept apart from watermark.ts because
 * that file loads the logo (db, storage, sharp) and the composer is a client
 * component — importing it there pulls sharp into the browser bundle and the
 * build fails (found 2026-10-17).
 */
export const WATERMARK_POSITIONS = [
  { value: "br", label: "Logo, bottom right" },
  { value: "bl", label: "Logo, bottom left" },
  { value: "tr", label: "Logo, top right" },
  { value: "tl", label: "Logo, top left" },
] as const;
export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number]["value"];

export function normaliseWatermark(v: unknown): WatermarkPosition | null {
  const s = String(v ?? "").trim();
  return (WATERMARK_POSITIONS.find((p) => p.value === s)?.value ?? null) as WatermarkPosition | null;
}
