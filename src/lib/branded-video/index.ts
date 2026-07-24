import path from "node:path";
import { db } from "@/lib/db";
import { getApiKey } from "@/lib/llm/keys";
import { storage } from "@/lib/storage";
import { writeAudit, isGloballyPaused } from "@/lib/governance";
import { renderOnCloud, HeygenCloudError } from "@/lib/branded-video/heygen-cloud";

/**
 * Branded shorts: one HyperFrames composition (hyperframes/branded-short),
 * themed per workspace from its BrandKit and rendered on HeyGen's cloud. Same
 * house pattern as Veo/TTS — a user-owned key (Setting api_key:heygen, DB-first)
 * gates it; with no key the feature reports "configure a key", never a fake.
 */

// The app's own brand tokens — the defaults when a workspace hasn't set its own
// (mirrors src/app/globals.css). Keep in sync if the app palette changes.
const APP_BRAND = {
  primaryColor: "#E5482F",
  secondaryColor: "#B5371F",
  accentColor: "#FDE7E1",
};

/** Composition dir on disk. next start runs from the repo root, so it's present. */
function templateDir(): string {
  return path.join(process.cwd(), "hyperframes", "branded-short");
}

// ── Contrast ──────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance (0..1). */
function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Readable foreground for text sitting on the brand background. */
function readableText(bg: string): string {
  return luminance(bg) > 0.55 ? "#15181D" : "#FFFFFF";
}

// ── BrandKit → variables ────────────────────────────────────────────────────

export type BrandedShortInput = {
  title: string;
  /** Kicker above the title — e.g. a Topic name or content-type label. */
  eyebrow?: string;
};

export type BrandedShortVariables = {
  title: string;
  eyebrow: string;
  brandName: string;
  footer: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  textColor: string;
};

/**
 * Resolve the render variables for a workspace: its BrandKit colours/footer +
 * name, falling back to the app's own tokens for anything unset. Pure read —
 * safe to call for a preview.
 */
export async function brandKitToVariables(
  workspaceId: string,
  input: BrandedShortInput,
): Promise<BrandedShortVariables> {
  const [kit, workspace] = await Promise.all([
    db.brandKit.findUnique({
      where: { workspaceId },
      select: { primaryColor: true, secondaryColor: true, accentColor: true, footerCredit: true },
    }),
    db.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }),
  ]);

  const primaryColor = kit?.primaryColor?.trim() || APP_BRAND.primaryColor;
  const secondaryColor = kit?.secondaryColor?.trim() || APP_BRAND.secondaryColor;
  const accentColor = kit?.accentColor?.trim() || APP_BRAND.accentColor;
  const brandName = workspace?.name?.trim() || "MeYouSocial";

  return {
    title: input.title.trim().slice(0, 160) || brandName,
    eyebrow: (input.eyebrow?.trim() || "NEW POST").slice(0, 40).toUpperCase(),
    brandName: brandName.slice(0, 40),
    footer: (kit?.footerCredit?.trim() || "").slice(0, 60),
    primaryColor,
    secondaryColor,
    accentColor,
    textColor: readableText(primaryColor),
  };
}

// ── Provider gating ───────────────────────────────────────────────────────────

/** True when a HeyGen key resolves for this workspace (drives UI + the action). */
export async function brandedShortAvailable(workspaceId?: string | null): Promise<boolean> {
  return Boolean(await getApiKey("heygen", workspaceId));
}

// ── Render ─────────────────────────────────────────────────────────────────────

/**
 * Render a branded short end-to-end and persist it. Creates the BrandedShort
 * row up front (status rendering) so the UI has something immediately, then
 * fills in the result. Costs HeyGen credits — callers gate on role. Returns the
 * row id, or null when no key is configured.
 */
export async function renderBrandedShortCore(
  workspaceId: string,
  input: BrandedShortInput & { blogPostId?: string; actorId?: string },
): Promise<string | null> {
  if (await isGloballyPaused(workspaceId)) return null;
  const apiKey = await getApiKey("heygen", workspaceId);
  if (!apiKey) return null;

  const variables = await brandKitToVariables(workspaceId, input);
  const short = await db.brandedShort.create({
    data: {
      workspaceId,
      blogPostId: input.blogPostId ?? null,
      title: variables.title,
      eyebrow: variables.eyebrow,
      status: "rendering",
      provider: "heygen",
      variables: JSON.stringify(variables),
    },
  });

  try {
    const { renderId, videoUrl } = await renderOnCloud({
      apiKey,
      projectDir: templateDir(),
      variables,
      aspectRatio: "9:16",
      fps: 30,
      quality: "standard",
    });

    // Persist the signed URL's bytes — HeyGen's video_url is time-limited.
    let storedUrl: string | null = null;
    try {
      const res = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000), redirect: "follow" });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.byteLength && buf.byteLength < 120 * 1024 * 1024) {
          storedUrl = (await storage.put("branded-short.mp4", buf, res.headers.get("content-type") ?? "video/mp4")).url;
        }
      }
    } catch {
      // keep the signed URL even if persistence failed
    }

    await db.brandedShort.update({
      where: { id: short.id },
      data: { status: "done", renderId, videoUrl, storedUrl },
    });
    await writeAudit({
      workspaceId,
      actorId: input.actorId,
      action: "branded_short.rendered",
      entityType: "branded_short",
      entityId: short.id,
      meta: { renderId, persisted: Boolean(storedUrl) },
    });
    return short.id;
  } catch (e) {
    const message =
      e instanceof HeygenCloudError ? e.message : e instanceof Error ? e.message : "render failed";
    await db.brandedShort.update({
      where: { id: short.id },
      data: { status: "failed", error: message.slice(0, 500) },
    });
    await writeAudit({
      workspaceId,
      actorId: input.actorId,
      action: "branded_short.render_failed",
      entityType: "branded_short",
      entityId: short.id,
      meta: { error: message.slice(0, 200) },
    });
    return short.id;
  }
}
