"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { tierModelProblem, tierSettings } from "@/lib/llm";
import { isLightOnlyModel, modelLabel } from "@/lib/llm/models";
import { ALLOW_DEEPSEEK_KEY, ELSIE_TIER_KEY, TIERS_ON_KEY, TIER_MODEL_KEY, isTier } from "@/lib/llm/tiers";
import { setWorkspaceSetting } from "@/lib/settings";

/**
 * Settings → Workspace → "A model for each kind of job" (lib/llm/tiers.ts).
 * Admin-only. Nothing is saved unless everything can be: a model with no key is
 * refused in words, and DeepSeek must answer one real call on this workspace's
 * own key before it becomes the Light model (lib/llm/probe.ts).
 */
export async function saveModelTiersAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const field = (name: string) => String(formData.get(name) ?? "").trim().slice(0, 80);
  const on = formData.get("tiers") === "on";
  const allow = formData.get("allowDeepseek") === "on";
  let light = field("light");
  const best = field("best");
  const elsieRaw = field("elsie");
  const elsie = isTier(elsieRaw) ? elsieRaw : "standard";

  const back = (query: string): never => redirect(`/admin/settings?${query}#tiers`);
  const refuse = (why: string): never => back(`flashErr=${encodeURIComponent(`Nothing was saved. ${why}`)}`);

  const current = await tierSettings(workspace.id);
  const notes: string[] = [];
  // Unticking DeepSeek is how an admin stops using it: Light goes back to automatic.
  // (A NEW DeepSeek pick without the tick is refused below, in words — it was never the Light model.)
  if (!allow && current.deepseek && isLightOnlyModel(light) && light === current.light) {
    notes.push(`${modelLabel(light)} is no longer the Light model — Light is automatic again.`);
    light = "";
  }
  const problem =
    (await tierModelProblem("light", light, workspace.id, current.light, allow)) ??
    (await tierModelProblem("best", best, workspace.id, current.best, allow));
  if (problem) refuse(problem);

  // Newly picked, or newly allowed: it has to answer here before it is saved.
  if (isLightOnlyModel(light) && (light !== current.light || !current.deepseek)) {
    const { probeModel } = await import("@/lib/llm/probe");
    const probe = await probeModel(light, workspace.id);
    if (!probe.ok) refuse(`${modelLabel(light)} didn't answer a test call on this workspace's key (${probe.why}), so it wasn't picked.`);
    notes.push(`${modelLabel(light)} answered a test call on this workspace's key.`);
  }

  await setWorkspaceSetting(workspace.id, ALLOW_DEEPSEEK_KEY, allow ? "on" : "");
  await setWorkspaceSetting(workspace.id, TIER_MODEL_KEY.light, light);
  await setWorkspaceSetting(workspace.id, TIER_MODEL_KEY.best, best);
  await setWorkspaceSetting(workspace.id, ELSIE_TIER_KEY, elsie === "standard" ? "" : elsie);
  await setWorkspaceSetting(workspace.id, TIERS_ON_KEY, on ? "on" : "");
  revalidatePath("/admin/settings");
  revalidatePath("/admin/usage");
  const saved = on ? "Saved — each kind of job now uses its tier's model." : "Saved — matching is off, so every job uses the default model.";
  back(`flash=${encodeURIComponent([saved, ...notes].join(" "))}`);
}
