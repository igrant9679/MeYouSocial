import { storage } from "@/lib/storage";
import { getApiKey } from "@/lib/llm/keys";
import { wordsFromAlignment, type CharAlignment, type TimedWord } from "@/lib/captions";

/**
 * Text-to-speech seam (voiceovers for video packages). House pattern: provider
 * interface, honest mock default, real provider activates from in-app settings
 * (Setting `tts:provider` + `api_key:elevenlabs`, both set under Settings → API
 * keys) — no env access needed.
 *
 * The mock does NOT fake audio: it stores the narration script as a .txt and
 * says so, so nothing downstream can mistake it for a real voiceover.
 */

export type TtsResult = {
  url: string;
  provider: string;
  isAudio: boolean;
  /** The voice that spoke (a real provider only). */
  voice?: string | null;
  /** Each spoken word's start and end, when the provider times them (E-VID-08). */
  words?: TimedWord[] | null;
};

export interface TtsProvider {
  name: string;
  /** `voiceId` — a channel's own voice (E-VID-08); the provider's default when absent or malformed. */
  speak(text: string, opts?: { voiceId?: string | null }): Promise<TtsResult>;
}

const mockTts = (workspaceId?: string): TtsProvider => ({
  name: "mock",
  async speak(text: string) {
    const file = await storage.put(
      "voiceover-script.txt",
      Buffer.from(`[MOCK TTS — no audio generated]\nConfigure ElevenLabs under Settings → Keys to produce real audio.\n\n${text}`, "utf8"),
      "text/plain",
      workspaceId ?? null,
    );
    return { url: file.url, provider: "mock", isAudio: false };
  },
});

const ELEVEN_VOICE = "21m00Tcm4TlvDq8ikWAM"; // "Rachel" — ElevenLabs' default public voice

/** An ElevenLabs voice id: letters and digits (20 today). Checked so a pasted name or URL fails with a reason. */
export function looksLikeVoiceId(v: string): boolean {
  return /^[A-Za-z0-9]{12,40}$/.test(v.trim());
}

/**
 * ElevenLabs, asked for the audio WITH its character timing (`/with-timestamps`),
 * so captions can follow the narration word by word (E-VID-08). The voice is
 * the caller's (a channel's own voice) or the default. A base URL override
 * exists only so a stand-in can answer in tests; production uses the real host.
 */
const elevenLabsTts = (workspaceId?: string): TtsProvider => ({
  name: "elevenlabs",
  async speak(text, opts) {
    const apiKey = await getApiKey("elevenlabs", workspaceId);
    if (!apiKey) throw new Error("No ElevenLabs key configured (Settings → Keys)");
    const voice = opts?.voiceId && looksLikeVoiceId(opts.voiceId) ? opts.voiceId.trim() : ELEVEN_VOICE;
    const base = (process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io").replace(/\/+$/, "");
    const res = await fetch(`${base}/v1/text-to-speech/${voice}/with-timestamps`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 5000), model_id: "eleven_multilingual_v2" }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`ElevenLabs HTTP ${res.status}: ${detail.slice(0, 150)}`);
    }
    const body = (await res.json()) as { audio_base64?: string; alignment?: CharAlignment | null };
    if (!body.audio_base64) throw new Error("ElevenLabs answered without audio.");
    const buf = Buffer.from(body.audio_base64, "base64");
    const file = await storage.put("voiceover.mp3", buf, "audio/mpeg", workspaceId ?? null);
    const words = body.alignment ? wordsFromAlignment(body.alignment) : [];
    return { url: file.url, provider: "elevenlabs", isAudio: true, voice, words: words.length ? words : null };
  },
});

export async function getTtsProvider(workspaceId?: string): Promise<TtsProvider> {
  try {
    // Multi-tenant: the workspace's own switch + key win over the platform's.
    const { getSetting } = await import("@/lib/settings");
    const setting = await getSetting("tts:provider", workspaceId);
    if (setting === "elevenlabs") {
      const key = await getApiKey("elevenlabs", workspaceId);
      if (key) return elevenLabsTts(workspaceId);
    }
  } catch {
    // fall through to mock
  }
  return mockTts(workspaceId);
}
