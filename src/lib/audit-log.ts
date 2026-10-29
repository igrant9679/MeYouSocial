import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { zonedTimeToUtc } from "@/lib/social/slots";

/**
 * The audit log, readable (E-SEC-05). The table always existed — every
 * governance act writes to it — and nothing showed it. One filter shape for the
 * page and its CSV export: a person (`who`, or "engine" for rows no person
 * wrote), an action prefix ("social." or "api_key.saved"), an entity type, and
 * whole days in the posting timezone.
 */
export type AuditFilter = { who?: string; action?: string; entity?: string; from?: string; to?: string };

function day(s: string | undefined, tz: string, plus = 0): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s ?? "").trim());
  return m ? zonedTimeToUtc(+m[1], +m[2], +m[3] + plus, 0, 0, tz) : null;
}

export function auditWhere(workspaceId: string, f: AuditFilter, tz: string): Prisma.AuditLogWhereInput {
  const since = day(f.from, tz);
  const until = day(f.to, tz, 1);
  const action = (f.action ?? "").trim().slice(0, 80);
  const entity = (f.entity ?? "").trim().slice(0, 60);
  return {
    workspaceId,
    ...(f.who === "engine" ? { actorId: null } : f.who ? { actorId: f.who } : {}),
    ...(action ? { action: { startsWith: action } } : {}),
    ...(entity ? { entityType: entity } : {}),
    ...(since || until ? { createdAt: { ...(since ? { gte: since } : {}), ...(until ? { lt: until } : {}) } } : {}),
  };
}

/** Names for the people in the rows (anyone who has left keeps their id, labelled). */
export async function actorNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((u) => [u.id, u.name ? `${u.name} <${u.email}>` : u.email]));
}

/** One CSV cell: quoted when it has to be, quotes doubled, and a leading =+-@ defused so a spreadsheet won't run it. */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
