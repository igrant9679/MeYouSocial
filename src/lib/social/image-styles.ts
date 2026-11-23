/**
 * Image styles for social posts (2026-11-23, the owner's "is there a way to switch the style/type of the
 * image… all of the post images seem to be in the same style").
 *
 * They all looked alike because every picture was asked for with ONE art direction (lib/social/image-prompt.ts).
 * A style swaps that direction's craft and "never" lines; everything else in the prompt (one strong idea, no text
 * on the image, the series line for a campaign) stays. A workspace picks a default under Brand → Post images, or
 * Mix, which takes the style used longest ago so the posts the app writes stop repeating; Compose can pick per image.
 *
 * Plain data: the Brand page and the composer ship it to the browser.
 */

export type ImageStyleId = "editorial" | "people" | "illustration" | "render3d" | "graphic";
export type ImageStyleSetting = ImageStyleId | "mix";

/** The workspace's default style: one id, or "mix". Absent = editorial, the look every image had before. */
export const IMAGE_STYLE_KEY = "social:image_style";
export const DEFAULT_IMAGE_STYLE: ImageStyleId = "editorial";

export type ImageStyle = {
  id: ImageStyleId;
  label: string;
  /** One line for people choosing. */
  blurb: string;
  /** The prompt's craft line: medium, light, palette. */
  craft: string;
  /** The prompt's "never" line. Every one bans text on the image. */
  never: string;
  /** Lean on the brand's colours when the brand kit has them. */
  usesPalette: boolean;
};

const NO_TEXT = "watermarks, logos, fake UI screenshots, or ANY text, lettering, numbers or typography in the image";

export const IMAGE_STYLES: ImageStyle[] = [
  {
    id: "editorial",
    label: "Editorial",
    blurb: "One strong visual idea, in whatever medium suits it. The look every image had until now.",
    craft:
      "Craft: choose a specific medium that fits the subject (cinematic photography, painterly editorial illustration, tactile 3D render, macro detail); " +
      "dimensional lighting with real depth; rich texture and material detail; a confident, cohesive palette with one deliberate accent colour.",
    never:
      "Never: flat corporate vector clip-art, generic gradient backdrops, stock clichés (handshakes, faceless suits, glowing circuit boards, " +
      `people pointing at charts), ${NO_TEXT}.`,
    usesPalette: false,
  },
  {
    id: "people",
    label: "Real people",
    blurb: "Candid photographs of people at work, in a setting that fits the post.",
    craft:
      "Craft: authentic, candid photography of real-looking people at work in a setting that fits the subject — natural light, genuine expressions " +
      "and body language, shallow depth of field, a believable modern workplace or community setting, people of varied ages and backgrounds, " +
      "warm true-to-life colour.",
    never:
      "Never: posed smiles straight at the camera, handshakes, people pointing at charts or screens, faceless suits, distorted hands or faces, " +
      `${NO_TEXT}.`,
    usesPalette: false,
  },
  {
    id: "illustration",
    label: "Illustration",
    blurb: "A contemporary hand-made illustration: painterly textures, expressive shapes.",
    craft:
      "Craft: a contemporary editorial illustration — painterly or gouache texture, expressive shapes, a limited harmonious palette, " +
      "a visible artistic hand; conceptual rather than literal.",
    never: `Never: flat corporate vector clip-art, generic gradient backdrops, cartoon mascots, stock clichés, ${NO_TEXT}.`,
    usesPalette: true,
  },
  {
    id: "render3d",
    label: "3D render",
    blurb: "A tactile 3D scene: soft studio light, real materials, one hero object.",
    craft:
      "Craft: a tactile 3D render — soft studio lighting, physically based materials (matte clay, frosted glass, brushed metal), gentle shadows, " +
      "a clean set with one hero object that embodies the idea.",
    never: `Never: busy scenes, glossy plastic clichés, glowing circuit boards, floating app icons, ${NO_TEXT}.`,
    usesPalette: true,
  },
  {
    id: "graphic",
    label: "Bold graphic",
    blurb: "A poster-like image: strong shapes and colour blocks, lots of space.",
    craft:
      "Craft: a bold graphic poster image — strong geometric shapes, confident colour blocking, simple iconic forms that carry the idea, " +
      "generous negative space.",
    never: `Never: photographic clutter, generic gradient backdrops, clip-art people, ${NO_TEXT}.`,
    usesPalette: true,
  },
];

export const IMAGE_STYLE_IDS: readonly ImageStyleId[] = IMAGE_STYLES.map((s) => s.id);

export function isImageStyleId(v: unknown): v is ImageStyleId {
  return typeof v === "string" && (IMAGE_STYLE_IDS as readonly string[]).includes(v);
}

/** A stored setting read back: one id, "mix", or the default for anything else. */
export function parseImageStyle(v: unknown): ImageStyleSetting {
  if (v === "mix") return "mix";
  return isImageStyleId(v) ? v : DEFAULT_IMAGE_STYLE;
}

export function imageStyle(id: ImageStyleId): ImageStyle {
  return IMAGE_STYLES.find((s) => s.id === id) ?? IMAGE_STYLES[0];
}

export function imageStyleLabel(v: ImageStyleSetting): string {
  return v === "mix" ? "Mix" : imageStyle(v).label;
}

/**
 * Mix: the style used longest ago. `recent` is the styles of the workspace's last images, NEWEST FIRST; a style
 * not in it at all wins (in list order), so the first five images under Mix are all different.
 */
export function pickMixStyle(recent: readonly string[]): ImageStyleId {
  let best: ImageStyleId = IMAGE_STYLES[0].id;
  let bestAge = -2;
  for (const s of IMAGE_STYLES) {
    const at = recent.indexOf(s.id);
    const age = at === -1 ? Number.MAX_SAFE_INTEGER : at;
    if (age > bestAge) {
      best = s.id;
      bestAge = age;
    }
  }
  return best;
}
