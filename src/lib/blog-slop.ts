import { db } from "@/lib/db";
import { selectSmeProfile } from "@/lib/sme";
import type { CheckResult } from "@/lib/blog-checks";

/**
 * FR-10 anti-slop pre-checks and the FR-9 link/label rules.
 *
 * Everything here is deterministic string work, deliberately. Asking a model
 * "is this slop?" produces a confident opinion with no reproducibility; a
 * phrase list produces the same verdict every run and can be argued with. The
 * cost is that it only catches the tells it knows about — which is why these
 * are advisory except where they map to a WCAG AA failure.
 */

const stripTags = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// ---- FR-9: link text and labels ---------------------------------------------------

/** Link text that tells a screen-reader user nothing out of context (WCAG 2.4.4). */
const VAGUE_LINK_TEXT = new Set([
  "click here",
  "here",
  "read more",
  "more",
  "learn more",
  "this link",
  "link",
  "this",
  "this page",
  "find out more",
  "see more",
  "download",
  "continue",
  "go",
]);

export type LinkAudit = { vague: string[]; empty: number; total: number };

export function auditLinks(html: string): LinkAudit {
  const vague: string[] = [];
  let empty = 0;
  let total = 0;
  for (const m of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    total++;
    const tag = m[0];
    const text = stripTags(m[1]).toLowerCase().replace(/[.,:;!?]+$/, "").trim();
    if (!text) {
      // An image link carries its accessible name from the image's alt text.
      const hasAltText = /<img\b[^>]*\balt\s*=\s*"[^"]+"/i.test(m[1]);
      const hasAriaLabel = /\baria-label\s*=\s*"[^"]+"/i.test(tag);
      if (!hasAltText && !hasAriaLabel) empty++;
      continue;
    }
    if (VAGUE_LINK_TEXT.has(text)) vague.push(text);
  }
  return { vague, empty, total };
}

/** Form controls in body content that carry no accessible name (WCAG 3.3.2). */
export function auditLabels(html: string): number {
  let unlabeled = 0;
  for (const m of html.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) {
    const tag = m[0];
    if (/\btype\s*=\s*"(hidden|submit|button)"/i.test(tag)) continue;
    const hasAria = /\baria-label(ledby)?\s*=\s*"[^"]+"/i.test(tag);
    const id = tag.match(/\bid\s*=\s*"([^"]+)"/i)?.[1];
    const hasLabel = id ? new RegExp(`<label\\b[^>]*\\bfor\\s*=\\s*"${id}"`, "i").test(html) : false;
    if (!hasAria && !hasLabel) unlabeled++;
  }
  return unlabeled;
}

// ---- FR-10: the slop tells ----------------------------------------------------------

/**
 * Phrases that signal filler rather than thinking. Curated for the tells that
 * survive editing, not every cliché in English — a list that flags everything
 * gets ignored.
 */
const FILLER_PHRASES = [
  "in today's fast-paced world",
  "in today's digital age",
  "in the ever-evolving landscape",
  "in the world of",
  "when it comes to",
  "at the end of the day",
  "it is important to note",
  "it's important to note",
  "it is worth noting",
  "needless to say",
  "last but not least",
  "in conclusion",
  "delve into",
  "dive deep into",
  "navigate the complexities",
  "unlock the power",
  "unlock the potential",
  "game-changer",
  "game changer",
  "seamlessly integrate",
  "robust solution",
  "cutting-edge solution",
  "take it to the next level",
  "the key takeaway is",
  "let's face it",
  "look no further",
  "revolutionize the way",
  "in this article, we will",
  "we will explore",
];

/** Claim shapes that need a source behind them. */
const CLAIM_PATTERNS: Array<{ re: RegExp; what: string }> = [
  { re: /\b\d{1,3}(?:\.\d+)?\s?%/g, what: "a percentage" },
  { re: /\bstudies (?:show|have shown|suggest)\b/gi, what: "\"studies show\"" },
  { re: /\bresearch (?:shows|suggests|indicates)\b/gi, what: "\"research shows\"" },
  { re: /\baccording to (?:a|an|the)\b/gi, what: "an attributed claim" },
  { re: /\b(?:experts|analysts) (?:say|agree|predict)\b/gi, what: "an appeal to experts" },
  { re: /\b\d+(?:,\d{3})+\b/g, what: "a large figure" },
];

export function findFiller(html: string): string[] {
  const text = stripTags(html).toLowerCase();
  return FILLER_PHRASES.filter((p) => text.includes(p));
}

/**
 * Sentences carrying a checkable claim with no link and no [NEEDS SOURCE]
 * marker beside them. Sentence-level, so a cited paragraph doesn't excuse an
 * uncited one three paragraphs down.
 */
export function findUnsupportedClaims(html: string): Array<{ sentence: string; what: string }> {
  const out: Array<{ sentence: string; what: string }> = [];
  // Split on sentence boundaries but keep the original markup per chunk so we
  // can tell whether the claim sits next to a link.
  const chunks = html.split(/(?<=[.!?])\s+/);
  for (const chunk of chunks) {
    const text = stripTags(chunk);
    if (!text) continue;
    if (/\[NEEDS SOURCE\]/i.test(chunk)) continue;
    if (/<a\b[^>]*href/i.test(chunk)) continue;
    for (const { re, what } of CLAIM_PATTERNS) {
      re.lastIndex = 0;
      if (re.test(text)) {
        out.push({ sentence: text.slice(0, 160), what });
        break;
      }
    }
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * Literal violations of the rules someone actually wrote down — the brand tone
 * guardrails and the expert's never-say list. Each non-empty line or
 * semicolon-separated clause is treated as a phrase to look for. Only catches
 * literal wording, which is why it's advisory: a rule like "never promise
 * ranking positions" can be broken without using those words.
 */
export function findRuleViolations(html: string, rules: Array<string | null | undefined>): string[] {
  const text = stripTags(html).toLowerCase();
  const hits: string[] = [];
  for (const rule of rules) {
    if (!rule) continue;
    for (const raw of rule.split(/[\n;]+/)) {
      const phrase = raw
        .trim()
        .replace(/^[-•*\d.\s]+/, "")
        .replace(/^(never|don't|do not|avoid)\s+(say|use|write|claim)?\s*/i, "")
        .replace(/^["']|["']$/g, "")
        .trim()
        .toLowerCase();
      // Too short and it matches everything; too long and it never matches.
      if (phrase.length < 4 || phrase.length > 60) continue;
      if (text.includes(phrase) && !hits.includes(phrase)) hits.push(phrase);
    }
  }
  return hits.slice(0, 10);
}

// ---- Assembly ------------------------------------------------------------------------

export type EditorialContext = {
  /** The matched expert, if any — FR-10 counts missing grounding as a smell. */
  smeName: string | null;
  neverSay: string | null;
  guardrails: string | null;
};

/** Resolve the rules this post is answerable to. */
export async function loadEditorialContext(
  workspaceId: string,
  post: { smeProfileId?: string | null; title?: string; focusKeyword?: string | null; audience?: string | null },
): Promise<EditorialContext> {
  const [sme, brand] = await Promise.all([
    selectSmeProfile(workspaceId, post),
    db.brandKit.findUnique({ where: { workspaceId }, select: { toneGuardrails: true } }),
  ]);
  return {
    smeName: sme?.name ?? null,
    neverSay: sme?.neverSay ?? null,
    guardrails: brand?.toneGuardrails ?? null,
  };
}

/** The FR-9 + FR-10 half of the pre-publish checklist. */
export function editorialChecks(body: string, ctx: EditorialContext): CheckResult[] {
  const checks: CheckResult[] = [];

  const links = auditLinks(body);
  checks.push({
    id: "link-text",
    label: "Link text is descriptive (WCAG 2.4.4)",
    pass: links.vague.length === 0,
    required: true,
    detail: links.vague.length
      ? `${links.vague.length} vague: ${[...new Set(links.vague)].join(", ")}`
      : links.total
        ? `${links.total} links`
        : "no links",
  });
  checks.push({
    id: "link-empty",
    label: "No links without an accessible name",
    pass: links.empty === 0,
    required: false,
    detail: links.empty ? `${links.empty} empty` : undefined,
  });

  const unlabeled = auditLabels(body);
  checks.push({
    id: "labels",
    label: "Form controls are labelled (WCAG 3.3.2)",
    pass: unlabeled === 0,
    required: false,
    detail: unlabeled ? `${unlabeled} unlabelled` : "no controls",
  });

  const filler = findFiller(body);
  checks.push({
    id: "filler",
    label: "No generic filler phrasing",
    pass: filler.length === 0,
    required: false,
    detail: filler.length ? filler.slice(0, 5).join(" · ") : undefined,
  });

  const claims = findUnsupportedClaims(body);
  checks.push({
    id: "unsupported-claims",
    label: "Checkable claims carry a source",
    pass: claims.length === 0,
    required: false,
    detail: claims.length ? `${claims.length} unsourced — e.g. ${claims[0].what} in "${claims[0].sentence.slice(0, 70)}…"` : undefined,
  });

  const violations = findRuleViolations(body, [ctx.neverSay, ctx.guardrails]);
  checks.push({
    id: "house-rules",
    label: "No literal breaches of the brand or expert rules",
    pass: violations.length === 0,
    required: false,
    detail: violations.length ? violations.join(" · ") : "literal wording only — read for intent too",
  });

  checks.push({
    id: "sme-grounding",
    label: "Grounded in an expert profile",
    pass: !!ctx.smeName,
    required: false,
    detail: ctx.smeName ?? "no expert matched — the draft speaks for nobody in particular",
  });

  return checks;
}
