/**
 * Strip the Markdown list furniture models leave INSIDE a string value.
 *
 * ⚠ This is not about parsing a list. Every idea-discovery call asks for JSON
 * and gets JSON — the marker arrives inside the value:
 *
 *     {"title": "-\tNo-code workflow automation for non-award processes"}
 *
 * `.trim()` never touched it (a hyphen is not whitespace), so the dash rode
 * the idea into a draft, into an article title, and on 2026-09-17 into a
 * PUBLISHED post on CommunityForce. Seven ideas and two articles carried it
 * (audit A3, docs/UX-AUDIT-2026-09-20.md).
 *
 * The marker must be followed by whitespace, so a title that legitimately
 * opens with a sign keeps it: "-40% churn" and "3.5x faster" are untouched,
 * while "- Topic", "-\tTopic", "1. Topic" and "• Topic" lose the furniture.
 */

// A single leading bullet or ordinal, followed by real whitespace.
const LIST_MARKER = /^[-*+•·–—]\s+|^\(?\d{1,3}[.)]\s+/;
// A Markdown heading, which models add when asked for a "title".
const HEADING = /^#{1,6}\s+/;
// Wrapping emphasis or quotes the model added around the whole value.
const WRAPPED_BOLD = /^\*\*([\s\S]+)\*\*$/;
const WRAPPED_QUOTES = /^["'“”‘’]([\s\S]+)["'“”‘’]$/;

/** Remove one leading list marker or heading mark. Whitespace-only input stays "". */
export function stripListMarker(value: string): string {
  let out = value.trim();
  out = out.replace(HEADING, "").replace(LIST_MARKER, "");
  return out.trim();
}

/**
 * The full clean for anything a person will read as a title: list furniture
 * off the front, wrapping emphasis/quotes off both ends, internal newlines and
 * tabs collapsed to single spaces, then trimmed to `max`.
 */
export function cleanTitle(value: string, max: number): string {
  let out = stripListMarker(value);
  // Models wrap a title in ** or quotes surprisingly often; unwrap once each.
  const bold = out.match(WRAPPED_BOLD);
  if (bold) out = bold[1].trim();
  const quoted = out.match(WRAPPED_QUOTES);
  if (quoted) out = quoted[1].trim();
  // A marker can hide behind the wrapper: "**- Topic**".
  out = stripListMarker(out);
  // A title is one line. Tabs and newlines inside one are always an artefact.
  out = out.replace(/\s+/g, " ").trim();
  return out.slice(0, max).trim();
}

/**
 * True when the value still carries list furniture. Used by the repair probe.
 * Compares at the value's own length so a long string is never reported dirty
 * just because `cleanTitle` would have trimmed it.
 */
export function hasListMarker(value: string): boolean {
  return cleanTitle(value, value.length) !== value.trim().replace(/\s+/g, " ");
}
