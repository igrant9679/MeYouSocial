import { getApiKey } from "@/lib/llm/keys";

/**
 * Look at an image and describe it — for Thumbnail Studio's Clone / Remix.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `cloneThumbnailAction` used to "analyse" a reference by passing the URL to
 * `llm.complete()` as a plain string. A text model cannot fetch a URL, so what
 * came back was recall or invention, never observation. It looked convincing
 * because the obvious test reference is a famous video the model already knows;
 * for the actual use case — a competitor's thumbnail nobody has memorised — it
 * confidently described a palette and composition that were never there.
 *
 * Verified 2026-07-28 with a real YouTube thumbnail (a slate-blue panel with
 * large white uppercase type): the old text-only path claimed "Typography: none
 * inherent to the original video frames", which is the exact opposite of the
 * truth. Vision reports the panel, the type and the crop correctly.
 *
 * ── Model choice ────────────────────────────────────────────────────────────
 * Probed against the live keys. `gemini-flash-latest` works and is the alias
 * MODEL_MAP already trusts; **`gemini-3.1-flash` 404s for generateContent**,
 * so don't "modernise" the id without probing. OpenAI `gpt-4o-mini` also works
 * and is the fallback. Google leads because it's already this install's text
 * provider.
 */

const GOOGLE_VISION_MODEL = process.env.GOOGLE_VISION_MODEL ?? "gemini-flash-latest";
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL ?? "gpt-4o-mini";
const FETCH_TIMEOUT_MS = 20_000;
const MAX_BYTES = 8 * 1024 * 1024;

export type ReferenceImage = { bytes: Buffer; mimeType: string; source: string };

/** `watch?v=`, `youtu.be/`, `/shorts/`, `/embed/` → the 11-char video id. */
function youtubeId(raw: string): string | null {
  const m =
    raw.match(/[?&]v=([A-Za-z0-9_-]{11})/) ??
    raw.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) ??
    raw.match(/\/shorts\/([A-Za-z0-9_-]{11})/) ??
    raw.match(/\/embed\/([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function tryFetchImage(url: string): Promise<ReferenceImage | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).catch(() => null);
  if (!res?.ok) return null;
  const mimeType = res.headers.get("content-type")?.split(";")[0] ?? "";
  if (!mimeType.startsWith("image/")) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  // A 120-byte "no thumbnail" placeholder is technically an image; treat tiny
  // responses as a miss so the maxres→hq fallback below still fires.
  if (buf.length < 1024 || buf.length > MAX_BYTES) return null;
  return { bytes: buf, mimeType, source: url };
}

/**
 * Resolve whatever the user pasted into actual image bytes.
 *
 * Returns null when the reference genuinely can't be fetched — an `@handle`, a
 * page we can't read, a dead link. Callers MUST treat null as "I never saw it"
 * and say so, rather than falling back to a description of nothing.
 */
export async function fetchReferenceImage(reference: string): Promise<ReferenceImage | null> {
  const raw = reference.trim();
  if (!raw) return null;

  const id = youtubeId(raw);
  if (id) {
    // maxres doesn't exist for every video; hq always does.
    return (
      (await tryFetchImage(`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`)) ??
      (await tryFetchImage(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`))
    );
  }
  if (/^https?:\/\//i.test(raw)) return tryFetchImage(raw);
  // Bare @handle or free text — nothing to look at.
  return null;
}

const STYLE_PROMPT =
  "Describe ONLY what is actually visible in this thumbnail: colour palette, typography (the words shown, weight, case, placement), composition and crop, lighting, and any subject or props. Be concrete and concise. Do not guess at anything you cannot see.";

/**
 * Describe an image's visual style. Throws if no vision-capable key resolves —
 * the caller decides what to tell the user, and must not pretend it looked.
 */
export async function describeImageStyle(img: ReferenceImage, workspaceId?: string): Promise<string> {
  return askAboutImage(img, STYLE_PROMPT, workspaceId);
}

/**
 * Ask a vision model a question about an image. Same provider order and the
 * same contract as describeImageStyle: throws when no vision-capable key
 * resolves, so a caller can never mistake "nobody looked" for an answer.
 */
export async function askAboutImage(img: ReferenceImage, prompt: string, workspaceId?: string): Promise<string> {
  const googleKey = await getApiKey("google", workspaceId).catch(() => "");
  if (googleKey) {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: googleKey });
    const out = await ai.models.generateContent({
      model: GOOGLE_VISION_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: img.mimeType, data: img.bytes.toString("base64") } },
            { text: prompt },
          ],
        },
      ],
    });
    const text = (out.text ?? "").trim();
    if (text) return text;
  }

  const openaiKey = await getApiKey("openai", workspaceId).catch(() => "");
  if (openaiKey) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${openaiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_VISION_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: { url: `data:${img.mimeType};base64,${img.bytes.toString("base64")}` },
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) {
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = (body.choices?.[0]?.message?.content ?? "").trim();
      if (text) return text;
    }
  }

  throw new Error("No vision-capable key is configured for this workspace (Admin → API keys → Google or OpenAI).");
}
