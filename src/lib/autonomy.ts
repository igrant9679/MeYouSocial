import { db } from "@/lib/db";
import { getSetting, setWorkspaceSetting } from "@/lib/settings";
import { GOVERNED_FUNCTIONS, writeAudit, type GovernedFunction, type Mode } from "@/lib/governance";

/**
 * Full autonomy: one switch that makes social posting and blog generation run
 * end to end without anyone clicking.
 *
 * ⚠ WHY A SWITCH AND NOT A DIAL. The pieces already existed — function modes,
 * autogen quotas, auto-queue, publishing mode — and the workspace still didn't
 * run on its own, because two links in each chain had no automatic step:
 *   · a blog draft parked at `draft_review` and nothing ever advanced it, so
 *     the publisher (which only takes `final_approval`) never saw it;
 *   · an autogen social post sat as an unscheduled draft, because queueing only
 *     ever happened on the approve ACTION, which nobody was going to press.
 * This flag is what closes both, and `runAutopilotCycle` reads it directly.
 *
 * ⚠ IT IS OPT-IN AND OFF BY DEFAULT, and it must stay that way: with it on,
 * words this app wrote reach a real audience with no human in between. That is
 * a decision an owner makes deliberately, once, not a default they discover
 * after the fact.
 *
 * ⚠ THE TRUTHFULNESS GATES ARE NOT BYPASSED. Auto-advance only moves a post
 * whose required checks already pass, which is the same bar a human advancing
 * it has to clear — unresolved [NEEDS SOURCE] markers, unverified citations, a
 * missing featured image or absent SEO metadata all still stop it, forever if
 * need be. Full autonomy makes the app press the buttons a person would; it
 * does not lower what those buttons check.
 */

export const AUTONOMY_KEY = "autonomy:full";
const RESTORE_KEY = "autonomy:restore";

/** The functions full autonomy drives. Video is deliberately not among them —
 *  a render costs real money per clip and nobody asked for that to be hands-off. */
export const AUTONOMOUS_FUNCTIONS: GovernedFunction[] = ["ideation", "blog_drafting", "social", "publishing"];

export async function isFullyAutonomous(workspaceId: string): Promise<boolean> {
  return (await getSetting(AUTONOMY_KEY, workspaceId).catch(() => "")) === "true";
}

type Snapshot = { modes: Partial<Record<GovernedFunction, Mode>>; autoqueue: string };

/**
 * Turn it on: every function this drives goes to `auto`, and approving a social
 * post queues it.
 *
 * ⚠ The previous settings are SNAPSHOTTED first so switching off restores what
 * the workspace actually had, rather than a guess at a sensible default. A
 * workspace that was deliberately all-manual must come back all-manual.
 */
export async function enableFullAutonomy(workspaceId: string, userId: string): Promise<void> {
  const existing = await db.functionMode.findMany({ where: { workspaceId } });
  const snapshot: Snapshot = {
    modes: Object.fromEntries(existing.map((m) => [m.function, m.mode])) as Snapshot["modes"],
    autoqueue: await getSetting("social:autoqueue", workspaceId).catch(() => ""),
  };
  await setWorkspaceSetting(workspaceId, RESTORE_KEY, JSON.stringify(snapshot));

  for (const fn of AUTONOMOUS_FUNCTIONS) {
    await db.functionMode.upsert({
      where: { workspaceId_function: { workspaceId, function: fn } },
      update: { mode: "auto" },
      create: { workspaceId, function: fn, mode: "auto" },
    });
  }
  await setWorkspaceSetting(workspaceId, "social:autoqueue", "true");
  await setWorkspaceSetting(workspaceId, AUTONOMY_KEY, "true");
  await writeAudit({
    workspaceId, actorId: userId, action: "autonomy.enabled", entityType: "workspace", entityId: workspaceId,
    meta: { functions: AUTONOMOUS_FUNCTIONS, restoredFrom: snapshot },
  });
}

/** Turn it off and put back exactly what was there before. */
export async function disableFullAutonomy(workspaceId: string, userId: string): Promise<void> {
  let snapshot: Snapshot | null = null;
  try {
    const raw = await getSetting(RESTORE_KEY, workspaceId).catch(() => "");
    snapshot = raw ? (JSON.parse(raw) as Snapshot) : null;
  } catch {
    snapshot = null;
  }

  for (const fn of AUTONOMOUS_FUNCTIONS) {
    // No snapshot (an older workspace, or a hand-edited row) means the honest
    // fallback is `manual`: stopping more than asked is safe, and the modes are
    // right there on this page to put back.
    const mode = snapshot?.modes?.[fn] ?? "manual";
    await db.functionMode.upsert({
      where: { workspaceId_function: { workspaceId, function: fn } },
      update: { mode },
      create: { workspaceId, function: fn, mode },
    });
  }
  if (snapshot) await setWorkspaceSetting(workspaceId, "social:autoqueue", snapshot.autoqueue);
  await setWorkspaceSetting(workspaceId, AUTONOMY_KEY, "false");
  await writeAudit({
    workspaceId, actorId: userId, action: "autonomy.disabled", entityType: "workspace", entityId: workspaceId,
    meta: { restored: snapshot ?? "no snapshot — functions set to manual" },
  });
}

/** Everything the switch is currently doing, for the UI to state plainly. */
export async function autonomyStatus(workspaceId: string): Promise<{
  on: boolean;
  modes: Array<{ fn: GovernedFunction; mode: string }>;
  autoqueue: boolean;
  weeklyArticles: string;
  weeklySocial: string;
  requireApproval: boolean;
  /** Weekday name auto-publishing is held to, or "any day". */
  publishDay: string;
}> {
  const rows = await db.functionMode.findMany({ where: { workspaceId } });
  const byFn = new Map(rows.map((r) => [r.function, r.mode]));
  const [on, autoqueue, weeklyArticles, weeklySocial, requireApproval, publishDayRaw] = await Promise.all([
    isFullyAutonomous(workspaceId),
    getSetting("social:autoqueue", workspaceId).catch(() => "").then((v) => v === "true"),
    getSetting("autopilot:weekly_articles", workspaceId).catch(() => "").then((v) => v || "unset"),
    getSetting("social:autogen_weekly", workspaceId).catch(() => "").then((v) => v || "5"),
    getSetting("social:require_approval", workspaceId).catch(() => "").then((v) => v === "true"),
    getSetting("autopilot:publish_day", workspaceId).catch(() => ""),
  ]);
  return {
    on,
    modes: GOVERNED_FUNCTIONS.filter((f) => AUTONOMOUS_FUNCTIONS.includes(f)).map((fn) => ({ fn, mode: byFn.get(fn) ?? "manual" })),
    autoqueue,
    weeklyArticles,
    weeklySocial,
    requireApproval,
    publishDay: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][parseInt(publishDayRaw, 10)] ?? "any day",
  };
}
