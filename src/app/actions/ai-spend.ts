"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, isPlatformOperator } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { BUDGET_KEY, PRICES_KEY, parseBudget, parsePrices, type ModelPrice } from "@/lib/ai-spend";
import { setWorkspaceSetting, invalidateSettingsCache } from "@/lib/settings";
import { MODELS } from "@/lib/llm/models";

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
