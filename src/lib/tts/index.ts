import { storage } from "@/lib/storage";
import { getApiKey } from "@/lib/llm/keys";

/**
 * Text-to-speech seam (voiceovers for video packages). House pattern: provider
 * interface, honest mock default, real provider activates from in-app settings
 * (Setting `tts:provider` + `api_key:elevenlabs`, both set under Admin → API
 * keys) — no env access needed.
 *
 * The mock does NOT fake audio: it stores the narration script as a .txt and
 * says so, so nothing downstream can mistake it for a real voiceover.
 */

export type TtsResult = {
  url: string;
  provider: string;
  isAudio: boolean;
};

export interface TtsProvider {
  name: string;
  speak(text: string): Promise<TtsResult>;
}

const mockTts: TtsProvider = {
  name: "mock",
  async speak(text: string) {
    const file = await storage.put(
      "voiceover-script.txt",
      Buffer.from(`[MOCK TTS — no audio generated]\nConfigure ElevenLabs under Admin → API keys to produce real audio.\n\n${text}`, "utf8"),
      "text/plain",
    );
    return { url: file.url, provider: "mock", isAudio: false };
  },
};

const ELEVEN_VOICE = "21m00Tcm4TlvDq8ikWAM"; // "Rachel" — ElevenLabs' default public voice

const elevenLabsTts = (workspaceId?: string): TtsProvider => ({
  name: "elevenlabs",
  async speak(text) {
    const apiKey = await getApiKey("elevenlabs", workspaceId);
    if (!apiKey) throw new Error("No ElevenLabs key configured (Admin → API keys)");
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE}`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 5000), model_id: "eleven_multilingual_v2" }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`ElevenLabs HTTP ${res.status}: ${detail.slice(0, 150)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const file = await storage.put("voiceover.mp3", buf, "audio/mpeg");
    return { url: file.url, provider: "elevenlabs", isAudio: true };
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
  return mockTts;
}
