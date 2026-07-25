import path from "node:path";
import { promises as fs } from "node:fs";
import { db } from "@/lib/db";
import { getApiKey } from "@/lib/llm/keys";
import { getSetting } from "@/lib/settings";
import { storage } from "@/lib/storage";
import { writeAudit, isGloballyPaused } from "@/lib/governance";
import { renderOnCloud, HeygenCloudError } from "@/lib/branded-video/heygen-cloud";
import { localRenderAvailable, renderLocally } from "@/lib/branded-video/local-render";

/**
 * Branded shorts: one HyperFrames composition (hyperframes/branded-short),
 * themed per workspace from its BrandKit.
 *
 * Two render paths, resolved per call (Setting branded_short:mode, default
 * "auto"):
 *  - local  — free; shells the HyperFrames CLI when a real Chrome is present.
 *  - cloud  — HeyGen's HyperFrames cloud (pay-per-credit); needs api_key:heygen.
 * "auto" prefers local when available (free), else cloud. Railway has no Chrome,
 * so it lands on cloud there; a dev/self-hosted box renders free. With neither
 * available the feature says so — never a fake, same house pattern as Veo/TTS.
 */

export type RenderMode = "auto" | "local" | "cloud";

async function resolveRenderMode(workspaceId?: string | null): Promise<RenderMode> {
  const v = await getSetting("branded_short:mode", workspaceId).catch(() => "");
  if (v === "local" || v === "cloud" || v === "auto") return v;
  return (process.env.BRANDED_SHORT_MODE as RenderMode) || "auto";
}

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

export type BrandedShortReadiness = {
  ready: boolean;
  /** Which path a render would take right now, or null when nothing is set up. */
  mode: "local" | "cloud" | null;
  cloudKey: boolean;
  localChrome: boolean;
};

/**
 * What a render would do right now — drives the UI (button vs. how-to notice).
 * ready = a render can actually run: local Chrome present, or a HeyGen key set.
 */
export async function brandedShortReadiness(workspaceId?: string | null): Promise<BrandedShortReadiness> {
  const [cloudKey, forced] = await Promise.all([
    getApiKey("heygen", workspaceId).then(Boolean),
    resolveRenderMode(workspaceId),
  ]);
  const localChrome = localRenderAvailable();
  let mode: "local" | "cloud" | null = null;
  if (forced === "local") mode = localChrome ? "local" : null;
  else if (forced === "cloud") mode = cloudKey ? "cloud" : null;
  else mode = localChrome ? "local" : cloudKey ? "cloud" : null; // auto
  return { ready: mode !== null, mode, cloudKey, localChrome };
}

/** Back-comp boolean used by simple call sites. */
export async function brandedShortAvailable(workspaceId?: string | null): Promise<boolean> {
  return (await brandedShortReadiness(workspaceId)).ready;
}

// ── Render ─────────────────────────────────────────────────────────────────────

/** Persist an MP4 buffer through the storage layer; null if it couldn't. */
async function persistMp4(buf: Buffer): Promise<string | null> {
  if (!buf.byteLength || buf.byteLength > 120 * 1024 * 1024) return null;
  try {
    return (await storage.put("branded-short.mp4", buf, "video/mp4")).url;
  } catch {
    return null;
  }
}

/**
 * Render a branded short end-to-end and persist it. Creates the BrandedShort
 * row up front (status rendering) so the UI has something immediately, then
 * fills in the result. Routes local (free) vs cloud (paid) per resolveRenderMode.
 * Returns the row id, or null when neither path is available (no Chrome, no key).
 */
export async function renderBrandedShortCore(
  workspaceId: string,
  input: BrandedShortInput & { blogPostId?: string; actorId?: string },
): Promise<string | null> {
  if (await isGloballyPaused(workspaceId)) return null;
  const readiness = await brandedShortReadiness(workspaceId);
  if (!readiness.ready || !readiness.mode) return null;
  const mode = readiness.mode;

  const variables = await brandKitToVariables(workspaceId, input);
  const short = await db.brandedShort.create({
    data: {
      workspaceId,
      blogPostId: input.blogPostId ?? null,
      title: variables.title,
      eyebrow: variables.eyebrow,
      status: "rendering",
      provider: mode === "local" ? "local" : "heygen",
      variables: JSON.stringify(variables),
    },
  });

  try {
    let videoUrl: string | null = null;
    let renderId: string | null = null;
    let storedUrl: string | null = null;

    if (mode === "local") {
      const { outputPath, cleanup } = await renderLocally({ projectDir: templateDir(), variables, fps: 30 });
      try {
        storedUrl = await persistMp4(await fs.readFile(outputPath));
      } finally {
        await cleanup();
      }
      if (!storedUrl) throw new Error("Local render produced a file but it could not be stored");
    } else {
      const apiKey = await getApiKey("heygen", workspaceId);
      const out = await renderOnCloud({
        apiKey,
        projectDir: templateDir(),
        variables,
        aspectRatio: "9:16",
        fps: 30,
        quality: "standard",
      });
      renderId = out.renderId;
      videoUrl = out.videoUrl;
      // Persist the signed URL's bytes — HeyGen's video_url is time-limited.
      try {
        const res = await fetch(out.videoUrl, { signal: AbortSignal.timeout(120_000), redirect: "follow" });
        if (res.ok) storedUrl = await persistMp4(Buffer.from(await res.arrayBuffer()));
      } catch {
        // keep the signed URL even if persistence failed
      }
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
      meta: { mode, renderId, persisted: Boolean(storedUrl) },
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
      meta: { mode, error: message.slice(0, 200) },
    });
    return short.id;
  }
}
