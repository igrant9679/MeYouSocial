import { readJson } from "@/lib/db/json";

/**
 * Which Topic a piece of text is about, by keyword overlap — computed where it
 * is needed, never stored as if it were a fact.
 *
 * Research's overview groups outliers under the Topic they match, and a video
 * idea born from a competitor seed gets its Topic from the same rule. Both are
 * labelled "matched by keyword" wherever a person sees them, because this is
 * a heuristic: a Topic's name and related phrases against a title (and tags,
 * when there are any). A stored match would be a number this app invented.
 */

export type MatchableTopic = { id: string; name: string; keywords: string | string[] };

const WORD = /[a-z0-9]+/g;
const NOISE = new Set([
  "the", "and", "for", "with", "your", "you", "how", "what", "why", "when", "guide", "best", "top",
  "ways", "tips", "should", "does", "from", "that", "this", "into", "about", "are", "not", "can",
]);

function tokens(s: string): Set<string> {
  return new Set((s.toLowerCase().match(WORD) ?? []).filter((w) => w.length > 2 && !NOISE.has(w)));
}

type Prepared = { id: string; name: string; phrases: string[]; words: Set<string> };

export function prepareTopics(topics: MatchableTopic[]): Prepared[] {
  return topics.map((t) => {
    const phrases = (Array.isArray(t.keywords) ? t.keywords : readJson<string[]>(t.keywords, [])).map((p) => p.toLowerCase().trim()).filter(Boolean);
    const words = new Set<string>();
    for (const w of tokens(t.name)) words.add(w);
    for (const p of phrases) for (const w of tokens(p)) words.add(w);
    return { id: t.id, name: t.name, phrases, words };
  });
}

/**
 * The best-matching Topic for a text, or null when nothing overlaps. A whole
 * phrase appearing verbatim outranks scattered word overlap; either needs at
 * least one meaningful word in common.
 */
export function matchTopic(text: string, prepared: Prepared[]): { id: string; name: string; score: number } | null {
  const lower = text.toLowerCase();
  const words = tokens(text);
  let best: { id: string; name: string; score: number } | null = null;
  for (const t of prepared) {
    let score = 0;
    for (const p of t.phrases) if (p.length > 2 && lower.includes(p)) score += 3;
    if (lower.includes(t.name.toLowerCase())) score += 3;
    for (const w of t.words) if (words.has(w)) score += 1;
    if (score > 0 && (!best || score > best.score)) best = { id: t.id, name: t.name, score };
  }
  return best;
}
