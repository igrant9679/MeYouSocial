"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { applyRecommendation, generateRecommendations } from "@/lib/recommendations";

/**
 * Review-queue actions. EDITOR-level: acting on a recommendation changes how the
 * app behaves, but none of these publish anything or touch brand identity —
 * those are deliberately unreachable from the engine.
 */

const back = (msg: string, ok = false) =>
  redirect(`/insights?${ok ? "ok" : "err"}=${encodeURIComponent(msg.slice(0, 300))}`);

/** Apply the recommendation's action on the user's behalf. */
export async function applyRecommendationAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const { user, workspace } = await requireRole("EDITOR");
  const outcome = await applyRecommendation(workspace.id, id, user.id);
  revalidatePath("/insights");
  back(outcome.message, outcome.ok);
}

/** Mark as accepted — "I'll act on this myself", keeps it out of regeneration. */
export async function acceptRecommendationAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const { user, workspace } = await requireRole("EDITOR");
  const rec = await db.recommendation.findFirst({ where: { id, workspaceId: workspace.id }, select: { id: true, ruleKey: true } });
  if (!rec) back("Recommendation not found.");
  await db.recommendation.update({ where: { id: rec!.id }, data: { status: "accepted" } });
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "recommendation.accepted",
    entityType: "recommendation",
    entityId: rec!.id,
    meta: { ruleKey: rec!.ruleKey },
  });
  revalidatePath("/insights");
  back("Marked as accepted.", true);
}

/**
 * Dismiss with an optional reason. The engine honours a cooldown afterwards, so
 * dismissing actually silences the finding instead of it returning next sweep.
 */
export async function dismissRecommendationAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 300);
  const { user, workspace } = await requireRole("EDITOR");
  const rec = await db.recommendation.findFirst({ where: { id, workspaceId: workspace.id }, select: { id: true, ruleKey: true } });
  if (!rec) back("Recommendation not found.");
  await db.recommendation.update({
    where: { id: rec!.id },
    data: { status: "dismissed", dismissedReason: reason || null },
  });
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "recommendation.dismissed",
    entityType: "recommendation",
    entityId: rec!.id,
    meta: { ruleKey: rec!.ruleKey, reason },
  });
  revalidatePath("/insights");
  back("Dismissed — it won't resurface for two weeks.", true);
}

/** Re-run the rules now instead of waiting for the hourly sweep. */
export async function refreshRecommendationsAction() {
  const { workspace } = await requireRole("EDITOR");
  const created = await generateRecommendations(workspace.id);
  revalidatePath("/insights");
  back(
    created
      ? `${created} new recommendation${created === 1 ? "" : "s"}.`
      : "No new recommendations — nothing in the data met a rule's threshold.",
    true,
  );
}
