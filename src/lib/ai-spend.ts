import { db } from "@/lib/db";

/**
 * What the AI was asked for, what it cost in tokens, and a budget that warns
 * (E-ENG-07).
 *
 * Every text call is metered by the router (lib/usage-meter.ts) with the
 * PURPOSE its caller named — an article draft, discovery, the assistant — so
 * Usage can say what the tokens went on, not only which model took them.
 *
 * ⚠ Money is an ESTIMATE at prices the platform operator types in, per model,
 * per million tokens — never a built-in price list (a guessed price is a
 * number nobody measured), and never a charge: there is no billing here. A
 * model with no price shows tokens and "no price set".
 *
 * The budget is TOKENS a month (UTC, from the 1st), set by a workspace admin.
 * Crossing 80% and 100% each tells the admins once that month. It warns; it
 * doesn't stop anything — the global pause does that.
 */

export const PRICES_KEY = "ai:prices";
export const BUDGET_KEY = "ai:monthly_token_budget";
export const BUDGET_THRESHOLDS = [80, 100] as const;

/** USD per million tokens. */
export type ModelPrice = { in: number; out: number };

export const PURPOSE_LABEL: Record<string, string> = {
  assistant: "The assistant",
  "assistant.summary": "Summarising long conversations",
  assist: "Draft buttons on fields",
  "ideas.discover": "Discovering ideas",
  "ideas.remix": "Remixed titles from Research",
  "article.outline": "Article outlines",
  "article.draft": "Article drafts",
  "article.variants": "Social angles from articles",
  "article.review": "Automatic review",
  "article.findings": "Article findings",
  "article.seo": "Article SEO fields",
  "article.images": "Image prompts",
  "article.craft": "Article editing tools",
  "article.optimize": "Article optimisation",
  "article.video": "Video packages from articles",
  keywords: "Keywords",
  "social.draft": "Social drafts",
  "social.tailor": "Tailoring posts per network",
  captions: "Caption Studio",
  "script.generate": "Script writing",
  "script.builder": "Script builder",
  "script.canvas": "Script canvas",
  "script.agent": "Agent Mode",
  "script.publish": "Publishing packages for scripts",
  "script.short": "Shorts cut from long scripts",
  chat: "Channel chat",
  research: "Research reports",
  experts: "Expert interviews",
  templates: "Templates",
  thumbnails: "Thumbnails",
  voice: "Voice training",
  onboarding: "Channel onboarding",
  vision: "Reading images",
};

export function purposeLabel(p: string | null | undefined): string {
  return p ? PURPOSE_LABEL[p] ?? p : "Not named (older calls)";
}

/** The operator's price list, keeping only well-formed, non-negative entries. */
export function parsePrices(raw: string | null | undefined): Record<string, ModelPrice> {
  try {
    const j = JSON.parse(raw ?? "{}") as Record<string, { in?: unknown; out?: unknown }>;
    const out: Record<string, ModelPrice> = {};
    for (const [model, p] of Object.entries(j ?? {})) {
      const i = Number(p?.in), o = Number(p?.out);
      if (Number.isFinite(i) && Number.isFinite(o) && i >= 0 && o >= 0) out[model] = { in: i, out: o };
    }
    return out;
  } catch {
    return {};
  }
}

/** Estimated USD for these tokens at `price`; null with no price (or no tokens counted). */
export function estimateCost(price: ModelPrice | undefined, inTok: number | null | undefined, outTok: number | null | undefined): number | null {
  if (!price || (inTok == null && outTok == null)) return null;
  return ((inTok ?? 0) * price.in + (outTok ?? 0) * price.out) / 1_000_000;
}

export function formatUsd(n: number): string {
  return n === 0 ? "$0" : n < 0.01 ? "<$0.01" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
const monthKey = (now: Date) => now.toISOString().slice(0, 7);

/** Tokens (in + out) this workspace's AI calls used this month. */
export async function monthTokens(workspaceId: string, now = new Date()): Promise<number> {
  const r = await db.usageLog.aggregate({ where: { workspaceId, action: "ai.text", createdAt: { gte: monthStart(now) } }, _sum: { tokens: true } });
  return r._sum.tokens ?? 0;
}

/** The highest threshold `used` has reached of `budget` — null below the first, or with no budget. */
export function thresholdReached(used: number, budget: number | null): (typeof BUDGET_THRESHOLDS)[number] | null {
  if (!budget || budget <= 0) return null;
  const pct = (used / budget) * 100;
  return [...BUDGET_THRESHOLDS].reverse().find((t) => pct >= t) ?? null;
}

export function parseBudget(raw: string | null | undefined): number | null {
  const n = Math.round(Number(raw ?? ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const lastCheck = new Map<string, number>();

/**
 * After a metered call: has this month crossed a threshold nobody was told
 * about? Checked at most once a minute per workspace per process; the notice's
 * entity id (`ai-budget:<YYYY-MM>:<pct>`) makes it once a month across
 * replicas. Never throws.
 */
export async function checkTokenBudget(workspaceId: string, now = new Date()): Promise<number | null> {
  try {
    const last = lastCheck.get(workspaceId) ?? 0;
    if (now.getTime() - last < 60_000) return null;
    lastCheck.set(workspaceId, now.getTime());
    const { getSetting } = await import("@/lib/settings");
    const budget = parseBudget(await getSetting(BUDGET_KEY, workspaceId));
    if (!budget) return null;
    const used = await monthTokens(workspaceId, now);
    const t = thresholdReached(used, budget);
    if (!t) return null;
    const entityId = `ai-budget:${monthKey(now)}:${t}`;
    if (await db.notification.findFirst({ where: { workspaceId, kind: "ai_budget", entityId }, select: { id: true } })) return null;
    const admins = await db.membership.findMany({ where: { workspaceId, role: "ADMIN", status: "active" }, select: { userId: true } });
    const { notify } = await import("@/lib/notify");
    await notify({
      workspaceId,
      kind: "ai_budget",
      title: t >= 100 ? "AI use has reached this month's token budget" : `AI use has passed ${t}% of this month's token budget`,
      body: `${used.toLocaleString("en-GB")} of ${budget.toLocaleString("en-GB")} tokens since the 1st (UTC). Nothing is stopped — the budget warns; Settings → Automation's pause stops generation.`,
      path: "/admin/usage",
      entityType: "workspace",
      entityId,
      userIds: admins.map((a) => a.userId),
    });
    return t;
  } catch {
    return null;
  }
}
