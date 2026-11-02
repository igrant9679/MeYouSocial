import { db } from "@/lib/db";
import { OUTLIER_MIN_VIEWS } from "@/lib/intel";
import { matchTopic, prepareTopics } from "@/lib/topic-match";

/**
 * Topics suggested from Research (E-IDE-22): competitor outliers whose titles
 * match no Topic, grouped by the words they share — beside the keyword-cluster
 * suggestions on Ideas → Topics. No model call: a theme is a word or a pair of
 * words that several strong outliers, from more than one channel, have in
 * common. Computed when the page is read, never stored; a person adds or
 * discards each one.
 */

export type OutlierTitle = { id: string; title: string; score: number; channelId: string; channelName: string };

export type ResearchTopicSuggestion = {
  /** Sentence case, the way Topics are named: "Grant writing". */
  name: string;
  /** The shared word or pair (stemmed, lowercase) — what the group was made on. */
  term: string;
  /** Phrases for the new Topic: the term as written, then words most of its titles share. */
  phrases: string[];
  videos: number;
  channels: number;
  /** Median outlier ratio of the group's videos. */
  medianScore: number;
  examples: Array<{ id: string; title: string; score: number; channelName: string }>;
};

/** At least this many outliers, from at least this many channels, make a theme. */
export const MIN_VIDEOS = 3;
export const MIN_CHANNELS = 2;
export const MAX_SUGGESTIONS = 6;

// Words that say nothing about a subject: function words, YouTube title filler.
const STOP = new Set(`a an and or but the of to in on at for with by from as is are was were be been it its this that these those
you your yours i me my we our us they them their he she his her what why how when where who which will would can could should
do does did done not no yes vs versus than then so if just more most very really much many all any every each some new best top
first last one two three four five ten get got make made making use using used way ways thing things guide tips tip tricks trick
video videos watch full part episode ep official free easy simple quick fast need know about into over out up down off here there
now today day days week weeks year years time times ever never only also still even like want after before inside without while
2019 2020 2021 2022 2023 2024 2025 2026 2027 live shorts short`.split(/\s+/));

const WORD = /[\p{L}\p{N}]+/gu;

/** A word's matching form: lowercase, a plain plural folded ("grants" → "grant", "policies" → "policy"). */
export function stem(w: string): string {
  const s = w.toLowerCase();
  if (s.length > 4 && s.endsWith("ies")) return `${s.slice(0, -3)}y`;
  if (s.length > 4 && s.endsWith("s") && !s.endsWith("ss") && !s.endsWith("us") && !s.endsWith("is")) return s.slice(0, -1);
  return s;
}

const meaningful = (w: string) => w.length > 2 && !STOP.has(w.toLowerCase()) && !/^\d+$/.test(w);

/** A title's terms: each meaningful word, and each pair of meaningful words side by side. */
export function titleTerms(title: string): Map<string, string> {
  const words = title.match(WORD) ?? [];
  const out = new Map<string, string>(); // stemmed term → surface form
  for (let i = 0; i < words.length; i++) {
    if (!meaningful(words[i])) continue;
    out.set(stem(words[i]), words[i]);
    if (i + 1 < words.length && meaningful(words[i + 1])) out.set(`${stem(words[i])} ${stem(words[i + 1])}`, `${words[i]} ${words[i + 1]}`);
  }
  return out;
}

const sentence = (s: string) => {
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};

/**
 * Greedy grouping: the term carried by the most (outlier-weighted) titles from
 * enough channels becomes a theme and takes its titles; repeat on what's left.
 * A pair outranks a lone word it contains when it covers the same titles.
 * `taken` holds stemmed words already in use — Topic names, discarded and
 * keyword suggestions — and a theme never reuses one: discarding "Grant
 * writing" must not bring the same videos back as "Grant" or "Writing".
 */
export function clusterTitles(items: OutlierTitle[], taken: Set<string>, max = MAX_SUGGESTIONS): ResearchTopicSuggestion[] {
  const termsOf = new Map(items.map((it) => [it.id, titleTerms(it.title)]));
  const byId = new Map(items.map((it) => [it.id, it]));
  const unassigned = new Set(items.map((it) => it.id));
  const out: ResearchTopicSuggestion[] = [];
  const isTaken = (term: string) => term.split(" ").some((w) => taken.has(w));

  while (out.length < max) {
    // Each term → the unassigned titles carrying it, and how it was written.
    const carriers = new Map<string, string[]>();
    const surfaces = new Map<string, Map<string, number>>();
    for (const id of unassigned) {
      for (const [term, surface] of termsOf.get(id)!) {
        if (isTaken(term)) continue;
        carriers.set(term, [...(carriers.get(term) ?? []), id]);
        const s = surfaces.get(term) ?? new Map<string, number>();
        s.set(surface.toLowerCase(), (s.get(surface.toLowerCase()) ?? 0) + 1);
        surfaces.set(term, s);
      }
    }
    let best: { term: string; ids: string[]; weight: number } | null = null;
    for (const [term, ids] of carriers) {
      if (ids.length < MIN_VIDEOS) continue;
      if (new Set(ids.map((id) => byId.get(id)!.channelId)).size < MIN_CHANNELS) continue;
      const pair = term.includes(" ");
      const weight = ids.reduce((a, id) => a + Math.log2(1 + byId.get(id)!.score), 0) * (pair ? 1.25 : 1);
      if (!best || weight > best.weight || (weight === best.weight && term < best.term)) best = { term, ids, weight };
    }
    if (!best) break;
    for (const id of best.ids) unassigned.delete(id);

    const rows = best.ids.map((id) => byId.get(id)!).sort((a, b) => b.score - a.score);
    const surface = [...surfaces.get(best.term)!.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    // Words most of the group shares, beyond the term itself, become the Topic's other phrases.
    const termWords = new Set(best.term.split(" "));
    const co = new Map<string, { n: number; surface: string }>();
    for (const r of rows) {
      for (const [t, s] of termsOf.get(r.id)!) {
        if (t.includes(" ") || termWords.has(t) || isTaken(t)) continue;
        co.set(t, { n: (co.get(t)?.n ?? 0) + 1, surface: co.get(t)?.surface ?? s.toLowerCase() });
      }
    }
    const shared = [...co.values()].filter((c) => c.n >= Math.max(2, Math.ceil(rows.length / 3))).sort((a, b) => b.n - a.n).slice(0, 5).map((c) => c.surface);
    const scores = rows.map((r) => r.score).sort((a, b) => a - b);
    const mid = scores.length % 2 ? scores[(scores.length - 1) / 2] : (scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2;
    out.push({
      name: sentence(surface),
      term: best.term,
      phrases: [surface, ...shared],
      videos: rows.length,
      channels: new Set(rows.map((r) => r.channelId)).size,
      medianScore: Math.round(mid * 10) / 10,
      examples: rows.slice(0, 3).map((r) => ({ id: r.id, title: r.title, score: r.score, channelName: r.channelName })),
    });
    // Its words are spoken for: a later theme can't use them again.
    for (const w of termWords) taken.add(w);
  }
  return out;
}

/**
 * The suggestions for a workspace: Research's strong outliers (2× and up, past
 * the views floor — the same set Research lists) that match no Topic, minus
 * words already used by a Topic, a discarded suggestion or a keyword suggestion.
 */
export async function researchTopicSuggestions(workspaceId: string, keywordSuggestionNames?: string[]): Promise<{ suggestions: ResearchTopicSuggestion[]; unmatched: number }> {
  const { getSetting } = await import("@/lib/settings");
  // The keyword-cluster suggestions' names, unless the caller already has them — so Research and Topics agree.
  const alsoTaken = keywordSuggestionNames ?? (await (await import("@/lib/topics")).topicSuggestions(workspaceId).catch(() => [])).map((s) => s.name);
  const [videos, topics, dismissedRaw] = await Promise.all([
    db.intelVideo.findMany({
      where: { intelChannel: { workspaceId }, outlierScore: { gte: 2 }, views: { gte: OUTLIER_MIN_VIEWS } },
      orderBy: { outlierScore: "desc" },
      take: 1000,
      select: { id: true, title: true, outlierScore: true, intelChannel: { select: { id: true, name: true } } },
    }),
    db.topic.findMany({ where: { workspaceId }, select: { id: true, name: true, keywords: true } }),
    getSetting("topics:dismissed_suggestions", workspaceId).catch(() => ""),
  ]);
  let dismissed: string[] = [];
  try { dismissed = JSON.parse(dismissedRaw || "[]"); } catch { dismissed = []; }
  const prepared = prepareTopics(topics);
  const unmatched = videos.filter((v) => !matchTopic(v.title, prepared));
  const taken = new Set<string>();
  for (const n of [...topics.map((t) => t.name), ...dismissed, ...alsoTaken]) {
    for (const w of (n.match(WORD) ?? []).filter(meaningful)) taken.add(stem(w));
  }
  const suggestions = clusterTitles(
    unmatched.map((v) => ({ id: v.id, title: v.title, score: v.outlierScore ?? 0, channelId: v.intelChannel.id, channelName: v.intelChannel.name ?? "an unnamed channel" })),
    taken,
  );
  return { suggestions, unmatched: unmatched.length };
}
