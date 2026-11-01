import { countWords } from "@/lib/canvas/duration";

/**
 * What the teleprompter shows (E-VID-02): the script with its markdown taken
 * out, so a presenter reads "Welcome back" and not "**Welcome back**". Section
 * headings ("## Hook") and whole-line stage cues ("[B-ROLL: city at night]",
 * "(pause)") stay visible but set apart, and only the spoken lines count
 * towards the words — the speed is in words per minute, so a cue counted as
 * speech would make the prompter run ahead of the voice.
 */

export type PrompterBlock = { kind: "spoken" | "heading" | "cue"; text: string };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** Inline markdown out: emphasis, code, links (text kept), images (dropped). */
export function stripInline(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function prompterBlocks(body: string | null | undefined): PrompterBlock[] {
  if (!body) return [];
  // A body that came through as HTML: line breaks kept, tags and comments out.
  const text = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e: string) => ENTITIES[e] ?? "")
    .replace(/\r\n?/g, "\n");
  const blocks: PrompterBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    const t = stripInline(para.join(" "));
    if (t) blocks.push({ kind: "spoken", text: t });
    para = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || /^([-*_])(\s*\1){2,}$/.test(line)) { flush(); continue; }
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) { flush(); const t = stripInline(heading[1]); if (t) blocks.push({ kind: "heading", text: t }); continue; }
    const unwrapped = stripInline(line.replace(/^>\s?/, "").replace(/^([-*+]|\d+[.)])\s+/, ""));
    // A whole line in brackets or parentheses is direction, not speech.
    if (/^\[[^\]]*\]$/.test(unwrapped) || /^\([^)]*\)$/.test(unwrapped)) { flush(); blocks.push({ kind: "cue", text: unwrapped }); continue; }
    // List items and quotes each stand on their own line.
    if (/^([-*+]|\d+[.)])\s+|^>/.test(line)) { flush(); para.push(unwrapped); flush(); continue; }
    para.push(unwrapped);
  }
  flush();
  return blocks;
}

/** Spoken words only — headings and cues aren't read aloud. */
export function spokenWords(blocks: PrompterBlock[]): number {
  return blocks.filter((b) => b.kind === "spoken").reduce((n, b) => n + countWords(b.text), 0);
}

export const WPM_MIN = 60;
export const WPM_MAX = 300;
export const WPM_STEP = 10;

/** "4:05" — minutes and seconds left at this pace. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
