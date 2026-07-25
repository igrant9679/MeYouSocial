import { db } from "@/lib/db";
import { collectWorkspaceMetrics, type Metric } from "@/lib/metrics";

/**
 * Daily rollup: freeze today's metric values into MetricSnapshot.
 *
 * Idempotent per (workspace, day, metric) — re-running the same day updates in
 * place rather than duplicating, so a restart or a manual run is harmless.
 *
 * Why snapshot at all when most metrics recompute live: point-in-time values
 * (open WIP, stall counts) are destroyed by the passage of time, and trend
 * detection later needs a real history rather than a reconstruction.
 */

/** UTC midnight for the given instant — the day key. */
function dayKey(now = new Date()): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function rollupWorkspaceMetrics(workspaceId: string, now = new Date()): Promise<number> {
  const day = dayKey(now);
  const { metrics } = await collectWorkspaceMetrics(workspaceId);
  let written = 0;

  for (const m of metrics as Metric[]) {
    // A null value is still recorded: "we looked and there was no data" is a
    // fact worth keeping, and it stops a later gap being read as a drop to zero.
    await db.metricSnapshot.upsert({
      where: { workspaceId_day_key: { workspaceId, day, key: m.key } },
      create: {
        workspaceId,
        day,
        key: m.key,
        value: m.value,
        sample: m.sample,
        confidence: m.confidence,
        source: m.source,
      },
      update: { value: m.value, sample: m.sample, confidence: m.confidence, source: m.source },
    });
    written++;
  }
  return written;
}

/** Roll up every workspace. Called by the scheduler; safe to run repeatedly. */
export async function rollupAllWorkspaces(): Promise<{ workspaces: number; rows: number }> {
  const workspaces = await db.workspace.findMany({ select: { id: true } });
  let rows = 0;
  for (const w of workspaces) {
    try {
      rows += await rollupWorkspaceMetrics(w.id);
    } catch (e) {
      // One bad workspace must not stop the rest.
      console.error(`[metrics] rollup failed for ${w.id}:`, e instanceof Error ? e.message : e);
    }
  }
  return { workspaces: workspaces.length, rows };
}

export type TrendPoint = { day: string; value: number | null; sample: number };

/** Historical series for one metric — the input to "is this getting better?". */
export async function metricHistory(workspaceId: string, key: string, days = 30): Promise<TrendPoint[]> {
  const since = dayKey(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
  const rows = await db.metricSnapshot.findMany({
    where: { workspaceId, key, day: { gte: since } },
    orderBy: { day: "asc" },
    select: { day: true, value: true, sample: true },
  });
  return rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), value: r.value, sample: r.sample }));
}
