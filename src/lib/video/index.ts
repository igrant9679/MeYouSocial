import { env } from "@/lib/env";
import { getApiKey } from "@/lib/llm/keys";
import { snapSceneSeconds } from "@/lib/captions";
import { OMNI_MODEL, renderWithOmni, type VideoImage } from "@/lib/video/omni";

/**
 * Video generation seam (Phase 4). Same house pattern as images/youtube:
 * a provider interface with a mock default; the real provider activates when
 * a Google key resolves (DB Setting `api_key:google` first, then
 * GOOGLE_GENAI_API_KEY).
 *
 * Since 2026-11-24 the real provider is Google's Gemini Omni Flash
 * (`lib/video/omni.ts`) — the model Google's Flow app runs on. Veo rendered here
 * until Google shut down the Veo 3.1 preview models on 22 Oct 2026.
 *
 * A clip is one scene: 4–15 seconds (`SCENE_SECONDS`, capped by
 * VIDEO_MAX_SECONDS). Rendering is synchronous-await (minutes) and therefore
 * only ever called from background processing, never a request path.
 */

export type { VideoImage };

export type VideoRenderRequest = {
  prompt: string;
  seconds: number; // capped by env.VIDEO_MAX_SECONDS
  aspect: "9:16" | "16:9" | "1:1";
  /** Multi-tenant: resolve the Google key for THIS workspace first. */
  workspaceId?: string;
  /** Up to six pictures of a person, character or product to keep the same across the board's scenes. */
  references?: VideoImage[];
  /** The scene starts on this picture (and ends on `lastFrame`) — used instead of the references. */
  firstFrame?: VideoImage | null;
  lastFrame?: VideoImage | null;
};

export type VideoRenderResult = {
  /** A link to the clip ("" when the bytes came back in the answer). */
  url: string;
  /** The clip itself, when the provider returned it inline. */
  bytes?: Buffer;
  mime?: string;
  provider: string;
  seconds: number;
};

export interface VideoProvider {
  name: string;
  render(req: VideoRenderRequest): Promise<VideoRenderResult>;
}

/** The model a real render is billed as — what Usage prices and meters (E-VID-06). */
export const VIDEO_MODEL = OMNI_MODEL;

/**
 * A board's cost at the platform operator's price per second for the model
 * that renders (E-VID-06) — null when no price is set. ⚠ Never a built-in
 * figure: this used env VIDEO_COST_PER_SECOND's guessed default of $0.75.
 */
export async function estimateRenderUsd(seconds: number): Promise<number | null> {
  const { videoPrices } = await import("@/lib/video-spend");
  const p = (await videoPrices())[VIDEO_MODEL];
  return p == null ? null : Math.round(seconds * p * 100) / 100;
}

/**
 * A stored picture made ready to send: JPEG, at most 1280px on its long side
 * (a request carries every image inline). Null when the file is gone or isn't
 * a picture — the caller says which one.
 */
export async function loadVideoImage(key: string): Promise<VideoImage | null> {
  const { storage } = await import("@/lib/storage");
  const raw = await storage.get(key).catch(() => null);
  if (!raw?.length) return null;
  try {
    const sharp = (await import("sharp")).default;
    const data = await sharp(raw).rotate().resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer();
    return { data, mime: "image/jpeg" };
  } catch {
    return null;
  }
}

// ── Mock ─────────────────────────────────────────────────────────────────────

const mockProvider: VideoProvider = {
  name: "mock",
  async render(req) {
    // Clearly-labeled sample output; no cost, instant. Lets the whole pipeline
    // (queue → process → done → UI playback) be exercised without a key.
    return {
      url: "https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
      provider: "mock",
      seconds: snapSceneSeconds(req.seconds),
    };
  },
};

// ── Google (Gemini Omni Flash) ───────────────────────────────────────────────

const googleProvider: VideoProvider = {
  name: "google",
  async render(req) {
    const out = await renderWithOmni(req);
    // A Files link comes back BARE — never with the key in it (it would leak to
    // every member via the UI/DB). It expires in ~2 days and isn't publicly
    // readable, so `persistRenderOutput` downloads it with the key in an
    // `x-goog-api-key` header; `VideoRender.storedUrl` is the durable copy.
    return { url: out.url, bytes: out.bytes, mime: out.mime, provider: "google", seconds: out.seconds };
  },
};

// ── Selection ────────────────────────────────────────────────────────────────
// DB-first: the admin picks the provider in-app (Setting `video:provider` =
// auto | mock | google, set under Settings → Keys). Env USE_MOCK_VIDEO stays as
// the fallback for installs that never touched the setting. "auto" = Google
// when a Google key resolves, else mock. ⚠ A stored "veo" (the value before
// 2026-11-24) means Google: Veo's preview models are gone, Omni replaced them.

export type VideoProviderSetting = "auto" | "mock" | "google";

export async function getVideoProviderSetting(workspaceId?: string): Promise<VideoProviderSetting> {
  try {
    // Multi-tenant: the workspace's own switch wins over the platform's.
    const { getSetting } = await import("@/lib/settings");
    const value = await getSetting("video:provider", workspaceId);
    if (value === "mock" || value === "auto" || value === "google") return value;
    if (value === "veo") return "google";
  } catch {
    // fall through to env behavior
  }
  return env.USE_MOCK_VIDEO ? "mock" : "auto";
}

/** Providers that bill for what they render (a stored render's `provider`; "veo" is the old name). */
export const PAID_VIDEO_PROVIDERS = new Set(["google", "veo"]);

export async function getVideoProvider(workspaceId?: string): Promise<VideoProvider> {
  const setting = await getVideoProviderSetting(workspaceId);
  if (setting === "mock") return mockProvider;
  const key = await getApiKey("google", workspaceId).catch(() => "");
  if (setting === "google") {
    if (!key) throw new Error("Video provider is set to Google but no Google key is configured (Settings → Keys)");
    return googleProvider;
  }
  return key ? googleProvider : mockProvider;
}
