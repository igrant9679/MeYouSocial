import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { storage } from "@/lib/storage";
import { readJson } from "@/lib/db/json";
import { loadBrandLogo } from "@/lib/images/lockup";
import { frameSocialImage } from "@/lib/images/social-frame";
import type { ImageProvider } from "@/lib/images";
import { socialImagePrompt } from "@/lib/social/image-prompt";
import { IMAGE_STYLE_KEY, isImageStyleId, parseImageStyle, pickMixStyle, type ImageStyleId } from "@/lib/social/image-styles";
import {
  FRAME_HANDLE_KEY, FRAME_ICONS_KEY, FRAME_KEY, FRAME_WEBSITE_KEY,
  cleanHandle, cleanHeadline, frameHasHeadline, handleFromAccounts, headlineFromText, parseFrameLayout, websiteLabel,
  type FrameLayout,
} from "@/lib/social/frame";

/**
 * A post's picture, made one way (2026-11-23): the background job (`social.autoimage`, lib/jobs/social-image.ts)
 * and Compose's AI image button (actions/social-image-gen.ts) both come here, so a style or a frame can't apply to
 * one and not the other.
 *
 *   1. the style: the one asked for, else the workspace's (Mix = the style used longest ago, read from the audit
 *      rows both callers write);
 *   2. the render, text-free (lib/social/image-prompt.ts), stored as it came — the BASE, kept so a headline can be
 *      changed later without paying for another render;
 *   3. when the workspace has a frame and this image wants one: the headline (a model's few words, checked, else
 *      the post's own first sentence), and the frame typeset over the base and stored as the image the post uses.
 *
 * A frame that fails leaves the plain picture and says why (`frameNote`): the render was paid for and is good.
 */

export const LOGO_MIN_PX_FOR_FRAME = 40;

export type FrameDetails = {
  layout: FrameLayout;
  brandName: string;
  logo: Buffer | null;
  handle: string | null;
  website: string | null;
  networks: string[];
  colors: { primary: string | null; secondary: string | null; accent: string | null };
  /** The brand kit's colours that are real hex values, for the prompt. */
  palette: string[];
};

/** Everything the frame draws, read from the workspace: Brand → Post images, the brand kit, the accounts. */
export async function frameDetails(workspaceId: string): Promise<FrameDetails> {
  const [layoutRaw, handleRaw, websiteRaw, iconsRaw, gscSite, kit, ws, accounts, wp, logo] = await Promise.all([
    getSetting(FRAME_KEY, workspaceId).catch(() => ""),
    getSetting(FRAME_HANDLE_KEY, workspaceId).catch(() => ""),
    getSetting(FRAME_WEBSITE_KEY, workspaceId).catch(() => ""),
    getSetting(FRAME_ICONS_KEY, workspaceId).catch(() => ""),
    getSetting("gsc:site_url", workspaceId).catch(() => ""),
    db.brandKit.findUnique({ where: { workspaceId }, select: { primaryColor: true, secondaryColor: true, accentColor: true } }),
    db.workspace.findUnique({ where: { id: workspaceId }, select: { name: true, accentColor: true } }),
    db.zernioAccount.findMany({ where: { workspaceId, status: "connected" }, select: { platform: true, username: true }, orderBy: { createdAt: "asc" } }),
    db.wordPressConnection.findUnique({ where: { workspaceId }, select: { baseUrl: true } }),
    loadBrandLogo(workspaceId, LOGO_MIN_PX_FOR_FRAME).catch(() => null),
  ]);
  const hex = (v: string | null | undefined) => (v && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : null);
  const colors = {
    primary: hex(kit?.primaryColor) ?? hex(ws?.accentColor),
    secondary: hex(kit?.secondaryColor),
    accent: hex(kit?.accentColor),
  };
  return {
    layout: parseFrameLayout(layoutRaw),
    brandName: ws?.name ?? "",
    logo,
    handle: cleanHandle(handleRaw) ?? handleFromAccounts(accounts),
    website: websiteLabel(websiteRaw) ?? websiteLabel(wp?.baseUrl) ?? websiteLabel(gscSite.replace(/^sc-domain:/, "")),
    networks: iconsRaw === "false" ? [] : accounts.map((a) => a.platform),
    colors,
    palette: [colors.primary, colors.secondary, colors.accent].filter((c): c is string => Boolean(c)),
  };
}

/** The style for one image: the one asked for, else the workspace's; Mix picks the style used longest ago. */
export async function resolveStyle(workspaceId: string, requested?: string | null): Promise<ImageStyleId> {
  if (isImageStyleId(requested)) return requested;
  const setting = parseImageStyle(await getSetting(IMAGE_STYLE_KEY, workspaceId).catch(() => ""));
  if (setting !== "mix") return setting;
  const rows = await db.auditLog.findMany({
    where: { workspaceId, action: { in: ["social.autoimage", "social.composer_image"] } },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { meta: true },
  });
  const recent = rows.map((r) => readJson<{ style?: string }>(r.meta, {}).style).filter((s): s is string => Boolean(s));
  return pickMixStyle(recent);
}

/**
 * The few words the frame sets: a model writes them from the post, and they're checked (cleaned, 2–10 words, no
 * hashtags); a mock reply, a failure or a reply that isn't a headline falls back to the post's own first sentence.
 * `by` says which, so the UI can say so.
 */
export async function writeHeadline(workspaceId: string, text: string): Promise<{ headline: string; by: "ai" | "post" }> {
  const fallback = { headline: headlineFromText(text), by: "post" as const };
  try {
    const { llm, resolveUsableModel } = await import("@/lib/llm");
    const model = await resolveUsableModel("", workspaceId, "social.headline");
    const res = await llm.complete({
      purpose: "social.headline",
      model,
      system:
        "You write the headline that is set in large type on the image of a company's social media post. " +
        "Return ONLY the headline: 3 to 8 words, Title Case, no quotation marks, no hashtags, no emoji, no full stop at the end. " +
        "Say what the post is about in its own spirit. ⚠ Never add a fact, number, name or claim the post doesn't make.",
      messages: [{ role: "user", content: `The post:\n${text.replace(/https?:\/\/\S+/g, "").trim().slice(0, 1200)}` }],
      workspaceId,
      maxTokens: 120,
    });
    if (res.provider === "mock") return fallback;
    const line = cleanHeadline(String(res.content ?? "").split(/\n+/).map((l) => l.trim()).find(Boolean) ?? "");
    const words = line.split(/\s+/).filter(Boolean).length;
    if (line.length < 6 || words < 2 || words > 10 || /[#@]/.test(line)) return fallback;
    return { headline: line, by: "ai" };
  } catch {
    return fallback;
  }
}

/** Frame a stored picture and store the result. Null (with the reason logged) when it can't be done. */
export async function frameStoredImage(
  workspaceId: string,
  baseKey: string,
  details: FrameDetails,
  headline: string | null,
): Promise<{ key: string; url: string; width: number; height: number; layout: FrameLayout } | null> {
  if (details.layout === "off") return null;
  try {
    const base = await storage.get(baseKey);
    if (!base) return null;
    const framed = await frameSocialImage(base, {
      layout: details.layout,
      headline,
      brandName: details.brandName,
      logo: details.logo,
      handle: details.handle,
      website: details.website,
      networks: details.networks,
      colors: details.colors,
    });
    const file = await storage.put(`framed-${Date.now()}.jpg`, framed.bytes, framed.contentType, workspaceId);
    return { key: file.key, url: file.url, width: framed.width, height: framed.height, layout: framed.layout };
  } catch (e) {
    console.warn(`[post-image] ${workspaceId}: the frame couldn't be added —`, e instanceof Error ? e.message : e);
    return null;
  }
}

export type PostImageResult = {
  key: string;
  url: string;
  width: number;
  height: number;
  provider: string;
  style: ImageStyleId;
  /** The frame the stored image wears ("off" = none). */
  frame: FrameLayout;
  /** Set when a frame was wanted and isn't there. */
  frameNote: string | null;
  headline: string | null;
  headlineBy: "ai" | "post" | "person" | "article" | null;
  /** The picture without its frame, for changing the headline later. Same as `key` when unframed. */
  baseKey: string;
};

/**
 * Render a post's picture. `provider` is the workspace's real image provider (callers refuse the mock first).
 * `frame: false` skips the workspace's frame for this image; `headline` set by a person wins over a written one.
 * Throws when the render fails (callers record it); a frame that fails only adds `frameNote`.
 */
export async function renderPostImage(opts: {
  workspaceId: string;
  provider: ImageProvider;
  text: string;
  aspect: "1:1" | "16:9";
  campaign?: string | null;
  guidance?: string | null;
  style?: string | null;
  frame?: boolean;
  headline?: string | null;
  /** Who gave `headline`: a person (Compose), or an article share (its title). */
  headlineFrom?: "person" | "article";
}): Promise<PostImageResult> {
  const { workspaceId } = opts;
  const [style, details] = await Promise.all([resolveStyle(workspaceId, opts.style), frameDetails(workspaceId)]);
  const layout: FrameLayout = opts.frame === false ? "off" : details.layout;
  const prompt = socialImagePrompt({
    text: opts.text,
    campaign: opts.campaign ?? null,
    guidance: opts.guidance ?? null,
    style,
    palette: details.palette,
    frame: layout,
  });
  const ownHeadline = cleanHeadline(opts.headline);
  // The render and the headline at the same time: the headline is a few seconds, the render ten.
  const [img, written] = await Promise.all([
    opts.provider.generate({ prompt, aspectRatio: opts.aspect, workspaceId }),
    frameHasHeadline(layout) && !ownHeadline ? writeHeadline(workspaceId, opts.text) : Promise.resolve(null),
  ]);
  if (!img.key) throw new Error(`The ${img.provider} provider returned no stored image — try again.`);
  const plain: PostImageResult = {
    key: img.key, url: img.url, width: img.width, height: img.height, provider: img.provider, style,
    frame: "off", frameNote: null, headline: null, headlineBy: null, baseKey: img.key,
  };
  if (layout === "off") return plain;
  const headline = frameHasHeadline(layout) ? ownHeadline || written?.headline || "" : null;
  const framed = await frameStoredImage(workspaceId, img.key, { ...details, layout }, headline);
  if (!framed) return { ...plain, frameNote: "The branded frame couldn't be added, so this is the plain picture." };
  return {
    ...plain,
    key: framed.key, url: framed.url, width: framed.width, height: framed.height,
    frame: framed.layout,
    headline: frameHasHeadline(framed.layout) ? headline : null,
    headlineBy: frameHasHeadline(framed.layout) ? (ownHeadline ? opts.headlineFrom ?? "person" : written?.by ?? null) : null,
  };
}
