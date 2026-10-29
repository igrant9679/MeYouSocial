import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { getPostingTimeZone } from "@/lib/social/slots";
import { formatZonedMoment } from "@/lib/zoned-dates";
import { actorNames, auditWhere, csvCell } from "@/lib/audit-log";

// The audit log as CSV (E-SEC-05) — the same filter as the page, newest first,
// at most 10,000 rows. ⚠ A route handler is NOT covered by admin/layout.tsx's
// gate, so it checks the role itself.

export const dynamic = "force-dynamic";
const MAX = 10_000;

export async function GET(req: Request) {
  const { workspace } = await requireRole("ADMIN");
  const q = new URL(req.url).searchParams;
  const f = { who: q.get("who") ?? undefined, action: q.get("action") ?? undefined, entity: q.get("entity") ?? undefined, from: q.get("from") ?? undefined, to: q.get("to") ?? undefined };
  const tz = await getPostingTimeZone(workspace.id).catch(() => "UTC");
  const rows = await db.auditLog.findMany({ where: auditWhere(workspace.id, f, tz), orderBy: { createdAt: "desc" }, take: MAX });
  const names = await actorNames(rows.map((r) => r.actorId ?? ""));
  const lines = [
    ["time_utc", `time_${tz}`, "who", "actor_id", "action", "entity_type", "entity_id", "details"].map(csvCell).join(","),
    ...rows.map((r) => [
      r.createdAt.toISOString(), formatZonedMoment(r.createdAt, tz),
      r.actorId ? names.get(r.actorId) ?? "someone who left" : "the engine", r.actorId ?? "",
      r.action, r.entityType, r.entityId ?? "", r.meta && r.meta !== "{}" ? r.meta : "",
    ].map(csvCell).join(",")),
  ];
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="audit-log-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
