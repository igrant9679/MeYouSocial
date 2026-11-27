"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { requireRole, isPlatformOperator } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { getSetting, setPlatformSetting } from "@/lib/settings";
import { getPublicUrl } from "@/lib/public-url";
import { SIGNUP_KEYS, TRIAL_LIMITS, readCount, readUrl } from "@/lib/trial-policy";
import { TEMPLATE_PARTS } from "@/lib/workspace-template";
import { forgetHold } from "@/lib/workspace-hold";
import { PLAN_ACCESS, readPlans, savePlans, type PlanAccess, type PlanRule } from "@/lib/membership/plans";
import { newSecret, PREVIOUS_SECRET_KEY, ROTATED_AT_KEY, SECRET_KEY, secretFingerprint } from "@/lib/membership/signature";

// Settings → Sign-ups (2026-11-26), the platform operator's: the free trial's terms, the website's
// signing secret, what each meyousocial.com membership gives, and the support levers for one
// trial or held workspace. Nothing here is a workspace admin's — trials run on the platform's keys.

const PAGE = "/admin/signups";

async function requireOperator() {
  const { user } = await requireRole("ADMIN");
  if (!isPlatformOperator(user.email)) redirect("/forbidden?why=operator");
  return user;
}

const back = (msg: string, ok = true, hash = ""): never =>
  redirect(`${PAGE}?${ok ? "flash" : "flashErr"}=${encodeURIComponent(msg)}${hash}`);

export async function saveTrialSettingsAction(formData: FormData) {
  await requireOperator();
  const num = (k: string, max: number) => {
    const raw = String(formData.get(k) ?? "").replace(/[,\s]/g, "");
    return raw === "" ? "" : String(readCount(raw, 0, max));
  };
  const url = String(formData.get("membershipUrl") ?? "").trim();
  if (url && readUrl(url, "") === "") back("The membership page must be an http(s) address.", false, "#trial");
  const templateId = String(formData.get("templateId") ?? "").trim();
  if (templateId && !(await db.workspace.count({ where: { id: templateId, deletedAt: null } }))) back("That template workspace isn't live.", false, "#trial");
  const parts = TEMPLATE_PARTS.filter((p) => formData.get(`part_${p}`) === "on");
  await Promise.all([
    setPlatformSetting(SIGNUP_KEYS.trialDays, num("days", TRIAL_LIMITS.days)),
    setPlatformSetting(SIGNUP_KEYS.tokenCap, num("tokenCap", TRIAL_LIMITS.tokenCap)),
    setPlatformSetting(SIGNUP_KEYS.imageCap, num("imageCap", TRIAL_LIMITS.imageCap)),
    setPlatformSetting(SIGNUP_KEYS.maxOpen, num("maxOpen", TRIAL_LIMITS.maxOpen)),
    setPlatformSetting(SIGNUP_KEYS.membershipUrl, url),
    setPlatformSetting(SIGNUP_KEYS.templateId, templateId),
    setPlatformSetting(SIGNUP_KEYS.templateParts, parts.length === TEMPLATE_PARTS.length ? "" : parts.length ? parts.join(",") : "none"),
  ]);
  forgetHold();
  revalidatePath(PAGE);
  back("Free trial settings saved. New trials use them at once; running trials get the new allowance and keep their end date.", true, "#trial");
}

export type SecretState = { secret?: string; fingerprint?: string; replaced?: boolean; error?: string } | null;

/** Make the website's signing secret — shown once, here. The one it replaces is still accepted for a day. */
export async function makeSigningSecretAction(_prev: SecretState, formData: FormData): Promise<SecretState> {
  await requireOperator();
  const current = await getSetting(SECRET_KEY);
  if (current && formData.get("confirm") !== "on") return { error: "Tick the box first: the website must then switch to the new secret within a day." };
  const secret = newSecret();
  if (current) {
    await setPlatformSetting(PREVIOUS_SECRET_KEY, current);
    await setPlatformSetting(ROTATED_AT_KEY, new Date().toISOString());
  }
  await setPlatformSetting(SECRET_KEY, secret);
  revalidatePath(PAGE);
  return { secret, fingerprint: secretFingerprint(secret), replaced: Boolean(current) };
}

/** Stop accepting the previous secret before its day is up (after a leak, say). */
export async function dropPreviousSecretAction() {
  await requireOperator();
  await setPlatformSetting(PREVIOUS_SECRET_KEY, "");
  await setPlatformSetting(ROTATED_AT_KEY, "");
  revalidatePath(PAGE);
  back("The previous secret no longer works.", true, "#website");
}

export async function savePlanAction(formData: FormData) {
  await requireOperator();
  const id = String(formData.get("id") ?? "").trim();
  if (!/^[\w.:@-]{1,64}$/.test(id)) back("The membership id is the number MemberPress shows for the membership (letters, digits and . _ : @ - only).", false, "#plans");
  const access = (PLAN_ACCESS.includes(String(formData.get("access")) as PlanAccess) ? String(formData.get("access")) : "none") as PlanAccess;
  const rule: PlanRule = { id, label: String(formData.get("label") ?? "").trim().slice(0, 80), access };
  if (access === "join") {
    const workspaceId = String(formData.get("workspaceId") ?? "");
    if (!(await db.workspace.count({ where: { id: workspaceId, deletedAt: null } }))) back("Choose the workspace this membership gives a seat in.", false, "#plans");
    rule.workspaceId = workspaceId;
    const role = String(formData.get("role") ?? "EDITOR");
    rule.role = (["ADMIN", "EDITOR", "VIEWER"].includes(role) ? role : "EDITOR") as Role;
  }
  if (access === "workspace") {
    // The form's one workspace picker: "start from" for an own workspace.
    const templateId = String(formData.get("workspaceId") ?? "");
    rule.templateId = templateId && (await db.workspace.count({ where: { id: templateId, deletedAt: null } })) ? templateId : null;
  }
  const plans = (await readPlans()).filter((p) => p.id !== id);
  await savePlans([...plans, rule]);
  revalidatePath(PAGE);
  back(`Membership ${id}${rule.label ? ` (${rule.label})` : ""} saved. Events that were ignored for it can be processed again below.`, true, "#plans");
}

export async function removePlanAction(formData: FormData) {
  await requireOperator();
  const id = String(formData.get("id") ?? "");
  await savePlans((await readPlans()).filter((p) => p.id !== id));
  revalidatePath(PAGE);
  back(`Membership ${id} no longer gives anything. Access already given stays until the website says the plan ended.`, true, "#plans");
}

export async function reprocessEventAction(formData: FormData) {
  await requireOperator();
  const { reprocessEvent } = await import("@/lib/membership/process");
  const a = await reprocessEvent(String(formData.get("id") ?? ""), await getPublicUrl());
  revalidatePath(PAGE);
  back(`${a.outcome}: ${a.message}`, a.ok, "#events");
}

/** Support levers for one trial or held workspace — each audited in that workspace. */
export async function trialLeverAction(formData: FormData) {
  const user = await requireOperator();
  const id = String(formData.get("workspaceId") ?? "");
  const lever = String(formData.get("lever") ?? "");
  const ws = await db.workspace.findFirst({ where: { id, deletedAt: null }, select: { id: true, name: true, trialEndsAt: true, heldAt: true } });
  if (!ws) return back("That workspace isn't live.", false, "#trials");
  let note = "";
  if (lever === "extend") {
    const from = Math.max(Date.now(), ws.trialEndsAt?.getTime() ?? 0);
    const until = new Date(from + 7 * 86_400_000);
    await db.workspace.update({ where: { id: ws.id }, data: { trialEndsAt: until } });
    note = `${ws.name}'s trial now ends ${until.toISOString().slice(0, 10)}.`;
  } else if (lever === "keep") {
    await db.workspace.update({ where: { id: ws.id }, data: { trialEndsAt: null } });
    note = `${ws.name} is no longer on a trial: no end date, no allowance.`;
  } else if (lever === "lift") {
    await db.workspace.update({ where: { id: ws.id }, data: { heldAt: null, holdReason: null } });
    note = `${ws.name}'s hold is lifted. If the membership is still ended, the next event from the website holds it again.`;
  } else {
    back("Unknown action.", false, "#trials");
  }
  forgetHold(ws.id);
  await writeAudit({ workspaceId: ws.id, actorId: user.id, action: `workspace.trial_${lever}`, entityType: "workspace", entityId: ws.id, meta: { note } });
  revalidatePath(PAGE);
  back(note, true, "#trials");
}
