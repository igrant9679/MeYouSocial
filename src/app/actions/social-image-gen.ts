"use server";

import { requireRole } from "@/lib/acl";
import { getImageProvider } from "@/lib/images";
import { writeAudit } from "@/lib/governance";

/**
 * On-demand AI image for the social composer — the foreground sibling of the
 * `social.autoimage` background job. The author asks for the image WHILE
 * drafting, sees it, and can discard it before anything is saved; the job
 * remains the safety net for posts composed without media.
 *
 * House rules carried over from the job:
 *   - The MOCK provider is never returned as an image. A workspace with no
 *     usable image key gets an honest refusal naming the fix, not a stock
 *     photo that looks like success.
 *   - A real provider that fails surfaces its error — no silent fallback.
 *   - The post text is the grounding; `guidance` is a bounded style hint that
 *     rides INSIDE the server-owned prompt (same softening as assist
 *     guidance), never a raw prompt of its own.
 */

export type ComposerImageResult =
  | { ok: true; key: string; url: string; provider: string; width: number; height: number }
  | { ok: false; error: string };

export async function generateComposerImageAction(input: {
  text: string;
  guidance?: string;
  /** True when a square-first network (IG/Pinterest/TikTok) is selected. */
  square?: boolean;
}): Promise<ComposerImageResult> {
  const { workspace } = await requireRole("EDITOR");

  const text = String(input.text ?? "").replace(/https?:\/\/\S+/g, "").trim();
  if (text.length < 10) {
    return { ok: false, error: "Write the post first — the image is generated from what it says." };
  }

  const provider = await getImageProvider(workspace.id);
  if (provider.name === "mock") {
    return {
      ok: false,
      error: "No image provider is configured for this workspace — add an OpenAI or Google key under Admin → API keys.",
    };
  }

  const guidance = String(input.guidance ?? "").trim().slice(0, 300);
  const prompt =
    `Social media graphic to accompany this post: "${text.slice(0, 600)}". ` +
    `Clean, modern, professional; simple bold composition; readable if it includes a short phrase from the post; ` +
    `no watermarks, no logos, no fake UI screenshots.` +
    (guidance ? ` Style guidance from the author: ${guidance}.` : "");

  try {
    const img = await provider.generate({
      prompt,
      aspectRatio: input.square ? "1:1" : "16:9",
      workspaceId: workspace.id,
    });
    if (!img.key) {
      // Defensive: only stored bytes may be attached to a post later.
      return { ok: false, error: `The ${img.provider} provider returned no stored image — try again.` };
    }
    await writeAudit({
      workspaceId: workspace.id,
      action: "social.composer_image",
      entityType: "social_post",
      meta: { provider: img.provider, aspect: input.square ? "1:1" : "16:9" },
    });
    return { ok: true, key: img.key, url: img.url, provider: img.provider, width: img.width, height: img.height };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Image generation failed." };
  }
}
