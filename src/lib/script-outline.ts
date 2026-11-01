import { countWords, WORDS_PER_MINUTE } from "@/lib/canvas/duration";

/**
 * The script editor's outline (E-VID-10): sections with their spoken length,
 * retention markers every N seconds, and find / replace. Time is spoken time
 * at WORDS_PER_MINUTE, counting the same words the teleprompter counts —
 * headings ("## Hook") and whole-line stage cues ("[B-ROLL …]", "(pause)")
 * aren't read aloud, so they take no time.
 */

export type OutlineSection = {
  title: string;
  /** Character offset of the heading (or 0 for the opening before any heading). */
  offset: number;
  words: number;
  /** Spoken seconds in this section, and where it starts in the read. */
  seconds: number;
  startsAt: number;
};

export type RetentionMarker = { at: number; offset: number; snippet: string };

const HEADING = /^#{1,6}\s+(.*)$/;
const CUE = /^\s*(\[[^\]]*\]|\([^)]*\))\s*$/;

/** Each line with its offset and whether it's spoken. */
function lines(body: string) {
  const out: Array<{ text: string; offset: number; heading: string | null; spoken: boolean }> = [];
  let offset = 0;
  for (const text of body.split("\n")) {
    const h = text.trim().match(HEADING);
    out.push({ text, offset, heading: h ? h[1].replace(/[*_`]/g, "").trim() : null, spoken: !h && !CUE.test(text) && text.trim() !== "" });
    offset += text.length + 1;
  }
  return out;
}

const secondsFor = (words: number, wpm: number) => (words / wpm) * 60;

export function scriptSections(body: string, wpm = WORDS_PER_MINUTE): OutlineSection[] {
  const out: OutlineSection[] = [];
  let cur: OutlineSection = { title: "Opening", offset: 0, words: 0, seconds: 0, startsAt: 0 };
  // The text before the first heading is a section only when something is said in it.
  let opening = true;
  let elapsed = 0;
  for (const l of lines(body)) {
    if (l.heading != null) {
      if (!opening || cur.words > 0) out.push(cur);
      cur = { title: l.heading || "Untitled section", offset: l.offset, words: 0, seconds: 0, startsAt: elapsed };
      opening = false;
      continue;
    }
    if (!l.spoken) continue;
    const w = countWords(l.text);
    cur.words += w;
    cur.seconds += secondsFor(w, wpm);
    elapsed += secondsFor(w, wpm);
  }
  if (!opening || cur.words > 0 || out.length === 0) out.push(cur);
  return out;
}

/**
 * A marker each time the read passes another `every` seconds — the moments to
 * re-hook a viewer. It points at the word where that second falls, and quotes
 * the words from there.
 */
export function retentionMarkers(body: string, every = 45, wpm = WORDS_PER_MINUTE): RetentionMarker[] {
  const out: RetentionMarker[] = [];
  const perWord = 60 / wpm;
  let elapsed = 0;
  let next = every;
  for (const l of lines(body)) {
    if (!l.spoken) continue;
    for (const m of l.text.matchAll(/[\p{L}\p{N}]+/gu)) {
      elapsed += perWord;
      if (elapsed >= next) {
        const offset = l.offset + (m.index ?? 0);
        const rest = body.slice(offset, offset + 80).split("\n")[0];
        out.push({ at: next, offset, snippet: rest.length >= 60 ? `${rest.slice(0, 60).replace(/\s+\S*$/, "")}…` : rest });
        next += every;
      }
    }
  }
  return out;
}

/** Where `needle` occurs, as offsets. Empty needle → none. */
export function findAll(body: string, needle: string, matchCase = false): number[] {
  if (!needle) return [];
  const hay = matchCase ? body : body.toLowerCase();
  const n = matchCase ? needle : needle.toLowerCase();
  const out: number[] = [];
  for (let i = hay.indexOf(n); i !== -1 && out.length < 5000; i = hay.indexOf(n, i + n.length)) out.push(i);
  return out;
}

/** Every occurrence replaced, literally (no patterns), and how many. */
export function replaceAll(body: string, needle: string, replacement: string, matchCase = false): { body: string; count: number } {
  const at = findAll(body, needle, matchCase);
  if (!at.length) return { body, count: 0 };
  let out = "";
  let last = 0;
  for (const i of at) { out += body.slice(last, i) + replacement; last = i + needle.length; }
  return { body: out + body.slice(last), count: at.length };
}

/** "1:05". */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
