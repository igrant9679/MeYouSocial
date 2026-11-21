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
