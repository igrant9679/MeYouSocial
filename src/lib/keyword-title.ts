/**
 * A working title for an idea made from a keyword (E-IDE-13): shaped by what
 * the searcher wants (the keyword's intent), not "Article targeting …". A
 * starting point a person edits — written without a model, so it's instant,
 * free and never a mock.
 */

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const QUESTION = /^(how|what|why|when|where|which|who|can|does|do|is|are|should|will)\b/i;

export function proposeKeywordTitle(phrase: string, intent: string | null | undefined): string {
  const p = phrase.trim().replace(/\s+/g, " ");
  if (!p) return "Untitled idea";
  if (/^how to\b/i.test(p)) return `${cap(p)}: a step-by-step guide`;
  if (QUESTION.test(p)) return `${cap(p).replace(/\?*$/, "")}? A clear answer`;
  if (/\b(vs\.?|versus)\s/i.test(p)) return `${cap(p)}: an honest comparison`;
  switch (intent) {
    // "best crm" stays "Best crm", never "Best best crm".
    case "commercial": return /^(best|top)\b/i.test(p) ? `${cap(p)}: what to compare before you choose` : `Best ${p}: what to compare before you choose`;
    case "transactional": return `${cap(p)}: options, prices and how to choose`;
    case "navigational": return `${cap(p)}: everything in one place`;
    default: return `${cap(p)}: the complete guide`;
  }
}
