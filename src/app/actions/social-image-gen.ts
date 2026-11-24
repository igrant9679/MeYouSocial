"use server";

import { requireRole } from "@/lib/acl";
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
      style: ImageStyleId; frame: FrameLayout; headline: string | null; headlineBy: "ai" | "post" | "person" | "article" | null;
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
  const { ownsStoredKey } = await import("@/lib/social/post-image");
  if (!(await ownsStoredKey(workspace.id, baseKey))) return { ok: false, error: "That image isn't in this workspace any more — make a new one." };
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

export type FramePhotoResult =
  | { ok: true; key: string; url: string; baseKey: string; frame: FrameLayout; headline: string | null }
  | { ok: false; error: string };

/** Photos a person frames: big enough for any network, small enough to frame in a request. */
const PHOTO_MAX_BYTES = 25 * 1024 * 1024;

/**
 * "Add frame" on a photo the author attached in Compose (2026-11-24, the owner's "build the Add frame for my own
 * photos"). The photo is stored as it came (the base, owned by this workspace), the workspace's frame is typeset over
 * it (lib/social/post-image.ts frameOwnPicture), and Compose swaps the attachment for the framed copy, which is
 * attached on submit like an AI image. Images only: a video or an animated GIF is refused, not flattened.
 */
export async function frameUploadedPhotoAction(formData: FormData): Promise<FramePhotoResult> {
  const { workspace } = await requireRole("EDITOR");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a photo first." };
  if (file.size > PHOTO_MAX_BYTES) return { ok: false, error: "That photo is over 25 MB — use a smaller copy to frame it." };
  const bytes = Buffer.from(await file.arrayBuffer());
  const sharp = (await import("sharp")).default;
  const meta = await sharp(bytes).metadata().catch(() => null);
  const format = meta?.format ?? "";
  if (!["jpeg", "png", "webp", "heif", "avif", "tiff"].includes(format)) {
    return { ok: false, error: format === "gif" ? "An animated GIF can't be framed — it would lose its animation." : "Only photos can be framed (JPEG, PNG or WebP)." };
  }
  const { storage } = await import("@/lib/storage");
  const ext = format === "jpeg" ? "jpg" : format;
  const base = await storage.put(`photo-${Date.now()}.${ext}`, bytes, `image/${format}`, workspace.id);
  const { frameOwnPicture } = await import("@/lib/social/post-image");
  const res = await frameOwnPicture(workspace.id, base.key, {
    headline: String(formData.get("headline") ?? ""),
    text: String(formData.get("text") ?? ""),
    mayWrite: !(await isGloballyPaused(workspace.id)),
  });
  if (!res.ok) return res;
  await writeAudit({ workspaceId: workspace.id, action: "social.image_framed", entityType: "social_post", meta: { source: "upload", frame: res.frame, ...(res.headlineBy ? { headlineBy: res.headlineBy } : {}) } });
  return { ok: true, key: res.key, url: res.url, baseKey: base.key, frame: res.frame, headline: res.headline };
}

/**
 * "Add frame" on a picture Compose already holds — a Media library image, or an AI image made without its frame. The
 * key must be this workspace's (ownsStoredKey); the original stays as it is and becomes the base.
 */
export async function frameStoredPhotoAction(input: { key: string; headline?: string; text?: string }): Promise<FramePhotoResult> {
  const { workspace } = await requireRole("EDITOR");
  const key = String(input.key ?? "");
  const { ownsStoredKey, frameOwnPicture } = await import("@/lib/social/post-image");
  if (!(await ownsStoredKey(workspace.id, key))) return { ok: false, error: "That picture isn't in this workspace." };
  const res = await frameOwnPicture(workspace.id, key, {
    headline: input.headline ?? "",
    text: input.text ?? "",
    mayWrite: !(await isGloballyPaused(workspace.id)),
  });
  if (!res.ok) return res;
  await writeAudit({ workspaceId: workspace.id, action: "social.image_framed", entityType: "social_post", meta: { source: "stored", frame: res.frame, ...(res.headlineBy ? { headlineBy: res.headlineBy } : {}) } });
  return { ok: true, key: res.key, url: res.url, baseKey: key, frame: res.frame, headline: res.headline };
}
