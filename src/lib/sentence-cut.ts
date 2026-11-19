/**
 * Shorten text to at most `max` characters WITHOUT stopping in the middle of a
 * sentence (2026-11-19: the audience refresh stored each paragraph cut at 600
 * characters flat, so a profile read "…'best alternati" on its page).
 *
 * Whole if it fits. Otherwise it ends at the last sentence end inside the
 * limit — a full stop, question mark or exclamation mark, with a closing quote
 * or bracket, followed by a space or the end of the text. A "sentence end"
 * that is really the middle of a number or a word ("3.5", "example.com") has
 * no space after it and isn't one. If the only sentence end is in the first
 * half — one very long sentence — it stops at a word instead and ends with "…",
 * so a reader can see it was shortened rather than take a fragment for the whole.
 */
export function endAtSentence(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  let end = -1;
  for (const m of t.matchAll(/[.!?]["'”’)\]]?(?=\s|$)/g)) {
    const at = (m.index ?? 0) + m[0].length;
    if (at > max) break;
    end = at;
  }
  if (end >= max * 0.5) return t.slice(0, end);
  const head = t.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  return `${head.slice(0, space > max * 0.5 ? space : head.length).trimEnd()}…`;
}
