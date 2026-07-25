import { db } from "@/lib/db";
import { collectWorkspaceMetrics } from "@/lib/metrics";
import { writeAudit, isGloballyPaused } from "@/lib/governance";
import { RULES, AUTO_APPLICABLE, type RuleContext, type RuleResult } from "@/lib/recommendations/rules";

/**
 * The recommendation engine: deterministic rules over the metrics spine.
 *
 * Generation is idempotent by `fingerprint`. Re-running produces no duplicates,
 * and a dismissed finding stays quiet for a cooldown rather than reappearing on
 * the next sweep — otherwise "dismiss" would be meaningless.
 *
 * Applying is separate from generating, and gated twice: an action must be on
 * the AUTO_APPLICABLE allow-list AND the governing function must be in `auto`.
 * Anything else waits for a human.
 */

const DISMISS_COOLDOWN_DAYS = 14;

/** Which mode dial governs which action. Unlisted actions never auto-apply. */
const ACTION_FUNCTION: Record<string, string> = {
  "topic.raise_priority": "ideation",
};

async function buildContext(workspaceId: string): Promise<RuleContext> {
  const metrics = await collectWorkspaceMetrics(workspaceId);
  // Search vendors are plain settings, not entries in the typed key provider
  // union, so read them directly rather than casting around getApiKey.
  const { getSetting } = await import("@/lib/settings");
  const [tavily, serper] = await Promise.all([
    getSetting("api_key:tavily", workspaceId).catch(() => ""),
    getSetting("api_key:serper", workspaceId).catch(() => ""),
  ]);
  const hasAnalytics = metrics.metrics.some((m) => (m.source === "gsc" || m.source === "ga4") && m.value !== null);
  return {
    workspaceId,
    metrics,
    byKey: new Map(metrics.metrics.map((m) => [m.key, m])),
    topics: metrics.topics,
    hasSearchKey: Boolean(tavily || serper),
    hasAnalytics,
  };
}

/**
 * Evaluate every rule and persist what's new. Returns the number created.
 * Rules that don't fire are silence, not an entry — thin data must not generate
 * confident noise.
 */
export async function generateRecommendations(workspaceId: string): Promise<number> {
  if (await isGloballyPaused(workspaceId)) return 0;
  const ctx = await buildContext(workspaceId);

  // Keep each result paired with the rule that produced it — the rule key is
  // recorded on the row and must not be re-derived from the fingerprint.
  const results: Array<{ ruleKey: string; result: RuleResult }> = [];
  for (const rule of RULES) {
    try {
      const r = rule.evaluate(ctx);
      if (r) results.push({ ruleKey: rule.key, result: r });
    } catch (e) {
      console.error(`[recommendations] rule ${rule.key} failed:`, e instanceof Error ? e.message : e);
    }
  }
  if (!results.length) return 0;

  const cooldownSince = new Date(Date.now() - DISMISS_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
  let created = 0;

  for (const { ruleKey, result: r } of results) {
    // Suppress if the same finding is already open/accepted, was applied, or was
    // dismissed recently. Only a stale dismissal lets it surface again.
    const existing = await db.recommendation.findFirst({
      where: {
        workspaceId,
        fingerprint: r.fingerprint,
        OR: [
          { status: { in: ["open", "accepted", "applied"] } },
          { status: "dismissed", updatedAt: { gte: cooldownSince } },
        ],
      },
      select: { id: true },
    });
    if (existing) continue;

    await db.recommendation.create({
      data: {
        workspaceId,
        ruleKey,
        fingerprint: r.fingerprint,
        title: r.title,
        detail: r.detail,
        rationale: r.rationale,
        severity: r.severity,
        confidence: r.confidence,
        evidence: JSON.stringify(r.evidence),
        actionKey: r.action?.key ?? null,
        actionPayload: r.action ? JSON.stringify(r.action.payload) : null,
        actionLabel: r.action?.label ?? null,
      },
    });
    created++;
  }

  if (created) {
    await writeAudit({
      workspaceId,
      action: "recommendation.generated",
      entityType: "recommendation",
      meta: { created },
    });
  }
  return created;
}

// ── Applying ─────────────────────────────────────────────────────────────────

export type ApplyOutcome = { ok: boolean; message: string };

/**
 * Perform the action a recommendation carries. Pure side-effect layer — the
 * decision to call this is made by the caller (a human clicking Apply, or the
 * auto sweep after its allow-list + mode checks).
 */
async function performAction(workspaceId: string, actionKey: string, payload: Record<string, unknown>): Promise<ApplyOutcome> {
  switch (actionKey) {
    case "topic.raise_priority": {
      const topicId = String(payload.topicId ?? "");
      const priority = Number(payload.priority ?? 10);
      if (!topicId) return { ok: false, message: "No topic in the payload." };
      // Re-scope to the workspace: never trust a stored id blindly.
      const topic = await db.topic.findFirst({ where: { id: topicId, workspaceId }, select: { id: true, name: true } });
      if (!topic) return { ok: false, message: "That topic no longer exists." };
      await db.topic.update({ where: { id: topic.id }, data: { priority } });
      return { ok: true, message: `Raised discovery priority for “${topic.name}”. Reset it to 0 in Brand to undo.` };
    }
    default:
      return { ok: false, message: `Unknown action “${actionKey}”.` };
  }
}

/** Apply a recommendation on a human's behalf. */
export async function applyRecommendation(workspaceId: string, id: string, actorId: string): Promise<ApplyOutcome> {
  const rec = await db.recommendation.findFirst({ where: { id, workspaceId } });
  if (!rec) return { ok: false, message: "Recommendation not found." };
  if (!rec.actionKey) return { ok: false, message: "This recommendation is advisory — there's nothing to apply automatically." };
  if (rec.status === "applied") return { ok: false, message: "Already applied." };

  const payload = (() => {
    try {
      return JSON.parse(rec.actionPayload ?? "{}") as Record<string, unknown>;
    } catch {
      return {};
    }
  })();

  const outcome = await performAction(workspaceId, rec.actionKey, payload);
  if (!outcome.ok) return outcome;

  await db.recommendation.update({
    where: { id: rec.id },
    data: { status: "applied", appliedAt: new Date(), appliedBy: actorId },
  });
  await writeAudit({
    workspaceId,
    actorId,
    action: "recommendation.applied",
    entityType: "recommendation",
    entityId: rec.id,
    meta: { ruleKey: rec.ruleKey, actionKey: rec.actionKey, auto: actorId === "auto" },
  });
  return outcome;
}

/**
 * Auto-apply pass. Two gates, both required:
 *   1. the action is on the AUTO_APPLICABLE allow-list, and
 *   2. the function that governs it is set to `auto` for this workspace.
 * Everything else stays in the queue for a human. Publishing and brand identity
 * are deliberately not reachable from here at all.
 */
export async function autoApplyRecommendations(workspaceId: string): Promise<number> {
  if (await isGloballyPaused(workspaceId)) return 0;
  const open = await db.recommendation.findMany({
    where: { workspaceId, status: "open", actionKey: { not: null } },
    select: { id: true, actionKey: true },
  });
  if (!open.length) return 0;

  const modes = await db.functionMode.findMany({ where: { workspaceId }, select: { function: true, mode: true } });
  const modeOf = new Map(modes.map((m) => [m.function, m.mode]));

  let applied = 0;
  for (const rec of open) {
    const key = rec.actionKey!;
    if (!AUTO_APPLICABLE.has(key)) continue;
    const fn = ACTION_FUNCTION[key];
    if (!fn || modeOf.get(fn) !== "auto") continue;
    const outcome = await applyRecommendation(workspaceId, rec.id, "auto");
    if (outcome.ok) applied++;
  }
  return applied;
}

/** Generation + auto-apply for every workspace. Called by the scheduler. */
export async function sweepRecommendations(): Promise<{ created: number; applied: number }> {
  const workspaces = await db.workspace.findMany({ select: { id: true } });
  let created = 0;
  let applied = 0;
  for (const w of workspaces) {
    try {
      created += await generateRecommendations(w.id);
      applied += await autoApplyRecommendations(w.id);
    } catch (e) {
      console.error(`[recommendations] sweep failed for ${w.id}:`, e instanceof Error ? e.message : e);
    }
  }
  return { created, applied };
}

// ── Reads ────────────────────────────────────────────────────────────────────

export type StoredEvidence = { key: string; label: string; value: number | null; sample: number; evidence: string };

export function parseEvidence(json: string): StoredEvidence[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as StoredEvidence[]) : [];
  } catch {
    return [];
  }
}

export async function openRecommendations(workspaceId: string, limit = 20) {
  return db.recommendation.findMany({
    where: { workspaceId, status: { in: ["open", "accepted"] } },
    orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
    take: limit,
  });
}

export async function recentlyResolved(workspaceId: string, limit = 5) {
  return db.recommendation.findMany({
    where: { workspaceId, status: { in: ["applied", "dismissed"] } },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
}
