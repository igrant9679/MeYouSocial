import { db } from "@/lib/db";

/**
 * Who caused an article version (E-ART-03). A row with an actor names that
 * person. A row without one is the engine (a generation it ran) or
 * auto-review (a finding applied with nobody) — but only from the day the
 * actor began to be recorded: older rows say "not recorded" rather than
 * guess, since a person's save then looked the same as the engine's.
 */

let recordedFrom: Promise<Date | null> | null = null;

/** When the actor column arrived — the migration's finish time; null where there's no migration table (all rows recorded). */
export function actorRecordedFrom(): Promise<Date | null> {
  recordedFrom ??= db.$queryRaw<Array<{ finished_at: Date | null }>>`SELECT finished_at FROM _prisma_migrations WHERE migration_name = '20261101190000_version_actor' LIMIT 1`
    .then((r) => r[0]?.finished_at ?? null)
    .catch(() => null);
  return recordedFrom;
}

export function versionActor(v: { label: string; actorId: string | null; createdAt: Date }, names: Map<string, string>, since: Date | null): string {
  if (v.actorId) return names.get(v.actorId) ?? "a former member";
  if (since && v.createdAt < since) return "not recorded";
  return v.label.startsWith("before finding") ? "auto-review" : "the engine";
}
