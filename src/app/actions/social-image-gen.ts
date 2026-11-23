"use server";

import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { getImageProvider } from "@/lib/images";
import { isGloballyPaused, writeAudit } from "@/lib/governance";
import type { ImageStyleId } from "@/lib/social/image-styles";
import type { FrameLayout } from "@/lib/social/frame";

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
 *
 * Since 2026-11-23 both go through lib/social/post-image.ts: a style (this
 * image's, else the workspace's) and the workspace's branded frame, with the
 * author able to turn the frame off for one image or type its headline.
 */

export type ComposerImageResult =
  | {
      ok: true; key: string; url: string; provider: string; width: number; height: number;
      style: ImageStyleId; frame: FrameLayout; headline: string | null; headlineBy: "ai" | "post" | "person" | null;
      baseKey: string; note: string | null;
    }
  | { ok: false; error: string };

export async function generateComposerImageAction(input: {
  text: string;
  guidance?: string;
  /** True when a square-first network (IG/Pinterest/TikTok) is selected. */
  square?: boolean;
  /** A style id for this image; blank = the workspace's (Brand → Post images). */
  style?: string;
  /** False = no frame on this image even when the workspace has one. */
  frame?: boolean;
  /** The frame's headline, typed by the author; blank = written from the post. */
  headline?: string;
}): Promise<ComposerImageResult> {
  const { workspace } = await requireRole("EDITOR");

  const text = String(input.text ?? "").replace(/https?:\/\/\S+/g, "").trim();
  if (text.length < 10) {
    return { ok: false, error: "Write the post first — the image is generated from what it says." };
  }

  if (await isGloballyPaused(workspace.id)) {
    return { ok: false, error: "This workspace is paused (Settings → Automation), so no images are generated. Resume it there first." };
  }

  const provider = await getImageProvider(workspace.id);
  if (provider.name === "mock") {
    return {
      ok: false,
      error: "No image provider is configured for this workspace — add an OpenAI or Google key under Settings → Keys.",
    };
  }

  const guidance = String(input.guidance ?? "").trim().slice(0, 300);
  const aspect = input.square ? "1:1" : "16:9";
  try {
    const { renderPostImage } = await import("@/lib/social/post-image");
    const img = await renderPostImage({
      workspaceId: workspace.id,
      provider,
      text,
      aspect,
      guidance: guidance || null,
      style: input.style || null,
      frame: input.frame !== false,
      headline: input.headline ?? null,
    });
    await writeAudit({
      workspaceId: workspace.id,
      action: "social.composer_image",
      entityType: "social_post",
      meta: {
        provider: img.provider, aspect, style: img.style, frame: img.frame,
        ...(img.headlineBy ? { headlineBy: img.headlineBy } : {}),
        ...(img.frameNote ? { frameFailed: true } : {}),
      },
    });
    return {
      ok: true, key: img.key, url: img.url, provider: img.provider, width: img.width, height: img.height,
      style: img.style, frame: img.frame, headline: img.headline, headlineBy: img.headlineBy, baseKey: img.baseKey,
      note: img.frameNote,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Image generation failed." };
  }
}

export type ReframeResult =
  | { ok: true; key: string; url: string; frame: FrameLayout; headline: string | null }
  | { ok: false; error: string };

/**
 * A new headline on an image Compose already made: the stored picture (its `baseKey`) framed again, no new render
 * and nothing spent. The base must be a file of THIS workspace — a key from another one is refused like a missing one.
 */
export async function reframeComposerImageAction(input: { baseKey: string; headline: string }): Promise<ReframeResult> {
  const { workspace } = await requireRole("EDITOR");
  const baseKey = String(input.baseKey ?? "");
  const owner = baseKey ? await db.storedObject.findUnique({ where: { key: baseKey }, select: { workspaceId: true } }) : null;
  if (!owner || owner.workspaceId !== workspace.id) return { ok: false, error: "That image isn't in this workspace any more — make a new one." };
  const { cleanHeadline, frameHasHeadline } = await import("@/lib/social/frame");
  const headline = cleanHeadline(input.headline);
  if (!headline) return { ok: false, error: "Type the headline first." };
  const { frameDetails, frameStoredImage } = await import("@/lib/social/post-image");
  const details = await frameDetails(workspace.id);
  if (!frameHasHeadline(details.layout)) return { ok: false, error: "This workspace's frame has no headline (Brand → Post images)." };
  const framed = await frameStoredImage(workspace.id, baseKey, details, headline);
  if (!framed) return { ok: false, error: "The frame couldn't be added — try again." };
  return { ok: true, key: framed.key, url: framed.url, frame: framed.layout, headline };
}
