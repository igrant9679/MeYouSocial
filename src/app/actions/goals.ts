"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { GOAL_LABEL, GOAL_METRICS, isGoalPeriod } from "@/lib/goals";

const MAX_TARGET = 1_000_000_000;

/**
 * Save Measure's goals (E-MEA-05). ADMIN — a target is a decision about what
 * the team is held to. Each metric's field is a whole number (blank removes the
 * goal) with its own week/month; each change is audited with what it was.
 */
export async function saveGoalsAction(formData: FormData) {
  const { user, workspace } = await requireRole("ADMIN");
  const back = (k: "ok" | "err", m: string): never => redirect(`/measure?${k}=${encodeURIComponent(m)}#goals`);
  const existing = new Map((await db.goal.findMany({ where: { workspaceId: workspace.id } })).map((g) => [g.metric, g]));

  const wanted: Array<{ metric: (typeof GOAL_METRICS)[number]; target: number | null; period: "week" | "month" }> = [];
  for (const metric of GOAL_METRICS) {
    const raw = String(formData.get(`target_${metric}`) ?? "").replace(/[,\s]/g, "");
    const period = String(formData.get(`period_${metric}`) ?? "month");
    if (!isGoalPeriod(period)) back("err", `${GOAL_LABEL[metric].name}: choose a week or a month.`);
    if (!raw) { wanted.push({ metric, target: null, period: period as "week" | "month" }); continue; }
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > MAX_TARGET) back("err", `${GOAL_LABEL[metric].name}: a goal is a whole number above zero.`);
    wanted.push({ metric, target: Number(raw), period: period as "week" | "month" });
  }

  let changed = 0;
  for (const w of wanted) {
    const had = existing.get(w.metric);
    if (w.target === null) {
      if (!had) continue;
      await db.goal.delete({ where: { id: had.id } });
      await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "goal.removed", entityType: "goal", entityId: w.metric, meta: { was: { target: had.target, period: had.period } } });
      changed++;
      continue;
    }
    if (had && had.target === w.target && had.period === w.period) continue;
    await db.goal.upsert({
      where: { workspaceId_metric: { workspaceId: workspace.id, metric: w.metric } },
      update: { target: w.target, period: w.period, updatedById: user.id },
      create: { workspaceId: workspace.id, metric: w.metric, target: w.target, period: w.period, updatedById: user.id },
    });
    await writeAudit({
      workspaceId: workspace.id, actorId: user.id, action: "goal.set", entityType: "goal", entityId: w.metric,
      meta: { target: w.target, period: w.period, ...(had ? { was: { target: had.target, period: had.period } } : {}) },
    });
    changed++;
  }
  revalidatePath("/measure");
  back("ok", changed ? `Goals saved (${changed} changed).` : "Nothing changed.");
}
