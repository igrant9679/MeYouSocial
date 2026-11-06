"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, isPlatformOperator } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { BUDGET_KEY, PRICES_KEY, parseBudget, parsePrices, type ModelPrice } from "@/lib/ai-spend";
import { setWorkspaceSetting, invalidateSettingsCache } from "@/lib/settings";
import { MODELS } from "@/lib/llm/models";
import { VIDEO_BUDGET_KEY, VIDEO_PRICES_KEY, parseSecondsBudget, parseVideoPrices } from "@/lib/video-spend";

const BACK = "/admin/usage";
const done = (q: "ok" | "err", m: string): never => redirect(`${BACK}?${q}=${encodeURIComponent(m)}#ai-budget`);

/**
 * The workspace's monthly token budget (E-ENG-07): an admin's dial. Blank
 * clears it. setWorkspaceSetting records who changed it (dial history).
 */
export async function saveTokenBudgetAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const raw = String(formData.get("budget") ?? "").replace(/[\s,_]/g, "");
  const budget = raw ? parseBudget(raw) : null;
  if (raw && !budget) done("err", "A budget is a whole number of tokens, more than zero — or leave it blank for none.");
  await setWorkspaceSetting(workspace.id, BUDGET_KEY, budget ? String(budget) : "");
  revalidatePath(BACK);
  done("ok", budget ? `Budget set: ${budget.toLocaleString("en-GB")} tokens a month. Admins are told at 80% and 100%.` : "Budget cleared — no warnings.");
}

/**
 * The platform operator's price list (E-ENG-07): USD per million tokens, per
 * model, for the ESTIMATES on Usage. Platform-wide (a global Setting) because
 * it is the operator who knows what the providers charge; never a tenant's
 * dial, never a charge. A model with both fields blank has no price.
 */
export async function saveModelPricesAction(formData: FormData) {
  const { user, workspace } = await requireRole("ADMIN");
  if (!isPlatformOperator(user.email)) done("err", "Only the platform operator sets model prices.");
  const ids = new Set([...MODELS.map((m) => m.id), ...String(formData.get("seen") ?? "").split(",").filter(Boolean)]);
  const prices: Record<string, ModelPrice> = {};
  const bad: string[] = [];
  for (const id of ids) {
    const i = String(formData.get(`in:${id}`) ?? "").trim();
    const o = String(formData.get(`out:${id}`) ?? "").trim();
    if (!i && !o) continue;
    const pi = Number(i), po = Number(o);
    if (!i || !o || !Number.isFinite(pi) || !Number.isFinite(po) || pi < 0 || po < 0 || pi > 10_000 || po > 10_000) { bad.push(id); continue; }
    prices[id] = { in: pi, out: po };
  }
  if (bad.length) done("err", `Give both prices, as dollars per million tokens, for: ${bad.join(", ")}.`);
  const before = parsePrices((await db.setting.findUnique({ where: { key: PRICES_KEY } }))?.value);
  const value = JSON.stringify(prices);
  await db.setting.upsert({ where: { key: PRICES_KEY }, update: { value }, create: { key: PRICES_KEY, value } });
  invalidateSettingsCache();
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "ai.prices_set", entityType: "setting", entityId: PRICES_KEY, meta: { before, after: prices } });
  revalidatePath(BACK);
  done("ok", Object.keys(prices).length ? `Prices saved for ${Object.keys(prices).length} model${Object.keys(prices).length === 1 ? "" : "s"} — every workspace's Usage estimates with them.` : "Prices cleared — Usage shows tokens only.");
}

const videoDone = (q: "ok" | "err", m: string, anchor: string): never => redirect(`${BACK}?${q}=${encodeURIComponent(m)}#${anchor}`);

/**
 * The workspace's monthly video budget, in SECONDS (E-VID-06): an admin's
 * dial. Past it the engine renders nothing unattended; Render now still can,
 * after showing the total. Blank clears it.
 */
export async function saveVideoBudgetAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const raw = String(formData.get("budget") ?? "").replace(/[\s,_]/g, "");
  const budget = raw ? parseSecondsBudget(raw) : null;
  if (raw && !budget) videoDone("err", "A video budget is a whole number of seconds, more than zero — or leave it blank for none.", "video-budget");
  await setWorkspaceSetting(workspace.id, VIDEO_BUDGET_KEY, budget ? String(budget) : "");
  revalidatePath(BACK);
  videoDone("ok", budget ? `Video budget set: ${budget.toLocaleString("en-GB")} seconds a month. Past it the engine waits; Render now asks first.` : "Video budget cleared.", "video-budget");
}

/**
 * The platform operator's price per second of video, per model (E-VID-06):
 * the estimates on every board and the confirm before Render. Platform-wide
 * (a global Setting), never a tenant's dial, never a charge.
 */
export async function saveVideoPricesAction(formData: FormData) {
  const { user, workspace } = await requireRole("ADMIN");
  if (!isPlatformOperator(user.email)) videoDone("err", "Only the platform operator sets video prices.", "video-budget");
  const models = String(formData.get("models") ?? "").split(",").map((s) => s.trim()).filter((s) => /^[\w.-]{3,80}$/.test(s)).slice(0, 20);
  const prices: Record<string, number> = {};
  const bad: string[] = [];
  for (const id of models) {
    const v = String(formData.get(`vp:${id}`) ?? "").trim();
    if (!v) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100) { bad.push(id); continue; }
    prices[id] = n;
  }
  if (bad.length) videoDone("err", `Give a price in dollars per second (0–100) for: ${bad.join(", ")}.`, "video-budget");
  const before = parseVideoPrices((await db.setting.findUnique({ where: { key: VIDEO_PRICES_KEY } }))?.value);
  const value = JSON.stringify(prices);
  await db.setting.upsert({ where: { key: VIDEO_PRICES_KEY }, update: { value }, create: { key: VIDEO_PRICES_KEY, value } });
  invalidateSettingsCache();
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "video.prices_set", entityType: "setting", entityId: VIDEO_PRICES_KEY, meta: { before, after: prices } });
  revalidatePath(BACK);
  videoDone("ok", Object.keys(prices).length ? `Video prices saved for ${Object.keys(prices).length} model${Object.keys(prices).length === 1 ? "" : "s"} — boards estimate with them from now.` : "Video prices cleared — boards show seconds only.", "video-budget");
}
