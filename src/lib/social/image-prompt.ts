import { DEFAULT_IMAGE_STYLE, imageStyle, type ImageStyleId } from "@/lib/social/image-styles";
import type { FrameLayout } from "@/lib/social/frame";

/**
 * The art direction for social imagery — ONE source of truth, used by the
 * auto-image job and the composer's AI-image button (both through
 * lib/social/post-image.ts).
 *
 * Replaces the original "clean, modern, professional; simple bold composition"
 * prompt, which got exactly what it asked for: flat, generic, forgettable
 * graphics (user's words 2026-08-10: "very basic and too simple"). The fix is
 * to ask like an art director: name a concept, demand a medium and lighting,
 * and ban the failure modes by name.
 *
 * Since 2026-11-23 the craft and "never" lines come from the chosen STYLE
 * (lib/social/image-styles.ts) — one direction for every image is why they all
 * looked alike. Editorial is the old direction word for word.
 *
 * ⚠ NO TEXT ON THE IMAGE, ever — every style bans it. The old prompt invited "a
 * short phrase from the post" — rendered type is where AI images look worst (and
 * most AI), and every network overlays its own UI. Words on a post image come
 * only from the branded frame, which Publisher typesets itself
 * (lib/images/social-frame.ts), so the model is only told where to leave room.
 */
export function socialImagePrompt(opts: {
  /** The post text (URLs already add nothing to a picture — stripped here). */
  text: string;
  /** Campaign name — keeps a series visually consistent. */
  campaign?: string | null;
  /** Author's style guidance (composer only) — rides inside, never replaces. */
  guidance?: string | null;
  /** The look; absent = editorial. */
  style?: ImageStyleId | null;
  /** The brand kit's colours, for the styles that lean on them. */
  palette?: string[] | null;
  /** The frame the picture will wear, so the model leaves its room calm. */
  frame?: FrameLayout | null;
}): string {
  const text = opts.text.replace(/https?:\/\/\S+/g, "").trim().slice(0, 600);
  const style = imageStyle(opts.style ?? DEFAULT_IMAGE_STYLE);
  const palette = (opts.palette ?? []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 3);
  return [
    `Create a striking editorial image for a social media post about: "${text}".`,
    `Concept: find ONE strong visual metaphor for the idea and commit to it — an image that stops a scroll, not one that decorates a slide.`,
    style.craft,
    style.usesPalette && palette.length ? `Palette: build it from the brand's colours ${palette.join(", ")}, with neutrals for balance.` : null,
    `Composition: a clear focal subject with breathing room; an interesting angle or scale contrast rather than a flat, head-on layout.`,
    opts.frame === "headline"
      ? `Leave the top third calm and uncluttered (soft background, sky, wall or shadow) with the main subject in the middle and lower part — a headline will be set over the top. Keep the bottom eighth free of important detail.`
      : opts.frame === "footer"
        ? `Keep the bottom eighth free of important detail — a footer strip will cover it.`
        : opts.frame === "bands"
          ? `Keep the subject centred: the top and bottom edges will be cropped.`
          : null,
    style.never,
    opts.campaign ? `This belongs to the "${opts.campaign}" series — keep the medium and palette consistent with one strong series style.` : null,
    opts.guidance ? `Style guidance from the author, which wins over the defaults above where they conflict: ${opts.guidance}.` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
