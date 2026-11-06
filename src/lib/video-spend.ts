import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";

/**
 * What video costs, before it's spent (E-VID-06).
 *
 * Veo bills per second of video generated, and a scene here is 4, 6 or 8
 * seconds (`SCENE_SECONDS`), so an estimate is scene seconds × a price per
 * second. ⚠ The price is the PLATFORM OPERATOR's, typed on Usage (global
 * Setting `video:prices`, USD per second per model) — never a built-in figure.
 * Until 2026-11-06 every board showed "est $" from a guessed $0.75 a second
 * (env VIDEO_COST_PER_SECOND's default); those stored estimates were cleared.
 * No price = seconds and a dash, never a made-up dollar.
 *
 * Every scene a real provider renders is metered as a UsageLog row
 * (`action: "video.scene"`, `seconds`), so the month's spend is counted, not
 * inferred from boards that may have been re-rendered. A workspace admin can set
 * a monthly budget in SECONDS (`video:monthly_seconds_budget`): the engine
 * renders nothing unattended past it, and Render now asks with the total first.
 */

export const VIDEO_PRICES_KEY = "video:prices";
export const VIDEO_BUDGET_KEY = "video:monthly_seconds_budget";
export const VIDEO_SCENE_ACTION = "video.scene";

/** USD per second of generated video, per model id. */
export function parseVideoPrices(raw: string | null | undefined): Record<string, number> {
  try {
    const j = JSON.parse(raw ?? "{}") as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [model, v] of Object.entries(j ?? {})) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) out[model] = n;
    }
    return out;
  } catch {
    return {};
  }
}

/** The operator's list — the global row only, never a workspace's. */
export async function videoPrices(): Promise<Record<string, number>> {
  const row = await db.setting.findUnique({ where: { key: VIDEO_PRICES_KEY } }).catch(() => null);
  return parseVideoPrices(row?.value);
}

export function parseSecondsBudget(raw: string | null | undefined): number | null {
  const n = Number(String(raw ?? "").replace(/[\s,_]/g, ""));
  return Number.isInteger(n) && n > 0 && n <= 10_000_000 ? n : null;
}

export const usd = (n: number) => `$${n.toFixed(2)}`;

export type SceneLike = { seconds: number; status?: string | null; outputUrl?: string | null };

/** A per-second price with the precision it was typed in ($0.075, not $0.08). */
export const perSecondUsd = (n: number) => `$${Number(n.toFixed(4))}`;

/** The scenes a render would PAY for: everything not already done with a clip kept. */
export function scenesToPay(scenes: SceneLike[]): SceneLike[] {
  return scenes.filter((s) => !(s.status === "done" && s.outputUrl));
}

export type Estimate = { clips: number; seconds: number; perSecond: number | null; usd: number | null; model: string };

/** Seconds × the operator's price for this model; usd null when there is no price. */
export function estimate(scenes: SceneLike[], model: string, prices: Record<string, number>): Estimate {
  const seconds = scenes.reduce((a, s) => a + (Number.isFinite(s.seconds) ? s.seconds : 0), 0);
  const perSecond = prices[model] ?? null;
  return { clips: scenes.length, seconds, perSecond, usd: perSecond == null ? null : Math.round(seconds * perSecond * 100) / 100, model };
}

/** The first of this month, UTC — the same month the token budget uses. */
export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export type MonthSpend = {
  since: Date;
  seconds: number;
  /** At today's prices; null when no rendered model has one. */
  usd: number | null;
  /** Seconds rendered by a model with no price — counted, not priced. */
  unpricedSeconds: number;
  budget: number | null;
  over: boolean;
};

export async function monthSpend(workspaceId: string, now = new Date()): Promise<MonthSpend> {
  const since = monthStart(now);
  const [rows, prices, budgetRaw] = await Promise.all([
    db.usageLog.groupBy({ by: ["model"], where: { workspaceId, action: VIDEO_SCENE_ACTION, createdAt: { gte: since } }, _sum: { seconds: true } }),
    videoPrices(),
    getSetting(VIDEO_BUDGET_KEY, workspaceId).catch(() => ""),
  ]);
  let seconds = 0, priced = 0, unpricedSeconds = 0, any = false;
  for (const r of rows) {
    const s = r._sum.seconds ?? 0;
    seconds += s;
    const p = r.model ? prices[r.model] : undefined;
    if (p == null) unpricedSeconds += s;
    else { priced += s * p; any = true; }
  }
  const budget = parseSecondsBudget(budgetRaw);
  return { since, seconds, usd: any ? Math.round(priced * 100) / 100 : null, unpricedSeconds, budget, over: budget != null && seconds >= budget };
}

/** One paid scene. Mock renders cost nothing and aren't metered. */
export async function meterVideoScene(row: { workspaceId: string; provider: string; model: string; seconds: number }): Promise<void> {
  if (row.provider === "mock") return;
  await db.usageLog.create({
    data: { workspaceId: row.workspaceId, action: VIDEO_SCENE_ACTION, provider: row.provider, model: row.model, seconds: Math.max(0, Math.round(row.seconds)), purpose: "video" },
  }).catch(() => {});
}
