/**
 * Deterministic SRT generation from a storyboard. Timing comes straight from
 * each scene's duration; the caption is the scene's on-screen text (falling
 * back to a trimmed prompt). No model involved — captions must match what the
 * video actually shows.
 */

import { env } from "@/lib/env";

/**
 * The lengths a scene can be (audit VID-11: no length was sent once, so every
 * clip came back at the provider's default while the SRT and the cost used the
 * board's numbers). Veo rendered 4, 6 or 8 seconds; since 2026-11-24 Gemini Omni
 * Flash renders any 3–15, offered as these steps. Scenes are snapped on read to
 * the nearest valid length within VIDEO_MAX_SECONDS (a tie rounds up), so the
 * board, the request, the captions and the estimate agree. A scene that starts
 * or ends on an image is at most `FRAMED_MAX_SECONDS` (Google's limit).
 */
export const SCENE_SECONDS = [4, 6, 8, 10, 12, 15] as const;
export const FRAMED_MAX_SECONDS = 10;
export function snapSceneSeconds(n: number, opts: { framed?: boolean } = {}): number {
  const cap = Math.min(Math.max(4, env.VIDEO_MAX_SECONDS), opts.framed ? FRAMED_MAX_SECONDS : Infinity);
  const allowed = SCENE_SECONDS.filter((s) => s <= cap);
  return allowed.reduce((best, s) => (Math.abs(s - n) <= Math.abs(best - n) ? s : best), allowed[0]);
}

/** A stored file key a scene may point at (local nanoid+ext or a Drive key) — anything else is dropped on read. */
const FRAME_KEY = /^(gdrive:[A-Za-z0-9_-]{10,200}|[A-Za-z0-9_-]{8,80}(\.[A-Za-z0-9]{1,8})?)$/;
export const isFrameKey = (v: unknown): v is string => typeof v === "string" && FRAME_KEY.test(v);

export type StoryScene = {
  prompt: string;
  seconds: number;
  text?: string | null;
  outputUrl?: string | null;
  status?: string;
  /** The scene starts on this stored picture (2026-11-24) — and ends on `lastFrameKey` when there is one. */
  firstFrameKey?: string | null;
  lastFrameKey?: string | null;
  /** The Google interaction that made the clip — what "Extend" continues (2026-11-24). Null for older clips. */
  ref?: string | null;
  /** The clip was continued: its seconds are what it really runs (up to EXTENDED_MAX_SECONDS), not a scene step. */
  extended?: boolean;
  /** Why the last Extend didn't happen, in words; cleared by the next one. */
  extendError?: string | null;
};

/** The longest a scene can be by extending it (Google: up to 30 seconds in all). */
export const EXTENDED_MAX_SECONDS = 30;

export function parseScenes(json: string | null | undefined): StoryScene[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json);
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s) => ({
        prompt: typeof s.prompt === "string" ? s.prompt : "",
        // An extended clip runs what it runs (to 30 s); every other scene is snapped to a length a render can make.
        seconds: s.extended === true && Number.isFinite(Number(s.seconds)) && Number(s.seconds) > 0
          ? Math.min(EXTENDED_MAX_SECONDS, Math.max(1, Math.round(Number(s.seconds))))
          : snapSceneSeconds(Number.isFinite(Number(s.seconds)) && Number(s.seconds) > 0 ? Number(s.seconds) : 6, { framed: isFrameKey(s.firstFrameKey) || isFrameKey(s.lastFrameKey) }),
        text: typeof s.text === "string" ? s.text : null,
        outputUrl: typeof s.outputUrl === "string" ? s.outputUrl : null,
        status: typeof s.status === "string" ? s.status : "planned",
        // A last frame means nothing without a first: Google takes two images as start then end.
        firstFrameKey: isFrameKey(s.firstFrameKey) ? s.firstFrameKey : null,
        lastFrameKey: isFrameKey(s.firstFrameKey) && isFrameKey(s.lastFrameKey) ? s.lastFrameKey : null,
        ref: typeof s.ref === "string" && s.ref.length > 0 && s.ref.length <= 200 ? s.ref : null,
        extended: s.extended === true,
        extendError: typeof s.extendError === "string" && s.extendError ? s.extendError.slice(0, 400) : null,
      }))
      .filter((s) => s.prompt.length > 0);
  } catch {
    return [];
  }
}

function ts(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const ms = Math.round((totalSeconds - Math.floor(totalSeconds)) * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}

export function scenesToSrt(scenes: StoryScene[]): string {
  let t = 0;
  const blocks: string[] = [];
  scenes.forEach((scene, i) => {
    const start = t;
    const end = t + scene.seconds;
    t = end;
    const caption = (scene.text?.trim() || scene.prompt.trim()).slice(0, 90);
    blocks.push(`${i + 1}\n${ts(start)} --> ${ts(end - 0.2)}\n${caption}\n`);
  });
  return blocks.join("\n");
}

/** The narration script a TTS provider reads: scene texts in order. */
export function scenesToNarration(title: string, scenes: StoryScene[]): string {
  const lines = scenes.map((s) => s.text?.trim() || "").filter(Boolean);
  return [title, ...lines].join(". ").replace(/\.\./g, ".");
}

// ── E-VID-08: WebVTT, word-timed captions, narration from the script ─────────

/** The same captions as WebVTT (YouTube, the web <track> element). Pure. */
export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n{2,}/)
    .map((block) => block.replace(/^\d+\n/, "").replace(/(\d\d:\d\d:\d\d),(\d{3})/g, "$1.$2"))
    .join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}

/** ElevenLabs' character timing for a narration (`/with-timestamps`). */
export type CharAlignment = { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };
export type TimedWord = { word: string; start: number; end: number };

/** Characters → words with their spoken start and end. Pure. */
export function wordsFromAlignment(a: CharAlignment): TimedWord[] {
  const words: TimedWord[] = [];
  let cur: TimedWord | null = null;
  const n = Math.min(a.characters.length, a.character_start_times_seconds.length, a.character_end_times_seconds.length);
  for (let i = 0; i < n; i++) {
    const ch = a.characters[i];
    if (/\s/.test(ch)) {
      if (cur) words.push(cur);
      cur = null;
      continue;
    }
    if (!cur) cur = { word: "", start: a.character_start_times_seconds[i], end: a.character_end_times_seconds[i] };
    cur.word += ch;
    cur.end = a.character_end_times_seconds[i];
  }
  if (cur) words.push(cur);
  return words;
}

/**
 * Word-timed captions: the narration as it is SPOKEN, a few words at a time,
 * each caption on screen exactly while its words are said. A caption ends at
 * the last word's end (never overlapping the next), breaks after sentence
 * punctuation, and holds at most `maxWords` words / `maxChars` characters.
 * Pure.
 */
export function wordsToSrt(words: TimedWord[], opts: { maxWords?: number; maxChars?: number } = {}): string {
  const maxWords = opts.maxWords ?? 4;
  const maxChars = opts.maxChars ?? 32;
  const groups: TimedWord[][] = [];
  let g: TimedWord[] = [];
  const len = (ws: TimedWord[]) => ws.map((w) => w.word).join(" ").length;
  for (const w of words) {
    if (g.length && (g.length >= maxWords || len([...g, w]) > maxChars)) {
      groups.push(g);
      g = [];
    }
    g.push(w);
    if (/[.!?…]["')\]]?$/.test(w.word)) {
      groups.push(g);
      g = [];
    }
  }
  if (g.length) groups.push(g);
  return groups
    .map((grp, i) => `${i + 1}\n${ts(grp[0].start)} --> ${ts(Math.max(grp[0].start + 0.3, grp[grp.length - 1].end))}\n${grp.map((w) => w.word).join(" ")}\n`)
    .join("\n");
}

/**
 * What a narrator reads from a script's body: the spoken words only. Headings,
 * bracketed directions ([B-roll: …], (pause)), retention markers and markup are
 * dropped; paragraphs become sentences. Pure.
 */
export function scriptToNarration(body: string): string {
  return body
    // Headings first: once their closing tags become line breaks they can't be found.
    .replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^#{1,6}\s/.test(l) && !/^(\[[^\]]*\]|\([^)]*\))$/.test(l) && !/^[-=*_]{3,}$/.test(l))
    .map((l) => l.replace(/\[[^\]]*\]/g, "").replace(/\((?:pause|beat|b-?roll[^)]*|cut[^)]*|music[^)]*|sfx[^)]*)\)/gi, "").replace(/^[-*•]\s+/, "").replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((l) => (/[.!?…:]$/.test(l) ? l : `${l}.`))
    .join(" ");
}
