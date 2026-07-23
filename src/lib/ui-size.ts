/**
 * Content-size levels for the whole UI. The cookie is read in the root layout
 * and applied as `zoom` on <body> — unlike a root font-size change, zoom also
 * scales the arbitrary-px utilities this app uses everywhere.
 */
export type ContentSize = "standard" | "large" | "xl";

export const SIZE_ZOOM: Record<ContentSize, number> = {
  standard: 1,
  large: 1.1,
  xl: 1.22,
};

export const SIZE_LABELS: Record<ContentSize, string> = {
  standard: "Standard",
  large: "Large",
  xl: "Extra large",
};

export const CONTENT_SIZES: ContentSize[] = ["standard", "large", "xl"];
