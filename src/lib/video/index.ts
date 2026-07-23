import { env } from "@/lib/env";
import { getApiKey } from "@/lib/llm/keys";

/**
 * Video generation seam (Phase 4). Same house pattern as images/youtube:
 * a provider interface with a mock default; the real provider (Google Veo via
 * @google/genai) activates when USE_MOCK_VIDEO=false and a Google key resolves
 * (DB Setting `api_key:google` first, then GOOGLE_GENAI_API_KEY).
 *
 * Deliberately short-form-first: clip length is capped at VIDEO_MAX_SECONDS
 * (default 8s — one Veo clip). Long-form assembly (multi-clip + ffmpeg stitch)
 * is a later step, gated on infra. Rendering is synchronous-await (minutes) and
 * therefore only ever called from background processing, never a request path.
 */

export type VideoRenderRequest = {
  prompt: string;
  seconds: number; // capped by env.VIDEO_MAX_SECONDS
  aspect: "9:16" | "16:9" | "1:1";
};

export type VideoRenderResult = {
  url: string;
  provider: string;
  seconds: number;
};

export interface VideoProvider {
  name: string;
  render(req: VideoRenderRequest): Promise<VideoRenderResult>;
}

export function estimateCostUsd(seconds: number): number {
  return Math.round(seconds * env.VIDEO_COST_PER_SECOND * 100) / 100;
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
      seconds: Math.min(req.seconds, env.VIDEO_MAX_SECONDS),
    };
  },
};

// ── Google Veo (via @google/genai) ───────────────────────────────────────────

const VEO_MODEL = process.env.VEO_MODEL ?? "veo-3.0-generate-001";
const VEO_POLL_MS = 10_000;
const VEO_TIMEOUT_MS = 6 * 60 * 1000;

const veoProvider: VideoProvider = {
  name: "veo",
  async render(req) {
    const apiKey = await getApiKey("google");
    if (!apiKey) throw new Error("No Google API key configured (Admin → API keys → Google)");

    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });

    let operation = await ai.models.generateVideos({
      model: VEO_MODEL,
      prompt: req.prompt,
      config: {
        aspectRatio: req.aspect,
        numberOfVideos: 1,
      },
    });

    const deadline = Date.now() + VEO_TIMEOUT_MS;
    while (!operation.done) {
      if (Date.now() > deadline) throw new Error("Veo render timed out");
      await new Promise((r) => setTimeout(r, VEO_POLL_MS));
      operation = await ai.operations.getVideosOperation({ operation });
    }

    const video = operation.response?.generatedVideos?.[0]?.video;
    const uri = video?.uri;
    if (!uri) throw new Error("Veo returned no video");
    // Store the BARE file URI — never append the API key (it would leak to
    // every member via the UI/DB). Veo URIs expire in ~2 days; downloading the
    // bytes into StorageProvider at render time is the planned hardening step.
    return { url: uri, provider: "veo", seconds: Math.min(req.seconds, env.VIDEO_MAX_SECONDS) };
  },
};

// ── Selection ────────────────────────────────────────────────────────────────
// DB-first: the admin picks the provider in-app (Setting `video:provider` =
// auto | mock | veo, set under Admin → API keys). Env USE_MOCK_VIDEO stays as
// the fallback for installs that never touched the setting. "auto" = veo when
// a Google key resolves, else mock.

export async function getVideoProviderSetting(): Promise<"auto" | "mock" | "veo"> {
  try {
    const { db } = await import("@/lib/db");
    const row = await db.setting.findUnique({ where: { key: "video:provider" } });
    if (row?.value === "mock" || row?.value === "veo" || row?.value === "auto") return row.value;
  } catch {
    // fall through to env behavior
  }
  return env.USE_MOCK_VIDEO ? "mock" : "auto";
}

export async function getVideoProvider(): Promise<VideoProvider> {
  const setting = await getVideoProviderSetting();
  if (setting === "mock") return mockProvider;
  const key = await getApiKey("google").catch(() => "");
  if (setting === "veo") {
    if (!key) throw new Error("Video provider is set to Veo but no Google key is configured (Admin → API keys)");
    return veoProvider;
  }
  return key ? veoProvider : mockProvider;
}
