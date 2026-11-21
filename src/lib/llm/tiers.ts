import { getModel } from "./models";

/**
 * Model tiers (2026-11-17, the owner's "Model tiers"): each KIND of job runs on
 * a model that fits what the job is worth, when a workspace admin turns that on.
 *
 * - The tier is decided by the job's `purpose`, in code — nothing judges how
 *   hard a request is before it runs. A judge is one more call, and its mistakes
 *   are invisible because weak prose still reads fluently.
 * - **Standard is the workspace's default model.** There is no separate
 *   Standard pick: Settings → Workspace → "Default AI model" is it.
 * - Light and Best are each an admin's pick, or automatic: the fast and the top
 *   model of the SAME provider as the default, so a workspace never leaves the
 *   provider it has a key for.
 * - A person's own choice always wins: an article's, a script's or a channel's
 *   model is never replaced by a tier (the router only tiers a blank model).
 * - Off by default. Off is exactly the behaviour before tiers existed.
 *
 * Import-free apart from the model list, so pages and scripts can read it.
 */

export type Tier = "light" | "standard" | "best";
export const TIERS: readonly Tier[] = ["light", "standard", "best"];
export const TIER_LABEL: Record<Tier, string> = { light: "Light", standard: "Standard", best: "Best" };
export const isTier = (v: unknown): v is Tier => v === "light" || v === "standard" || v === "best";

/** "on" turns tiers on for the workspace; anything else is off. */
export const TIERS_ON_KEY = "ai:tiers";
/** An admin's model for the tier; blank = automatic. Standard has none — it is the default model. */
export const TIER_MODEL_KEY: Record<Exclude<Tier, "standard">, string> = { light: "ai:tier:light", best: "ai:tier:best" };
/** The tier Elsie's own turns run on; blank = her default (Standard). */
export const ELSIE_TIER_KEY = "ai:tier:assistant";
/** "on" = this workspace's admin allowed DeepSeek (where its text is processed is their decision). */
export const ALLOW_DEEPSEEK_KEY = "ai:allow_deepseek";
export const TIER_SETTING_KEYS = [TIERS_ON_KEY, TIER_MODEL_KEY.light, TIER_MODEL_KEY.best, ELSIE_TIER_KEY, ALLOW_DEEPSEEK_KEY] as const;

/**
 * The tier of every kind of job (`purpose`, lib/ai-spend.ts PURPOSE_LABEL).
 *
 * Light = short, mechanical output a person sees and can fix in seconds.
 * Best = the long writing the workspace is judged on, and the review that
 * decides whether it may publish. Everything else is Standard.
 *
 * ⚠ `vision` has no tier: reading images goes straight to Gemini / OpenAI
 * (lib/vision.ts), not through the text router.
 * ⚠ A purpose missing here is Standard — and `scripts/check-model-callers.mts`
 * fails the build, so a new kind of job is placed on purpose, not by default.
 */
export const PURPOSE_TIER: Record<string, Tier> = {
  // Light
  "assistant.summary": "light",
  assist: "light",
  "ideas.remix": "light",
  "article.seo": "light",
  "article.images": "light",
  keywords: "light",
  "social.tailor": "light",
  "social.hashtags": "light",
  thumbnails: "light",
  // Standard
  assistant: "standard",
  "ideas.discover": "standard",
  "article.outline": "standard",
  "article.variants": "standard",
  "article.findings": "standard",
  "article.craft": "standard",
  "article.optimize": "standard",
  "article.video": "standard",
  "social.draft": "standard",
  captions: "standard",
  "script.builder": "standard",
  "script.canvas": "standard",
  "script.publish": "standard",
  "script.short": "standard",
  chat: "standard",
  research: "standard",
  experts: "standard",
  templates: "standard",
  voice: "standard",
  onboarding: "standard",
  // Best
  "article.draft": "best",
  "article.review": "best",
  "script.generate": "best",
  "script.agent": "best",
};

/** Purposes that never pass through the text router's tiers: reading images, and the one test call a DeepSeek pick makes (lib/llm/probe.ts). */
export const UNTIERED_PURPOSES: readonly string[] = ["vision", "model.check"];

/** The tier a kind of job has in code — before a workspace's own setting for Elsie. */
export function defaultTierOf(purpose: string | null | undefined): Tier {
  return (purpose && PURPOSE_TIER[purpose]) || "standard";
}

/** The tier a job runs on in a workspace: the code's, except Elsie's own turns, which an admin may move. */
export function tierOf(purpose: string | null | undefined, elsieTier?: string | null): Tier {
  if (purpose === "assistant" && isTier(elsieTier)) return elsieTier;
  return defaultTierOf(purpose);
}

/**
 * The automatic model for Light and Best: the fast and the top model of the
 * provider that runs the workspace's default. Unknown provider → no automatic
 * model, and the job stays on the default.
 */
const AUTO: Record<string, Record<Exclude<Tier, "standard">, string>> = {
  anthropic: { light: "claude-haiku", best: "claude-opus" },
  google: { light: "gemini-2.5-flash", best: "gemini-2.5-pro" },
};

export function autoTierModel(tier: Tier, standardModel: string): string {
  if (tier === "standard") return standardModel;
  const provider = getModel(standardModel)?.provider ?? "";
  return AUTO[provider]?.[tier] ?? standardModel;
}

/** What a workspace has set, read once (see lib/llm/index.ts `tierSettings`). */
export type TierSettings = { on: boolean; light: string; best: string; elsie: Tier; deepseek: boolean };

/** The model a job of `tier` asks for, given the workspace's usable default. Reachability is the router's check. */
export function tierModel(tier: Tier, s: Pick<TierSettings, "light" | "best">, standardModel: string): string {
  if (tier === "standard") return standardModel;
  return (tier === "light" ? s.light : s.best) || autoTierModel(tier, standardModel);
}
