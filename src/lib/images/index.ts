import { env } from "@/lib/env";
import { getApiKey } from "@/lib/llm/keys";
import { storage } from "@/lib/storage";

/**
 * Image generation seam. Same house pattern as `lib/video` and `lib/llm`:
 * a provider interface, a DB-first per-workspace switch, and keys resolved
 * through `getApiKey` so each company brings its own.
 *
 * ── What was here before ────────────────────────────────────────────────────
 * `export const images = env.USE_MOCK_IMAGES ? mock : mock` — BOTH branches
 * were the mock, so the flag did nothing and there was no real provider at all.
 * Every "generated" image was a random stock photo from picsum seeded by the
 * prompt. That is a worse failure than the LLM's mock fallback, because it is
 * success-shaped: you get a real, attractive photograph that simply has nothing
 * to do with your title, so it reads as finished work rather than as a
 * placeholder. Thumbnails, blog featured/OG images and audience photos were all
 * affected, and `requireImagesToPublish` defaults ON, so publishing could be
 * gated behind an image that could only ever be stock.
 *
 * ── Bytes are STORED, not hot-linked ────────────────────────────────────────
 * Both real providers hand back raw bytes (base64), and both are written
 * straight into StorageProvider so the URL we persist is our own, permanent and
 * session-gated. This is deliberately unlike `lib/video`, which stores a bare
 * Veo URI that expires in ~2 days — the known weak spot there. An image that
 * 404s a week after publication is worse than one that took a second longer to
 * make.
 *
 * ── Failure is loud ─────────────────────────────────────────────────────────
 * A selected real provider that fails THROWS. It must never quietly hand back a
 * placeholder that looks like a finished render — that is precisely the bug
 * this file used to be. Callers that run unattended catch it and record the
 * failure. `mock` is only ever reached when it is chosen, or when "auto" finds
 * no usable key, and it labels itself in the returned `provider`.
 */

export type ImageGenRequest = {
  prompt: string;
  aspectRatio?: "16:9" | "1:1" | "9:16";
  /** Optional reference image (clone/remix mode). */
  referenceUrl?: string;
  /** Multi-tenant: resolve the provider key for THIS workspace first. */
  workspaceId?: string;
  /**
   * Post-process before storing: cover-resize to EXACTLY this size. The sharp
   * re-encode this implies also drops embedded metadata (EXIF/XMP/C2PA content
   * credentials) — the same strip social publishing does at its wire, done at
   * storage time instead because these bytes leave through many doors
   * (WordPress media upload, og:image scrapes, manual download). Provenance
   * still lives in the DB: audit rows and `source`/`provider` name the
   * generator. ⚠ Google SynthID is pixel-level and SURVIVES this — Gemini
   * images may still be detected by SynthID readers. Best-effort: on any
   * sharp failure the original bytes are stored (a post-process nicety must
   * never turn a paid render into nothing).
   */
  output?: { width: number; height: number };
};

export type ImageGenResult = {
  url: string;
  width: number;
  height: number;
  /** "mock" | "openai" | "google" — surface this; a placeholder must be nameable. */
  provider: string;
  /** StorageProvider key for the stored bytes. Absent for the mock, whose
   *  "image" is a hot-linked stock URL with no stored bytes behind it. */
  key?: string;
};

export interface ImageProvider {
  name: string;
  generate(req: ImageGenRequest): Promise<ImageGenResult>;
}

export type ImageProviderId = "auto" | "mock" | "openai" | "google";

/** Nominal dimensions per aspect — only used for the mock, and as a last
 *  resort if a real image's header can't be parsed. */
const DIMS: Record<string, [number, number]> = {
  "16:9": [1536, 864],
  "1:1": [1024, 1024],
  "9:16": [864, 1536],
};

function dimsFor(aspect: string): [number, number] {
  return DIMS[aspect] ?? DIMS["16:9"];
}

/**
 * Real pixel dimensions, read from the bytes: PNG IHDR, or the first JPEG SOFn.
 *
 * Worth the twenty lines rather than echoing back whatever we asked for —
 * providers don't always honour the request (Gemini returns 1376x768 for
 * "16:9", not 1536x864), and `BlogImage.width/height` feeds the asset gate.
 * Recording the size we wanted instead of the size we got would be a small
 * invented number in a codebase that has been bitten by those before.
 */
function dimsOfBytes(buf: Buffer): [number, number] | null {
  if (buf.length > 24 && buf.toString("ascii", 1, 4) === "PNG") {
    return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xff) { o++; continue; }
      const marker = buf[o + 1];
      // SOF0–SOF15 carry the frame size; skip DHT (c4), JPG (c8), DAC (cc).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return [buf.readUInt16BE(o + 7), buf.readUInt16BE(o + 5)];
      }
      o += 2 + buf.readUInt16BE(o + 2);
    }
  }
  return null;
}

/** Persist raw bytes and hand back our own durable, session-gated URL. */
async function store(
  bytes: Uint8Array,
  aspect: string,
  provider: string,
  mimeType = "image/png",
  output?: { width: number; height: number },
): Promise<ImageGenResult> {
  let buf = Buffer.from(bytes);
  if (output && output.width > 0 && output.height > 0) {
    try {
      const sharp = (await import("sharp")).default;
      // No explicit format: sharp keeps the input format, so mimeType stays
      // true. `rotate()` bakes EXIF orientation in before EXIF is dropped;
      // `cover` crops rather than distorting. The re-encode is what strips
      // C2PA/XMP — see ImageGenRequest.output for the full reasoning.
      buf = await sharp(buf).rotate().resize(output.width, output.height, { fit: "cover" }).toBuffer();
    } catch (e) {
      console.warn("[images] output transform failed — storing original bytes:", e instanceof Error ? e.message : e);
    }
  }
  // Measured from what we actually stored, never echoed from the request.
  const [w, h] = dimsOfBytes(buf) ?? dimsFor(aspect);
  const ext = mimeType.includes("jpeg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png";
  const file = await storage.put(`${provider}-${Date.now()}.${ext}`, buf, mimeType);
  return { url: file.url, width: w, height: h, provider, key: file.key };
}

// ── Mock ─────────────────────────────────────────────────────────────────────

function placeholder(prompt: string, aspect: string): string {
  const dims = aspect === "1:1" ? "640/640" : aspect === "9:16" ? "405/720" : "1280/720";
  const seed = encodeURIComponent(prompt.slice(0, 32) || "meyousocial");
  return `https://picsum.photos/seed/${seed}/${dims}`;
}

const mockProvider: ImageProvider = {
  name: "mock",
  async generate(req) {
    const aspect = req.aspectRatio ?? "16:9";
    const [w, h] = dimsFor(aspect);
    // Still a stock photo — but it now says so in `provider`, and it is only
    // reached when mock was chosen or no key exists. The UI keys its
    // "this is a placeholder" notice off this value rather than assuming.
    return { url: placeholder(req.prompt, aspect), width: w, height: h, provider: "mock" };
  },
};

// ── OpenAI (gpt-image-1) ─────────────────────────────────────────────────────
// Hand-written REST rather than the SDK, matching `lib/zernio`: one documented
// endpoint isn't worth another package in the Next bundle graph.

const OPENAI_MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1";
const OPENAI_TIMEOUT_MS = 120_000;

/** gpt-image-1 accepts a fixed set of sizes; map our aspects onto them. */
function openaiSize(aspect: string): string {
  return aspect === "1:1" ? "1024x1024" : aspect === "9:16" ? "1024x1536" : "1536x1024";
}

const openaiProvider: ImageProvider = {
  name: "openai",
  async generate(req) {
    const apiKey = await getApiKey("openai", req.workspaceId);
    if (!apiKey) throw new Error("No OpenAI key configured (Admin → API keys → OpenAI)");
    const aspect = req.aspectRatio ?? "16:9";

    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        prompt: req.prompt.slice(0, 4000),
        size: openaiSize(aspect),
        n: 1,
      }),
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    });

    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 300);
      try {
        const j = JSON.parse(text) as { error?: { message?: string } };
        if (j.error?.message) detail = j.error.message;
      } catch { /* keep raw */ }
      // ⚠ "TPM: Limit 0" is not rate limiting — it means the OpenAI org behind
      // this key has NO gpt-image quota at all, which is how OpenAI presents
      // an org that hasn't completed identity verification for image models.
      // Surfaced 2026-08-06 as a cryptic 429; name the actual fix.
      if (res.status === 429 && /limit[:\s]*0/i.test(detail)) {
        throw new Error(
          `This OpenAI organization has no ${OPENAI_MODEL} quota (limit 0) — image models need a VERIFIED OpenAI organization. ` +
          `Verify it at platform.openai.com → Settings → Organization → Verification, or add a Google key under Admin → API keys to use Gemini images instead.`,
        );
      }
      throw new Error(`OpenAI image generation failed (HTTP ${res.status}): ${detail}`);
    }

    const body = JSON.parse(text) as { data?: { b64_json?: string; url?: string }[] };
    const first = body.data?.[0];
    // gpt-image-1 always returns base64; older models could return a URL, so
    // accept that too rather than breaking on a model swap.
    if (first?.b64_json) return store(Buffer.from(first.b64_json, "base64"), aspect, "openai", "image/png", req.output);
    if (first?.url) {
      const img = await fetch(first.url, { signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS) });
      if (!img.ok) throw new Error(`Could not download the generated image (HTTP ${img.status}).`);
      return store(new Uint8Array(await img.arrayBuffer()), aspect, "openai", "image/png", req.output);
    }
    throw new Error("OpenAI returned no image data.");
  },
};

// ── Google (Gemini native image output, via @google/genai) ───────────────────
// The SDK is already a dependency — `lib/video` uses it for Veo — so there's no
// bundle cost here, unlike the OpenAI case.
//
// ⚠ NOT Imagen, and not `generateImages()`. Probed against the live key on
// 2026-07-28: `models.list()` advertises `imagen-4.0-generate-001` (and the
// -ultra / -fast variants) as supporting `predict`, but actually calling any of
// them 404s with "no longer available to new users" — the SAME trap already
// recorded for gemini-2.5-pro. The `gemini-*-image` models DO work, through
// ordinary `generateContent`, returning the picture as an inlineData part.
// Don't "upgrade" this back to Imagen without probing the key first.

const GOOGLE_MODEL = process.env.GOOGLE_IMAGE_MODEL ?? "gemini-3.1-flash-image";

const googleProvider: ImageProvider = {
  name: "google",
  async generate(req) {
    const apiKey = await getApiKey("google", req.workspaceId);
    if (!apiKey) throw new Error("No Google key configured (Admin → API keys → Google)");
    const aspect = req.aspectRatio ?? "16:9";

    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });

    let res;
    try {
      res = await ai.models.generateContent({
        model: GOOGLE_MODEL,
        contents: req.prompt.slice(0, 4000),
        // Honoured — verified 16:9 → 1376x768 and 1:1 → 1024x1024 on the live key.
        config: { imageConfig: { aspectRatio: aspect } },
      } as Parameters<typeof ai.models.generateContent>[0]);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      // ⚠ "free_tier_requests, limit: 0" is not a rate limit you can wait out:
      // Gemini's IMAGE models have no free tier at all, so a key from a
      // project without billing gets quota zero. Name the real fix.
      if (/free_tier/i.test(raw) && /limit:\s*0/i.test(raw)) {
        throw new Error(
          `This Google key's project has no billing enabled — Gemini image models have NO free tier (quota 0). ` +
          `Enable billing on the project in Google Cloud Console, or paste a key from a project that already has billing.`,
        );
      }
      throw new Error(`Google image generation failed: ${raw.slice(0, 300)}`);
    }

    const parts = res.candidates?.[0]?.content?.parts ?? [];
    const inline = (parts.find((p) => (p as { inlineData?: unknown }).inlineData) as
      | { inlineData?: { data?: string; mimeType?: string } }
      | undefined)?.inlineData;

    if (!inline?.data) {
      // When Gemini declines it answers in prose instead of pictures, so quote
      // that back rather than reporting a blank "unknown error".
      const said = parts.map((p) => (p as { text?: string }).text ?? "").join(" ").trim();
      throw new Error(
        said
          ? `Google returned no image. It replied: ${said.slice(0, 200)}`
          : "Google returned no image — the prompt may have been refused by its safety filters.",
      );
    }
    return store(Buffer.from(inline.data, "base64"), aspect, "google", inline.mimeType ?? "image/png", req.output);
  },
};

// ── Selection ────────────────────────────────────────────────────────────────

const PROVIDERS: Record<Exclude<ImageProviderId, "auto">, ImageProvider> = {
  mock: mockProvider,
  openai: openaiProvider,
  google: googleProvider,
};

/** DB-first, workspace-scoped, exactly like `video:provider`. */
export async function getImageProviderSetting(workspaceId?: string): Promise<ImageProviderId> {
  try {
    const { getSetting } = await import("@/lib/settings");
    const value = await getSetting("image:provider", workspaceId);
    if (value === "mock" || value === "openai" || value === "google" || value === "auto") return value;
  } catch {
    // fall through to env behaviour
  }
  // USE_MOCK_IMAGES survives only as the never-configured default.
  return env.USE_MOCK_IMAGES ? "mock" : "auto";
}

/**
 * Resolve the provider for a workspace.
 *
 * "auto" prefers OpenAI, then Google, then mock — not a quality judgement, just
 * that gpt-image-1 renders legible text far more reliably, and a thumbnail with
 * words on it is the main thing this app asks for.
 */
export async function getImageProvider(workspaceId?: string): Promise<ImageProvider> {
  const setting = await getImageProviderSetting(workspaceId);
  if (setting !== "auto") return PROVIDERS[setting];
  const hasOpenai = Boolean(await getApiKey("openai", workspaceId).catch(() => ""));
  const hasGoogle = Boolean(await getApiKey("google", workspaceId).catch(() => ""));
  // Fallback sits UPSTREAM of the likeliest failure: in auto mode with both
  // keys, an OpenAI failure (unverified org, quota, outage) retries on Google
  // instead of dying — the result names whichever provider actually rendered.
  // An explicitly CHOSEN provider still fails loudly, per the house rule.
  if (hasOpenai && hasGoogle) {
    return {
      name: "openai",
      async generate(req) {
        try {
          return await openaiProvider.generate(req);
        } catch (openaiErr) {
          try {
            return await googleProvider.generate(req);
          } catch (googleErr) {
            // BOTH failed — report both, or the fallback's failure is
            // undiagnosable (cost a probe on 2026-08-07: Google's "no billing
            // on this project" hid behind OpenAI's "unverified org").
            const o = openaiErr instanceof Error ? openaiErr.message : String(openaiErr);
            const g = googleErr instanceof Error ? googleErr.message : String(googleErr);
            throw new Error(`Both image providers failed. OpenAI: ${o.slice(0, 220)} — Google fallback: ${g.slice(0, 220)}`);
          }
        }
      },
    };
  }
  if (hasOpenai) return openaiProvider;
  if (hasGoogle) return googleProvider;
  return mockProvider;
}

/** Which provider "auto" would land on — for the admin UI, without generating. */
export async function resolveImageProviderName(workspaceId?: string): Promise<string> {
  return (await getImageProvider(workspaceId)).name;
}

/**
 * The seam every caller uses. Dispatches per workspace on each call rather than
 * being resolved once at import, so a key pasted in the admin UI takes effect
 * without a redeploy — the same contract as the LLM router.
 */
export const images: ImageProvider = {
  name: "dispatch",
  async generate(req) {
    const provider = await getImageProvider(req.workspaceId);
    return provider.generate(req);
  },
};
