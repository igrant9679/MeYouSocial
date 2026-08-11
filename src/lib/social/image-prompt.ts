/**
 * The art direction for social imagery — ONE source of truth, used by the
 * auto-image job and the composer's AI-image button.
 *
 * Replaces the original "clean, modern, professional; simple bold composition"
 * prompt, which got exactly what it asked for: flat, generic, forgettable
 * graphics (user's words 2026-08-10: "very basic and too simple"). The fix is
 * to ask like an art director: name a concept, demand a medium and lighting,
 * and ban the failure modes by name.
 *
 * ⚠ NO TEXT ON THE IMAGE, ever. The old prompt invited "a short phrase from
 * the post" — rendered type is where AI images look worst (and most AI), the
 * post's own text already carries the words, and every network overlays its
 * own UI. A picture that needs a caption baked in isn't doing its job.
 */
export function socialImagePrompt(opts: {
  /** The post text (URLs already add nothing to a picture — stripped here). */
  text: string;
  /** Campaign name — keeps a series visually consistent. */
  campaign?: string | null;
  /** Author's style guidance (composer only) — rides inside, never replaces. */
  guidance?: string | null;
}): string {
  const text = opts.text.replace(/https?:\/\/\S+/g, "").trim().slice(0, 600);
  return [
    `Create a striking editorial image for a social media post about: "${text}".`,
    `Concept: find ONE strong visual metaphor for the idea and commit to it — an image that stops a scroll, not one that decorates a slide.`,
    `Craft: choose a specific medium that fits the subject (cinematic photography, painterly editorial illustration, tactile 3D render, macro detail); ` +
      `dimensional lighting with real depth; rich texture and material detail; a confident, cohesive palette with one deliberate accent colour.`,
    `Composition: a clear focal subject with breathing room; an interesting angle or scale contrast rather than a flat, head-on layout.`,
    `Never: flat corporate vector clip-art, generic gradient backdrops, stock clichés (handshakes, faceless suits, glowing circuit boards, ` +
      `people pointing at charts), watermarks, logos, fake UI screenshots, or ANY text, lettering or typography in the image.`,
    opts.campaign ? `This belongs to the "${opts.campaign}" series — keep the medium and palette consistent with one strong series style.` : null,
    opts.guidance ? `Style guidance from the author, which wins over the defaults above where they conflict: ${opts.guidance}.` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
