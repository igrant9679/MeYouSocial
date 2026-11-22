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

/**
 * Settle the closing hashtag line of a post the engine wrote (2026-11-21): the tags on its last line(s) are kept
 * valid, de-duplicated (also against any already in the sentences) and at most `count` all told; a tag the brand
 * saved keeps its saved spelling; and if the whole is over `limit` characters the BODY is shortened (keeping a link it
 * ends with), never a tag cut in half — tags are dropped from the end only when the body alone can't make room.
 */
export function settleTagLine(raw: string, opts: { count: number; house?: string[]; limit: number }): string {
  const lines = raw.replace(/\r\n/g, "\n").trim().split("\n");
  let cut = lines.length;
  while (cut > 0 && (isTagLine(lines[cut - 1]) || !lines[cut - 1].trim())) cut--;
  let body = lines.slice(0, cut).join("\n").replace(/\s+$/, "");
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
  let kept = tags.slice(0, Math.max(0, opts.count - inline.size));
  const join = (b: string, ts: string[]) => (ts.length ? (b ? `${b}\n\n${ts.join(" ")}` : ts.join(" ")) : b);
  let out = join(body, kept);
  if (out.length <= opts.limit) return out;
  const tail = kept.length ? kept.join(" ").length + 2 : 0;
  if (opts.limit - tail >= 40) {
    body = shortenKeepingLink(body, opts.limit - tail);
    out = join(body, kept);
  }
  while (out.length > opts.limit && kept.length) {
    kept = kept.slice(0, -1);
    out = join(body, kept);
  }
  return out.length > opts.limit ? shortenKeepingLink(out, opts.limit) : out;
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
