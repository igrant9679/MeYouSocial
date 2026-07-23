import { db } from "@/lib/db";
import { decryptSecret, type Encrypted } from "@/lib/blog-crypto";
import { wpListPosts, type WpCredentials } from "@/lib/wordpress";
import { writeAudit } from "@/lib/governance";
import { titleSimilarity } from "@/lib/blog-idea-scoring";
import { auditLinks, findFiller, findUnsupportedClaims } from "@/lib/blog-slop";

/**
 * FR-15 — existing-content audit.
 *
 * Crawls the connected WordPress site read-only and runs the same deterministic
 * detectors the pre-publish gate uses against what's already live. Output is
 * recommendations, never actions: this module cannot delete, rewrite or
 * republish anything, and a retire recommendation always carries redirect
 * guidance because the URL's ranking history is the asset, not the words.
 *
 * Performance data: GSC isn't connected, so the only real numbers available are
 * the manual `BlogSnapshot` positions on posts this app published. Where a URL
 * has none, the audit says so rather than guessing at its value.
 */

export const RECOMMENDATIONS = ["keep", "rewrite", "merge", "retire"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export const RECOMMENDATION_HUE: Record<Recommendation, string> = {
  keep: "green",
  rewrite: "amber",
  merge: "blue",
  retire: "rose",
};

const stripTags = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

export type AuditFinding = { label: string; detail: string; weight: number };

type Candidate = {
  url: string;
  title: string;
  content: string;
  source: string;
  position: number | null;
};

/**
 * A 0–100 "how much does this look like filler" score, built from the same
 * signals the pre-publish checks use. Higher is worse. Every contribution is
 * listed so a recommendation can be argued with rather than taken on faith.
 */
export function scoreContent(candidate: Candidate): { score: number; words: number; findings: AuditFinding[] } {
  const text = stripTags(candidate.content);
  const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const findings: AuditFinding[] = [];
  let score = 0;

  if (words < 300) {
    const w = words < 150 ? 30 : 18;
    score += w;
    findings.push({ label: "Thin", detail: `${words} words`, weight: w });
  }

  const filler = findFiller(candidate.content);
  if (filler.length) {
    const w = Math.min(30, filler.length * 8);
    score += w;
    findings.push({ label: "Filler phrasing", detail: filler.slice(0, 4).join(" · "), weight: w });
  }

  const claims = findUnsupportedClaims(candidate.content);
  if (claims.length) {
    const w = Math.min(20, claims.length * 5);
    score += w;
    findings.push({ label: "Unsourced claims", detail: `${claims.length} — e.g. ${claims[0].what}`, weight: w });
  }

  const links = auditLinks(candidate.content);
  if (links.vague.length) {
    const w = Math.min(10, links.vague.length * 4);
    score += w;
    findings.push({ label: "Vague link text", detail: [...new Set(links.vague)].join(", "), weight: w });
  }
  if (links.total === 0 && words > 400) {
    score += 6;
    findings.push({ label: "No links at all", detail: "no internal or external links", weight: 6 });
  }

  const headings = (candidate.content.match(/<h[2-6]\b/gi) ?? []).length;
  if (words > 600 && headings < 2) {
    score += 10;
    findings.push({ label: "Unstructured", detail: `${words} words, ${headings} subheadings`, weight: 10 });
  }

  return { score: Math.min(100, score), words, findings };
}

/**
 * Turn a score plus its neighbours into a recommendation. Deliberately
 * conservative: "keep" is the default, and retire is reserved for content that
 * is both thin and weak, because a live URL has value the words may not.
 */
export function recommend(
  candidate: Candidate,
  scored: { score: number; words: number },
  nearest: { url: string; title: string; similarity: number } | null,
): { recommendation: Recommendation; reason: string; mergeTargetUrl: string | null } {
  const ranking =
    candidate.position != null
      ? `Ranking at position ${candidate.position.toFixed(1)}.`
      : "No performance data for this URL — connect GSC before acting on ranking assumptions.";

  if (nearest && nearest.similarity >= 0.55) {
    return {
      recommendation: "merge",
      reason: `Overlaps "${nearest.title}" (${Math.round(nearest.similarity * 100)}% title overlap). Merge the stronger material into one page and 301 the other to it — never delete the losing URL. ${ranking}`,
      mergeTargetUrl: nearest.url,
    };
  }
  if (scored.words < 200 && scored.score >= 30) {
    return {
      recommendation: "retire",
      reason: `Thin (${scored.words} words) and weak on quality signals. Retire by redirecting the URL to the closest stronger page — a 301 keeps whatever authority it earned. Do not delete. ${ranking}`,
      mergeTargetUrl: null,
    };
  }
  if (scored.score >= 30) {
    return {
      recommendation: "rewrite",
      reason: `Quality signals are poor but the topic and URL are worth keeping. Rewrite in place at the same URL so history survives. ${ranking}`,
      mergeTargetUrl: null,
    };
  }
  return {
    recommendation: "keep",
    reason: `No significant quality flags. ${ranking}`,
    mergeTargetUrl: null,
  };
}

export type AuditReport = {
  scanned: number;
  written: number;
  source: "wordpress" | "site_pages" | "none";
  note?: string;
};

/** Run the audit for a workspace. Read-only against the site. */
export async function runContentAuditCore(workspaceId: string, maxPosts = 200): Promise<AuditReport> {
  const conn = await db.wordPressConnection.findUnique({ where: { workspaceId } });
  const candidates: Candidate[] = [];
  let source: AuditReport["source"] = "none";

  if (conn) {
    let creds: WpCredentials | null = null;
    try {
      creds = {
        baseUrl: conn.baseUrl,
        username: conn.username,
        appPassword: decryptSecret(JSON.parse(conn.encAppPassword) as Encrypted),
      };
    } catch {
      creds = null;
    }
    if (creds) {
      const posts = await wpListPosts(creds, maxPosts);
      for (const p of posts) {
        candidates.push({ url: p.link, title: p.title, content: p.content, source: "wordpress", position: null });
      }
      if (candidates.length) source = "wordpress";
    }
  }

  // Fallback: the page inventory, fetched publicly. Slower and shallower, but it
  // means the audit still works before WordPress is connected.
  if (!candidates.length) {
    const pages = await db.sitePage.findMany({ where: { workspaceId }, take: 50 });
    for (const page of pages) {
      try {
        const res = await fetch(page.url, { signal: AbortSignal.timeout(15000), redirect: "follow" });
        if (!res.ok) continue;
        const html = await res.text();
        const main = html.match(/<(?:article|main)\b[\s\S]*?<\/(?:article|main)>/i)?.[0] ?? html;
        candidates.push({ url: page.url, title: page.title, content: main, source: "site_page", position: null });
      } catch {
        // an unreachable page is not an audit failure
      }
    }
    if (candidates.length) source = "site_pages";
  }

  if (!candidates.length) {
    return {
      scanned: 0,
      written: 0,
      source: "none",
      note: "Nothing to audit — connect WordPress or add pages to the site inventory.",
    };
  }

  // Attach whatever real performance data we have. Matching is by published URL,
  // so it only covers posts this app published.
  const published = await db.blogPost.findMany({
    where: { workspaceId, status: "published", publishedUrl: { not: null } },
    select: { publishedUrl: true, snapshots: { orderBy: { capturedAt: "desc" }, take: 1, select: { position: true } } },
  });
  const positionByUrl = new Map(
    published.filter((p) => p.publishedUrl).map((p) => [p.publishedUrl!, p.snapshots[0]?.position ?? null]),
  );
  for (const c of candidates) c.position = positionByUrl.get(c.url) ?? null;

  let written = 0;
  for (const c of candidates) {
    const scored = scoreContent(c);
    let nearest: { url: string; title: string; similarity: number } | null = null;
    for (const other of candidates) {
      if (other.url === c.url) continue;
      const sim = titleSimilarity(c.title, other.title);
      if (!nearest || sim > nearest.similarity) nearest = { url: other.url, title: other.title, similarity: sim };
    }
    const verdict = recommend(c, scored, nearest);

    await db.contentAuditItem.upsert({
      where: { workspaceId_url: { workspaceId, url: c.url } },
      update: {
        title: c.title.slice(0, 300),
        source: c.source,
        wordCount: scored.words,
        slopScore: scored.score,
        findings: JSON.stringify(scored.findings),
        recommendation: verdict.recommendation,
        reason: verdict.reason,
        mergeTargetUrl: verdict.mergeTargetUrl,
        position: c.position,
        auditedAt: new Date(),
      },
      create: {
        workspaceId,
        url: c.url.slice(0, 1000),
        title: c.title.slice(0, 300),
        source: c.source,
        wordCount: scored.words,
        slopScore: scored.score,
        findings: JSON.stringify(scored.findings),
        recommendation: verdict.recommendation,
        reason: verdict.reason,
        mergeTargetUrl: verdict.mergeTargetUrl,
        position: c.position,
      },
    });
    written++;
  }

  await writeAudit({
    workspaceId,
    action: "content.audited",
    entityType: "workspace",
    meta: { scanned: candidates.length, written, source },
  });
  return {
    scanned: candidates.length,
    written,
    source,
    note:
      positionByUrl.size === 0
        ? "No performance data available — recommendations are based on content quality alone."
        : undefined,
  };
}

export function parseFindings(json: string): AuditFinding[] {
  try {
    const raw = JSON.parse(json);
    return Array.isArray(raw) ? (raw as AuditFinding[]) : [];
  } catch {
    return [];
  }
}
