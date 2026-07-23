import { db } from "@/lib/db";

/**
 * FR-5 — idea prioritisation and dedupe.
 *
 * The score is computed here, not asked of a model. Every point comes from a
 * fact already in the workspace — the keyword's tier in the strategy table,
 * whether a target page exists, whether something close is already published —
 * and the breakdown is stored alongside it. A ranked list nobody can explain is
 * worse than no ranking at all.
 */

const WORD = /[a-z0-9]+/g;
const NOISE = new Set([
  "the", "and", "for", "with", "your", "you", "how", "what", "why", "when", "guide", "best",
  "top", "ways", "tips", "should", "does", "from", "that", "this", "into", "about",
]);

function keyTokens(s: string): Set<string> {
  return new Set((s.toLowerCase().match(WORD) ?? []).filter((w) => w.length > 3 && !NOISE.has(w)));
}

/** Jaccard overlap of the meaningful words in two titles. */
export function titleSimilarity(a: string, b: string): number {
  const ta = keyTokens(a);
  const tb = keyTokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

export type IdeaLike = {
  id: string;
  title: string;
  angle: string | null;
  keyword: string | null;
  tier: number | null;
  targetPage: string | null;
  seasonalHook: string | null;
  source: string;
};

export type ScoreResult = {
  priority: number;
  priorityReason: string;
  dedupeNote: string | null;
  refreshPostId: string | null;
  /** Filled in from the keyword strategy when the idea didn't carry one. */
  tier: number | null;
};

type PublishedPost = { id: string; title: string; position: number | null };

/** Everything the scorer needs, loaded once for a whole batch. */
export async function loadScoringContext(workspaceId: string) {
  const [keywords, pages, published] = await Promise.all([
    db.keyword.findMany({ where: { workspaceId, status: "active" }, select: { phrase: true, tier: true } }),
    db.sitePage.findMany({ where: { workspaceId }, select: { url: true, title: true, topic: true } }),
    db.blogPost.findMany({
      where: { workspaceId, status: "published" },
      select: { id: true, title: true, snapshots: { orderBy: { capturedAt: "desc" }, take: 1, select: { position: true } } },
      take: 300,
    }),
  ]);
  return {
    keywords: keywords.map((k) => ({ phrase: k.phrase.toLowerCase(), tier: k.tier })),
    pages,
    published: published.map<PublishedPost>((p) => ({
      id: p.id,
      title: p.title,
      position: p.snapshots[0]?.position ?? null,
    })),
  };
}

export type ScoringContext = Awaited<ReturnType<typeof loadScoringContext>>;

const TIER_POINTS: Record<number, number> = { 1: 30, 2: 24, 3: 16, 4: 10 };

export function scoreIdea(idea: IdeaLike, ctx: ScoringContext): ScoreResult {
  const reasons: string[] = [];
  let score = 0;

  // 1. Strategic weight: where this keyword sits in the workspace's own model.
  const kw = idea.keyword?.trim().toLowerCase();
  const match = kw ? ctx.keywords.find((k) => k.phrase === kw) : undefined;
  const tier = idea.tier ?? match?.tier ?? null;
  if (match) {
    const pts = TIER_POINTS[match.tier] ?? 10;
    score += pts;
    reasons.push(`+${pts} keyword "${kw}" is tier ${match.tier} in the strategy`);
  } else if (tier) {
    const pts = TIER_POINTS[tier] ?? 10;
    score += pts;
    reasons.push(`+${pts} tagged tier ${tier} (keyword not in the strategy table)`);
  } else {
    score += 8;
    reasons.push("+8 no tier or strategy keyword — unranked topic");
  }

  // 2. Does it support something we actually sell?
  if (idea.targetPage && ctx.pages.some((p) => p.url === idea.targetPage)) {
    score += 15;
    reasons.push("+15 supports a mapped service page");
  } else if (idea.targetPage) {
    score += 5;
    reasons.push("+5 names a target page that isn't in the page inventory yet");
  }

  // 3. Duplication against what's already live.
  let dedupeNote: string | null = null;
  let refreshPostId: string | null = null;
  let closest: { post: PublishedPost; sim: number } | null = null;
  for (const p of ctx.published) {
    const sim = titleSimilarity(idea.title, p.title);
    if (!closest || sim > closest.sim) closest = { post: p, sim };
  }
  if (closest && closest.sim >= 0.5) {
    dedupeNote = `Close to the published "${closest.post.title}" (${Math.round(closest.sim * 100)}% title overlap)`;
    // Something already ranking badly is worth refreshing, not re-writing.
    if (closest.post.position != null && closest.post.position > 10) {
      refreshPostId = closest.post.id;
      score += 25;
      reasons.push(`+25 refresh candidate — that post sits at position ${closest.post.position.toFixed(1)}`);
    } else {
      reasons.push("+0 near-duplicate of a published post that is already performing");
    }
  } else {
    score += 20;
    reasons.push("+20 nothing close is published yet");
  }

  // 4. Timeliness and readiness.
  if (idea.seasonalHook) {
    score += 10;
    reasons.push(`+10 seasonal hook: ${idea.seasonalHook}`);
  }
  if (idea.angle && idea.angle.trim().length > 30) {
    score += 5;
    reasons.push("+5 has a developed angle");
  }
  if (idea.source === "refresh" && !refreshPostId) {
    score += 15;
    reasons.push("+15 raised by the ranking-refresh loop");
  }

  return {
    priority: Math.max(0, Math.min(100, score)),
    priorityReason: reasons.join("\n"),
    dedupeNote,
    refreshPostId,
    tier,
  };
}

/** Rescore a whole workspace's open ideas. Returns how many rows changed. */
export async function rescoreIdeas(workspaceId: string): Promise<number> {
  const [ideas, ctx] = await Promise.all([
    db.blogIdea.findMany({ where: { workspaceId, status: { in: ["discovered", "approved"] } } }),
    loadScoringContext(workspaceId),
  ]);
  let changed = 0;
  for (const idea of ideas) {
    const result = scoreIdea(idea, ctx);
    if (
      idea.priority === result.priority &&
      idea.priorityReason === result.priorityReason &&
      idea.dedupeNote === result.dedupeNote &&
      idea.refreshPostId === result.refreshPostId &&
      idea.tier === result.tier
    ) {
      continue;
    }
    await db.blogIdea.update({
      where: { id: idea.id },
      data: {
        priority: result.priority,
        priorityReason: result.priorityReason,
        dedupeNote: result.dedupeNote,
        refreshPostId: result.refreshPostId,
        tier: result.tier,
      },
    });
    changed++;
  }
  return changed;
}
