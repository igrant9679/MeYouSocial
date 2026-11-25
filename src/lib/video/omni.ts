import http from "node:http";
import https from "node:https";
import { getApiKey } from "@/lib/llm/keys";

/**
 * Google video through Gemini Omni Flash (2026-11-24, the owner's "Yes, do it here" — "Google Flow support").
 *
 * ⚠ Why: Google shut down the Veo 3.1 PREVIEW models in the Gemini API on 22 Oct 2026 (veo-3.1-fast-generate-preview
 * was what rendered here), and names Gemini Omni Flash — the model Google's Flow app runs on — as the replacement.
 * Flow itself has no public API; this is its engine, through the Gemini API with the workspace's Google key.
 *
 * It is NOT predictLongRunning: Omni goes through the Interactions API, `POST /v1beta/interactions`, which answers
 * when the video is made. So the call is held open for minutes (node:http, not fetch — fetch gives up on a response
 * that takes longer than five minutes to start). If an answer ever comes back unfinished, the interaction is read
 * again until it has its video.
 *
 * What a render sends (`omniRequestBody`, pure): the prompt; `response_format` = video, the board's aspect ratio
 * (9:16 or 16:9), 720p, and the scene's seconds (3–15; 3–10 with start/end images); `delivery: "uri"`, so a big clip
 * comes back as a Files link that `persistRenderOutput` downloads with the key in a HEADER. Images go before the text
 * as `{type:"image", data, mime_type}` parts: a scene's start (and end) image — order is how Google tells them apart —
 * or else up to six reference images of a person or product to keep the same across scenes, with the task named.
 *
 * ⚠ Probe before trusting a new id: `VIDEO_MODEL` overrides the model (Google moves ids — gemini-omni-1.1-flash
 * routes to 1.2 on 3 Dec 2026), and the first real render is the probe.
 */

export const OMNI_MODEL = process.env.VIDEO_MODEL ?? "gemini-omni-1.2-flash";
const CALL_TIMEOUT_MS = 10 * 60_000;
const POLL_MS = 5_000;
const POLL_FOR_MS = 8 * 60_000;
const FILE_READY_FOR_MS = 3 * 60_000;

/** The Gemini API's origin. `GEMINI_API_BASE` exists so a check can point it at a local stand-in. */
export const geminiBase = (): string => (process.env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com").replace(/\/+$/, "");

/** True for a link to a file the Gemini API holds — it needs the key (in a header) to download. */
export function isGeminiFileUrl(url: string): boolean {
  return /generativelanguage\.googleapis\.com/.test(url) || (url.startsWith(geminiBase()) && /\/files\//.test(url));
}

export type VideoImage = { data: Buffer; mime: string };

export type OmniInput = {
  prompt: string;
  seconds: number;
  aspect: "9:16" | "16:9" | "1:1";
  references?: VideoImage[];
  firstFrame?: VideoImage | null;
  lastFrame?: VideoImage | null;
};

/** Omni's lengths: any whole second from 3 to 15, and 3 to 10 when a scene starts or ends on an image. */
export function omniSeconds(seconds: number, withFrames: boolean): number {
  const max = withFrames ? 10 : 15;
  return Math.min(max, Math.max(3, Math.round(Number.isFinite(seconds) ? seconds : 8)));
}

const imagePart = (img: VideoImage) => ({ type: "image", data: img.data.toString("base64"), mime_type: img.mime });

/** The request a render sends (pure — the checks read it). */
export function omniRequestBody(req: OmniInput, model = OMNI_MODEL): Record<string, unknown> {
  if (req.aspect !== "9:16" && req.aspect !== "16:9") {
    throw new Error(`Gemini Omni Flash renders 9:16 or 16:9 video, not ${req.aspect} — change the board's shape.`);
  }
  const frames = [req.firstFrame, req.lastFrame].filter((f): f is VideoImage => !!f);
  const refs = frames.length ? [] : (req.references ?? []).slice(0, 6);
  const seconds = omniSeconds(req.seconds, frames.length > 0);
  const guide = frames.length === 2
    ? " Start exactly on the first image and end exactly on the second."
    : frames.length === 1
      ? " Start exactly on the image given."
      : refs.length
        ? " Keep every person, character and product in the reference images looking exactly the same."
        : "";
  const text = `${req.prompt.trim()}${guide}`;
  const parts = [...frames, ...refs];
  return {
    model,
    input: parts.length ? [...parts.map(imagePart), { type: "text", text }] : text,
    response_format: { type: "video", aspect_ratio: req.aspect, resolution: "720p", duration: `${seconds}s`, delivery: "uri" },
    ...(frames.length
      ? { generation_config: { video_config: { task: "image_to_video" } } }
      : refs.length
        ? { generation_config: { video_config: { task: "reference_to_video" } } }
        : {}),
  };
}

type Found = { uri?: string; data?: string; mime?: string };

/** The video in an interaction, read the REST way: steps[] of type model_output → content[] of type video. */
export function videoFromInteraction(json: unknown): Found | null {
  const steps = (json as { steps?: unknown })?.steps;
  if (!Array.isArray(steps)) return null;
  for (const step of steps) {
    const content = (step as { type?: unknown; content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      const item = c as { type?: unknown; uri?: unknown; data?: unknown; mime_type?: unknown };
      if (item?.type !== "video") continue;
      const uri = typeof item.uri === "string" && item.uri ? item.uri : undefined;
      const data = typeof item.data === "string" && item.data ? item.data : undefined;
      if (uri || data) return { uri, data, mime: typeof item.mime_type === "string" ? item.mime_type : undefined };
    }
  }
  return null;
}

/** A Files link without any `key=` in it — a key must never land in a stored URL or a log line. */
export function bareFileUrl(uri: string): string {
  try {
    const u = new URL(uri);
    u.searchParams.delete("key");
    return u.toString();
  } catch {
    return uri.replace(/([?&])key=[^&]*&?/g, "$1").replace(/[?&]$/, "");
  }
}

type Reply = { status: number; text: string; json: unknown };

/** One JSON call to the Gemini API, the key in a header, held open up to `timeoutMs`. */
function callGemini(method: "GET" | "POST", path: string, apiKey: string, body: unknown, timeoutMs: number): Promise<Reply> {
  const url = new URL(`${geminiBase()}${path}`);
  const lib = url.protocol === "http:" ? http : https;
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method,
        headers: {
          "x-goog-api-key": apiKey,
          accept: "application/json",
          ...(payload ? { "content-type": "application/json", "content-length": String(payload.length) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json: unknown = null;
          try { json = JSON.parse(text); } catch { /* not JSON — kept as text */ }
          resolve({ status: res.statusCode ?? 0, text, json });
        });
        res.on("error", reject);
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Google video call timed out after ${Math.round(timeoutMs / 60_000)} minutes`)));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Google's own words for a refusal, never the key. */
function refusal(r: Reply, model: string): Error {
  const msg = (r.json as { error?: { message?: unknown; status?: unknown } } | null)?.error;
  const said = typeof msg?.message === "string" ? msg.message : r.text.slice(0, 300);
  const hint = r.status === 404 ? " — Google doesn't serve this model id to this key (set VIDEO_MODEL to one it does)" : r.status === 403 || r.status === 401 ? " — check the Google key under Settings → Keys" : r.status === 429 ? " — Google's quota for this key is used up for now" : "";
  return new Error(`Google video (${model}) refused, HTTP ${r.status}: ${said}${hint}`.slice(0, 500));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const WORKING = new Set(["in_progress", "queued", "pending", "running", "processing", "created"]);

export type OmniResult = { url: string; bytes?: Buffer; mime?: string; seconds: number };

/** Render one clip. Throws with Google's reason when it can't — a render never quietly becomes a placeholder. */
export async function renderWithOmni(req: OmniInput & { workspaceId?: string }): Promise<OmniResult> {
  const apiKey = await getApiKey("google", req.workspaceId);
  if (!apiKey) throw new Error("No Google API key configured (Settings → Keys → Google)");
  const body = omniRequestBody(req);
  const seconds = omniSeconds(req.seconds, Boolean(req.firstFrame || req.lastFrame));

  const first = await callGemini("POST", "/v1beta/interactions", apiKey, body, CALL_TIMEOUT_MS);
  if (first.status < 200 || first.status >= 300) throw refusal(first, OMNI_MODEL);
  let interaction = first.json as { id?: unknown; status?: unknown } | null;
  let found = videoFromInteraction(interaction);
  const deadline = Date.now() + POLL_FOR_MS;
  while (!found && typeof interaction?.id === "string" && WORKING.has(String(interaction.status ?? "")) && Date.now() < deadline) {
    await sleep(POLL_MS);
    const again = await callGemini("GET", `/v1beta/interactions/${encodeURIComponent(interaction.id)}`, apiKey, undefined, 60_000);
    if (again.status < 200 || again.status >= 300) throw refusal(again, OMNI_MODEL);
    interaction = again.json as typeof interaction;
    found = videoFromInteraction(interaction);
  }
  if (!found) {
    const status = typeof interaction?.status === "string" ? interaction.status : "no status";
    throw new Error(`Google returned no video (${status}) — the prompt or an image may have been blocked by Google's safety filters.`);
  }
  if (found.data) return { url: "", bytes: Buffer.from(found.data, "base64"), mime: found.mime ?? "video/mp4", seconds };

  // A Files link: wait until Google says the file is ready, then hand back the bare link to download.
  const uri = bareFileUrl(found.uri!);
  const id = uri.match(/\/files\/([^/:?]+)/)?.[1];
  if (id) {
    const until = Date.now() + FILE_READY_FOR_MS;
    while (Date.now() < until) {
      const f = await callGemini("GET", `/v1beta/files/${encodeURIComponent(id)}`, apiKey, undefined, 30_000).catch(() => null);
      const state = (f?.json as { state?: unknown } | null)?.state;
      if (!f || f.status !== 200 || state === "ACTIVE" || state === undefined) break;
      if (state === "FAILED") throw new Error("Google made the video but its file failed to process — render the scene again.");
      await sleep(3_000);
    }
  }
  return { url: uri, seconds };
}
