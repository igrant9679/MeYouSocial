import { db } from "@/lib/db";
import { actorNames } from "@/lib/audit-log";

/**
 * Each key's last change, from the audit log (E-SEC-03): who saved or removed
 * it, when, and its fingerprint (sha256, 10 hex — never the key). Keys saved
 * before 2026-10-28 have no record; the Keys page says so rather than guessing.
 */
export type KeyChange = { action: "saved" | "removed"; at: Date; by: string; fingerprint: string | null };

export async function keyHistory(workspaceId: string): Promise<Map<string, KeyChange>> {
  const rows = await db.auditLog.findMany({
    where: { workspaceId, action: { in: ["api_key.saved", "api_key.removed"] } },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { action: true, entityId: true, actorId: true, createdAt: true, meta: true },
  });
  const names = await actorNames(rows.map((r) => r.actorId ?? ""));
  const out = new Map<string, KeyChange>();
  for (const r of rows) {
    if (!r.entityId || out.has(r.entityId)) continue;
    let fingerprint: string | null = null;
    try { fingerprint = (JSON.parse(r.meta) as { fingerprint?: string }).fingerprint ?? null; } catch { /* none */ }
    out.set(r.entityId, { action: r.action === "api_key.removed" ? "removed" : "saved", at: r.createdAt, by: r.actorId ? names.get(r.actorId) ?? "someone who left" : "the platform", fingerprint });
  }
  return out;
}

export const ROTATION_SETTING = "security:rotation_since";
