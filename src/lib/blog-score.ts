import { fleschReadingEase, runBlogChecks, type CheckResult } from "@/lib/blog-checks";

/**
 * Content score v1 (Wave A′): a deterministic 0-100 composite from signals we
 * actually have — publish gates, keyword coverage, structure, length,
 * readability. Explicitly NOT a SERP-comparative score (Surfer-style grading
 * vs top-ranking pages needs a search-data provider; the UI labels this).
 */

export type ScorePart = { label: string; score: number; max: number; detail?: string };
export type ContentScore = { total: number; parts: ScorePart[] };

type PostLike = {
  title: string;
  body: string | null;
  slug: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  focusKeyword: string | null;
  wordCountTarget: number | null;
  secondaryKeywords: string;
};

const strip = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

export function contentScore(post: PostLike, checks?: CheckResult[]): ContentScore {
  const body = post.body ?? "";
  const text = strip(body).toLowerCase();
  const words = text ? text.split(/\s+/).length : 0;
  const kw = post.focusKeyword?.toLowerCase().trim() ?? "";
  let secondary: string[] = [];
  try {
    secondary = (JSON.parse(post.secondaryKeywords) as string[]).map((s) => s.toLowerCase());
  } catch {
    secondary = [];
  }

  const parts: ScorePart[] = [];

  // Gates (30): required checks passing.
  const allChecks = checks ?? runBlogChecks(post, 0);
  const required = allChecks.filter((c) => c.required);
  const gatesPassed = required.filter((c) => c.pass).length;
  parts.push({
    label: "Publish gates",
    score: Math.round((gatesPassed / Math.max(1, required.length)) * 30),
    max: 30,
    detail: `${gatesPassed}/${required.length} required checks`,
  });

  // Keyword coverage (25).
  let kwScore = 0;
  const kwDetail: string[] = [];
  if (kw && text) {
    const occurrences = text.split(kw).length - 1;
    const density = words ? (occurrences * kw.split(/\s+/).length * 100) / words : 0;
    if (post.title.toLowerCase().includes(kw)) { kwScore += 7; } else kwDetail.push("not in title");
    const h2s = [...body.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => strip(m[1]).toLowerCase());
    if (h2s.some((h) => h.includes(kw))) { kwScore += 5; } else kwDetail.push("not in any h2");
    const firstPara = strip(body.split(/<\/p>/i)[0] ?? "").toLowerCase();
    if (firstPara.includes(kw)) { kwScore += 5; } else kwDetail.push("not in opening");
    if (density >= 0.4 && density <= 2.5) { kwScore += 5; } else kwDetail.push(`density ${density.toFixed(1)}% (aim 0.4–2.5)`);
    const secondaryHit = secondary.filter((s) => text.includes(s)).length;
    kwScore += Math.round((secondary.length ? secondaryHit / secondary.length : 1) * 3);
    if (secondary.length && secondaryHit < secondary.length) kwDetail.push(`${secondaryHit}/${secondary.length} secondary used`);
  } else {
    kwDetail.push(kw ? "no body yet" : "no focus keyword");
  }
  parts.push({ label: "Keyword coverage", score: kwScore, max: 25, detail: kwDetail.join("; ") || "all placements hit" });

  // Structure (15): h2 count, intro exists, lists present.
  let structure = 0;
  const h2Count = (body.match(/<h2/gi) ?? []).length;
  if (h2Count >= 3 && h2Count <= 9) structure += 7;
  else if (h2Count > 0) structure += 3;
  if (/<(ul|ol)/i.test(body)) structure += 4;
  if (words > 80) structure += 4;
  parts.push({ label: "Structure", score: structure, max: 15, detail: `${h2Count} h2 sections` });

  // Length vs target (15).
  const target = post.wordCountTarget ?? 900;
  const ratio = words / target;
  const lengthScore = ratio >= 0.9 && ratio <= 1.4 ? 15 : ratio >= 0.7 ? 10 : ratio >= 0.4 ? 5 : 0;
  parts.push({ label: "Length", score: lengthScore, max: 15, detail: `${words}/${target} words` });

  // Readability (15).
  const flesch = text ? fleschReadingEase(text) : null;
  const readScore = flesch === null ? 0 : flesch >= 60 ? 15 : flesch >= 50 ? 12 : flesch >= 40 ? 7 : 3;
  parts.push({ label: "Readability", score: readScore, max: 15, detail: flesch === null ? "too short to score" : `Flesch ${flesch}` });

  return { total: parts.reduce((a, p) => a + p.score, 0), parts };
}
