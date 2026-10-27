/**
 * The claim behind each [NEEDS SOURCE] marker in a body: the sentence that
 * precedes it. Shared by the drafting core (rows at draft time) and
 * auto-review (rows for orphan markers), so a marker can never exist that
 * neither can turn into a workable citation row.
 *
 * ⚠ The previous regex, `([^.!?]*[.!?]?)\s*\[NEEDS SOURCE\]`, stopped at the
 * sentence's own full stop, so a sentence ending in a closing quote —
 * `…donor-advised fund." [NEEDS SOURCE]` — yielded a claim of `"`, which the
 * length filter dropped: no row, no search, no Inbox card, and the article
 * was held for good (LSI, 2026-09-04 → 06). A boundary here is terminal
 * punctuation, then any closing quotes or brackets, then whitespace.
 */
export const NEEDS_SOURCE = "[NEEDS SOURCE]";

/**
 * Every spelling of the marker a writer (model or person) produces —
 * [NEEDS SOURCE], [Needs Source], [NEEDS SOURCE: 2023 survey], [NEEDS
 * CITATION], [needs a source], [citation needed], [SOURCE NEEDED]. Only the
 * exact upper-case string used to count, so the variants slipped through the
 * truth gate and were published verbatim (ART-20). One pattern, used by the
 * gate, the extractor and the code that links or removes markers.
 */
const MARKER_SOURCE = String.raw`\[\s*(?:needs?\s+(?:an?\s+)?(?:sources?|citations?|cites?|references?|refs?)|(?:citations?|sources?|references?)\s+needed)\b[^\]\n]{0,200}\]`;

/** A fresh global, case-insensitive matcher (regexes with /g carry state). */
export function markerRegex(): RegExp {
  return new RegExp(MARKER_SOURCE, "gi");
}

export function countMarkers(text: string): number {
  return (text.match(markerRegex()) ?? []).length;
}

export function hasMarker(text: string): boolean {
  return new RegExp(MARKER_SOURCE, "i").test(text);
}

export function claimsFromMarkers(plainText: string, max = 3): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = markerRegex();
  let m: RegExpExecArray | null;
  while ((m = re.exec(plainText))) {
    // Earlier markers are not part of any claim — strip them before looking
    // for the sentence boundary, or the second of two markers would carry the
    // first one's text.
    const before = plainText.slice(Math.max(0, m.index - 600), m.index).replace(markerRegex(), " ").replace(/\s+/g, " ").trimEnd();
    const boundaries = [...before.matchAll(/[.!?]["'”’)\]]*\s+/g)];
    const last = boundaries.length ? boundaries[boundaries.length - 1] : null;
    let claim = before;
    if (last && last.index !== undefined) {
      const candidate = before.slice(last.index + last[0].length).trim();
      // A marker right after a stray quote or fragment: keep the previous
      // sentence too rather than drop the marker on the floor.
      claim = candidate.length > 8 ? candidate : before;
    }
    claim = claim.trim().slice(-300);
    if (claim.length <= 8) continue;
    const key = claim.toLowerCase().slice(-60);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(claim);
    if (out.length >= max) break;
  }
  return out;
}
