/**
 * Hashtags in a post's text, for the composer's suggestions (2026-11-21). Pure — no network, no model.
 */

/** Every hashtag in a text (any script; at least one letter), as the networks read them. */
export const TAG_RE = /(?<![\p{L}\p{N}_&/])#[\p{L}\p{N}_]*[\p{L}_][\p{L}\p{N}_]*/gu;

/** The hashtags a text already has, lowercased. */
export const tagsIn = (s: string): Set<string> => new Set((s.match(TAG_RE) ?? []).map((t) => t.toLowerCase()));

const TAG_LINE = /^\s*(?:#[\p{L}\p{N}_]+\s*)+$/u;

/** True when a line is nothing but hashtags. */
export const isTagLine = (line: string): boolean => TAG_LINE.test(line);

/** Add hashtags at the end of a post: on the hashtag line when the post already ends with one, else on a line of their own. */
export function appendTags(text: string, tags: string[]): string {
  const have = tagsIn(text);
  const add = [...new Set(tags)].filter((t) => !have.has(t.toLowerCase()));
  if (!add.length) return text;
  const trimmed = text.replace(/\s+$/, "");
  if (!trimmed) return add.join(" ");
  const last = trimmed.split("\n").pop() ?? "";
  return `${trimmed}${isTagLine(last) ? " " : "\n\n"}${add.join(" ")}`;
}

/** Take one hashtag out of a post (every occurrence, any case), tidying the spaces and blank lines it leaves. */
export function removeTag(text: string, tag: string): string {
  const esc = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .replace(new RegExp(`(^|[ \\t])${esc}(?![\\p{L}\\p{N}_])[ \\t]?`, "gimu"), "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+$/, "");
}

/**
 * How many hashtags read well on these networks (Zernio slugs, any case) — the tightest wins, since one text goes to
 * them all. Shared by the composer's "Add top N" and the posts the engine writes (2026-11-21).
 */
export function howManyTags(providers: string[]): { count: number; advice: string } {
  const have = new Set(providers.map((p) => p.trim().toLowerCase()));
  const rules: Array<[string, number, string]> = [
    ["threads", 1, "Threads makes only the first hashtag a topic"],
    ["twitter", 2, "X: one or two"],
    ["bluesky", 2, "Bluesky: one or two"],
    ["linkedin", 3, "LinkedIn: about three"],
    ["facebook", 3, "Facebook: two or three"],
    ["youtube", 3, "YouTube shows the first three above the title"],
    ["pinterest", 5, "Pinterest: a few, in the description"],
    ["tiktok", 5, "TikTok: three to five"],
    ["instagram", 8, "Instagram: up to about eight"],
  ];
  const hits = rules.filter(([p]) => have.has(p));
  if (!hits.length) return { count: 3, advice: "Two or three read well on most networks." };
  return { count: Math.min(...hits.map(([, n]) => n)), advice: hits.map(([, , a]) => a).join(" · ") };
}

/** What the engine's writer is told about hashtags: how many, and the brand's own first. */
export function tagInstruction(count: number, house: string[]): string {
  return (
    `End the post with one line of exactly ${count} hashtag${count === 1 ? "" : "s"}, and put none inside the sentences. ` +
    (house.length ? `The company's own hashtags come first where they fit the post, spelled exactly like this: ${house.slice(0, 20).join(" ")}. ` : "") +
    "Otherwise use hashtags people really follow for the topic: CamelCase, no generic filler such as #Love or #Motivation."
  );
}

/** Shorten text to `max` characters at a word boundary, keeping a link it ends with whole. */
function shortenKeepingLink(text: string, max: number): string {
  if (text.length <= max) return text;
  const m = text.match(/(\s+)(https?:\/\/\S+)$/);
  if (m && m.index != null) {
    const room = max - m[1].length - m[2].length;
    if (room >= 20) return `${text.slice(0, m.index).slice(0, room + 1).replace(/\s+\S*$/, "").replace(/\s+$/, "")}${m[1]}${m[2]}`;
  }
  return text.slice(0, max + 1).replace(/\s+\S*$/, "").replace(/\s+$/, "");
}

/** A sentence end: . ! ? or … (closing quotes and brackets kept with it), followed by a space or the end. */
const SENTENCE_END = /[.!?…]["'”’)\]]*(?=\s|$)/g;

/** The shortest a post may become by dropping sentences — less than this reads as a stub, not a post. */
const MIN_BODY = 40;

/**
 * Text cut back to `max` characters at the end of a sentence, keeping a link it ends with whole; null when no
 * complete sentence of at least MIN_BODY characters fits (2026-11-24: a cut at a word sent half sentences out).
 */
export function cutAtSentence(text: string, max: number): string | null {
  if (text.length <= max) return text;
  const m = text.match(/(\s+)(https?:\/\/\S+)$/);
  if (m && m.index != null) {
    const head = cutAtSentence(text.slice(0, m.index).replace(/\s+$/, ""), max - m[1].length - m[2].length);
    return head ? `${head}${m[1]}${m[2]}` : null;
  }
  let best = -1;
  for (const hit of text.matchAll(SENTENCE_END)) {
    const end = (hit.index ?? 0) + hit[0].length;
    if (end > max) break;
    best = end;
  }
  if (best < MIN_BODY) return null;
  return text.slice(0, best).replace(/\s+$/, "");
}

/**
 * How a post the engine wrote was made to fit: `whole` — every sentence kept; `sentence` — closing sentences (or, when
 * the body couldn't make room, closing hashtags) dropped, so it still reads complete; `over` — it can't fit without
 * cutting a sentence in half, and `text` is that cut: never store it unattended.
 */
export type SettledPost = { text: string; fit: "whole" | "sentence" | "over"; whole: string };

/**
 * Settle a post the engine wrote (2026-11-21, reworked 2026-11-24): the tags on its last line(s) are kept valid,
 * de-duplicated (also against any already in the sentences) and at most `count` all told; a tag the brand saved keeps
 * its saved spelling. If the whole is over `limit` characters, closing SENTENCES of the body are dropped (keeping a
 * link it ends with) — never a tag cut in half, never a sentence; tags are dropped from the end only when no complete
 * body fits with them. `whole` is the settled post before any cut, for asking the writer to shorten it.
 */
export function settlePost(raw: string, opts: { count: number; house?: string[]; limit: number }): SettledPost {
  const lines = raw.replace(/\r\n/g, "\n").trim().split("\n");
  let cut = lines.length;
  while (cut > 0 && (isTagLine(lines[cut - 1]) || !lines[cut - 1].trim())) cut--;
  const body = lines.slice(0, cut).join("\n").replace(/\s+$/, "");
  const trailing = lines.slice(cut).join(" ");
  const inline = tagsIn(body);
  const houseBy = new Map((opts.house ?? []).map((h) => [h.toLowerCase(), h]));
  const seen = new Set(inline);
  const tags: string[] = [];
  for (const t of trailing.match(TAG_RE) ?? []) {
    const low = t.toLowerCase();
    if (seen.has(low) || t.length > 60) continue;
    seen.add(low);
    tags.push(houseBy.get(low) ?? t);
  }
  const kept = tags.slice(0, Math.max(0, opts.count - inline.size));
  const join = (b: string, ts: string[]) => (ts.length ? (b ? `${b}\n\n${ts.join(" ")}` : ts.join(" ")) : b);
  const whole = join(body, kept);
  if (whole.length <= opts.limit) return { text: whole, fit: "whole", whole };
  // Fewer sentences before fewer tags: the count is what the networks read well.
  for (let k = kept.length; k >= 0; k--) {
    const ts = kept.slice(0, k);
    const room = opts.limit - (ts.length ? ts.join(" ").length + 2 : 0);
    const short = room > 0 ? cutAtSentence(body, room) : null;
    if (short) return { text: join(short, ts), fit: "sentence", whole };
  }
  return { text: shortenKeepingLink(join(body, kept), opts.limit), fit: "over", whole };
}

/**
 * Put a link into a post: where the cursor was (`at`, a character offset), or — with no cursor, or the cursor at the
 * end — on a line of its own at the end, above a closing line of hashtags so the tags stay last.
 */
export function insertLinkAt(text: string, url: string, at: number | null): string {
  const body = text.replace(/\s+$/, "");
  if (at != null && at < body.length) {
    const before = text.slice(0, at);
    const after = text.slice(at);
    return `${before}${before && !/\s$/.test(before) ? " " : ""}${url}${after && !/^\s/.test(after) ? " " : ""}${after}`;
  }
  if (!body) return url;
  const lines = body.split("\n");
  const last = lines[lines.length - 1] ?? "";
  if (lines.length > 1 && isTagLine(last)) return `${lines.slice(0, -1).join("\n").replace(/\s+$/, "")}\n\n${url}\n\n${last}`;
  return `${body}\n\n${url}`;
}
