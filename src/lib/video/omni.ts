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


/** A clip Google made: a link or the bytes, how long it was asked to be, and the interaction that made it. */
export type OmniResult = { url: string; bytes?: Buffer; mime?: string; seconds: number; interactionId?: string };

/**
 * Send one interaction and wait for its video (shared by render and extend). Throws with Google's reason when it
 * can't — a clip never quietly becomes a placeholder.
 */
async function runInteraction(apiKey: string, body: Record<string, unknown>, seconds: number): Promise<OmniResult> {
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
  // The interaction's id is what a later "continue this clip" points at (`previous_interaction_id`).
  const interactionId = typeof interaction?.id === "string" ? interaction.id : undefined;
  if (found.data) return { url: "", bytes: Buffer.from(found.data, "base64"), mime: found.mime ?? "video/mp4", seconds, interactionId };

  // A Files link: wait until Google says the file is ready, then hand back the bare link to download.
  const uri = bareFileUrl(found.uri!);
  const id = uri.match(/\/files\/([^/:?]+)/)?.[1];
  if (id) {
    const until = Date.now() + FILE_READY_FOR_MS;
    while (Date.now() < until) {
      const f = await callGemini("GET", `/v1beta/files/${encodeURIComponent(id)}`, apiKey, undefined, 30_000).catch(() => null);
      const state = (f?.json as { state?: unknown } | null)?.state;
      if (!f || f.status !== 200 || state === "ACTIVE" || state === undefined) break;
      if (state === "FAILED") throw new Error("Google made the video but its file failed to process — try again.");
      await sleep(3_000);
    }
  }
  return { url: uri, seconds, interactionId };
}

async function keyFor(workspaceId?: string): Promise<string> {
  const apiKey = await getApiKey("google", workspaceId);
  if (!apiKey) throw new Error("No Google API key configured (Settings → Keys → Google)");
  return apiKey;
}

/** Render one clip. */
export async function renderWithOmni(req: OmniInput & { workspaceId?: string }): Promise<OmniResult> {
  const apiKey = await keyFor(req.workspaceId);
  return runInteraction(apiKey, omniRequestBody(req), omniSeconds(req.seconds, Boolean(req.firstFrame || req.lastFrame)));
}

/** How much one extension adds: 3–10 seconds (Google's per-turn limit). */
export const extendSeconds = (n: number): number => Math.min(10, Math.max(3, Math.round(Number.isFinite(n) ? n : 6)));

/**
 * "Continue this clip" (2026-11-24): a turn in the conversation that made it — `previous_interaction_id` — asking for
 * `seconds` more at the end, optionally steered by a line of direction. Pure, for the checks.
 */
export function omniExtendBody(req: { previousId: string; seconds: number; aspect: "9:16" | "16:9" | "1:1"; direction?: string | null }, model = OMNI_MODEL): Record<string, unknown> {
  if (req.aspect !== "9:16" && req.aspect !== "16:9") throw new Error(`Gemini Omni Flash extends 9:16 or 16:9 video, not ${req.aspect}.`);
  const n = extendSeconds(req.seconds);
  const direction = (req.direction ?? "").trim().slice(0, 300);
  return {
    model,
    previous_interaction_id: req.previousId,
    input: `Extend this video by ${n} seconds, continuing the same scene smoothly from its last frame.${direction ? ` ${direction}` : ""}`,
    response_format: { type: "video", aspect_ratio: req.aspect, resolution: "720p", duration: `${n}s`, delivery: "uri" },
    generation_config: { video_config: { task: "extend" } },
  };
}

/** Continue a clip Google made. A conversation Google no longer holds comes back as a refusal, said in words. */
export async function extendWithOmni(req: { workspaceId?: string; previousId: string; seconds: number; aspect: "9:16" | "16:9" | "1:1"; direction?: string | null }): Promise<OmniResult> {
  const apiKey = await keyFor(req.workspaceId);
  try {
    return await runInteraction(apiKey, omniExtendBody(req), extendSeconds(req.seconds));
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/HTTP (404|400)/.test(m) && /interaction/i.test(m)) {
      throw new Error(`Google no longer holds the history of this clip, so it can't be continued — render the scene again, then extend it. (${m.slice(0, 200)})`);
    }
    throw e;
  }
}

/** The bytes of a Files link Google gave, fetched with the key in a header (never in the URL). */
export async function downloadGeminiFile(uri: string, workspaceId?: string): Promise<Buffer> {
  const apiKey = await keyFor(workspaceId);
  let target = bareFileUrl(uri);
  if (/\/files\/[^/:?]+$/.test(target)) target += ":download";
  if (!/[?&]alt=media\b/.test(target)) target += (target.includes("?") ? "&" : "?") + "alt=media";
  const res = await fetch(target, { headers: { "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(120_000), redirect: "follow" });
  if (!res.ok) throw new Error(`Couldn't download the clip from Google (HTTP ${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}
