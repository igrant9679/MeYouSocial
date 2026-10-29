import Link from "next/link";
import { ScrollText, Download } from "lucide-react";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { getPostingTimeZone } from "@/lib/social/slots";
import { formatZonedMoment } from "@/lib/zoned-dates";
import { actorNames, auditWhere, type AuditFilter } from "@/lib/audit-log";
import { EmptyState } from "@/components/EmptyState";
import { daysAgo } from "@/lib/request-time";

// Settings → Audit log (E-SEC-05): who did what, when — every governance act
// the app records, filterable by person, action, entity and day, with a CSV of
// whatever the filter shows. The table always existed; nothing showed it.
// Admin-only by the admin layout; the export route checks for itself.

const PAGE = 50;
const sel = "border border-[var(--line-2)] rounded-lg px-2 py-1.5 text-xs";

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<AuditFilter & { page?: string }> }) {
  const { workspace } = await requireRole("ADMIN");
  const sp = await searchParams;
  const tz = await getPostingTimeZone(workspace.id).catch(() => "UTC");
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const where = auditWhere(workspace.id, sp, tz);
  const since90 = daysAgo(90);
  const [rows, total, members, actions, entities, perPerson] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    db.auditLog.count({ where }),
    db.membership.findMany({ where: { workspaceId: workspace.id }, select: { userId: true, role: true, status: true, user: { select: { name: true, email: true } } }, orderBy: { createdAt: "asc" } }),
    db.auditLog.groupBy({ by: ["action"], where: { workspaceId: workspace.id, createdAt: { gte: since90 } }, _count: { _all: true }, orderBy: { _count: { action: "desc" } }, take: 80 }),
    db.auditLog.groupBy({ by: ["entityType"], where: { workspaceId: workspace.id, createdAt: { gte: since90 } }, _count: { _all: true }, orderBy: { _count: { entityType: "desc" } }, take: 40 }),
    // One person's activity at a glance, when one is chosen.
    sp.who
      ? db.auditLog.groupBy({ by: ["action"], where: { ...where }, _count: { _all: true }, orderBy: { _count: { action: "desc" } }, take: 12 })
      : Promise.resolve([] as Array<{ action: string; _count: { _all: number } }>),
  ]);
  const names = await actorNames(rows.map((r) => r.actorId ?? ""));
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const qs = new URLSearchParams();
  for (const k of ["who", "action", "entity", "from", "to"] as const) if (sp[k]) qs.set(k, sp[k]!);
  const pageHref = (p: number) => { const q = new URLSearchParams(qs); if (p > 1) q.set("page", String(p)); return `/admin/audit-log${q.toString() ? `?${q}` : ""}`; };
  const filtered = qs.toString().length > 0;
  const chosen = members.find((m) => m.userId === sp.who);

  return (
    <main className="w-full">
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <span className="w-11 h-11 rounded-2xl grid place-items-center" style={{ background: "var(--slate-soft, var(--zebra))", color: "var(--ink)" }}>
          <ScrollText className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div className="flex-1 min-w-56">
          <h1 className="font-mono font-bold text-xl leading-tight">Audit log</h1>
          <p className="text-xs text-[var(--mute)] m-0">Who did what in {workspace.name}, and when — times in {tz}. &ldquo;The engine&rdquo; is work no person started.</p>
        </div>
        <a href={`/admin/audit-log/export${qs.toString() ? `?${qs}` : ""}`} className="btn sm"><Download className="w-3.5 h-3.5" /> CSV of this view</a>
      </div>

      <form method="get" action="/admin/audit-log" className="card mb-3 flex flex-wrap items-center gap-2 text-xs">
        <select name="who" defaultValue={sp.who ?? ""} aria-label="Person" className={sel}>
          <option value="">Everyone</option>
          <option value="engine">The engine (no person)</option>
          {members.map((m) => <option key={m.userId} value={m.userId}>{m.user.name ?? m.user.email} · {m.role.toLowerCase()}{m.status !== "active" ? " (removed)" : ""}</option>)}
        </select>
        <select name="action" defaultValue={sp.action ?? ""} aria-label="Action" className={sel}>
          <option value="">Every action</option>
          {[...new Set(actions.map((a) => a.action.split(".")[0]))].map((g) => <option key={`${g}.`} value={`${g}.`}>{g}.* (any)</option>)}
          {actions.map((a) => <option key={a.action} value={a.action}>{a.action} · {a._count._all}</option>)}
        </select>
        <select name="entity" defaultValue={sp.entity ?? ""} aria-label="Entity" className={sel}>
          <option value="">Every kind of thing</option>
          {entities.map((e) => <option key={e.entityType} value={e.entityType}>{e.entityType}</option>)}
        </select>
        <label className="inline-flex items-center gap-1">From <input type="date" name="from" defaultValue={sp.from ?? ""} className={sel} /></label>
        <label className="inline-flex items-center gap-1">to <input type="date" name="to" defaultValue={sp.to ?? ""} className={sel} /></label>
        <button className="btn sm primary">Show</button>
        {filtered && <Link href="/admin/audit-log" className="btn sm">Clear</Link>}
        <span className="text-[var(--mute)]">{total.toLocaleString()} record{total === 1 ? "" : "s"}</span>
      </form>

      {sp.who && perPerson.length > 0 && (
        <div className="card mb-3 text-xs">
          <b>{sp.who === "engine" ? "The engine" : chosen ? chosen.user.name ?? chosen.user.email : "This person"}</b>
          <span className="text-[var(--mute)]"> — most frequent, in this view: </span>
          {perPerson.map((a, i) => <span key={a.action}>{i ? " · " : ""}<span className="font-mono">{a.action}</span> {a._count._all}</span>)}
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState line={filtered ? "Nothing matches these filters." : "Nothing has been recorded yet."} action={filtered ? { label: "Clear the filters", href: "/admin/audit-log" } : null} />
      ) : (
        <div className="card !p-0 overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-[var(--mute)]">
                {["When", "Who", "Action", "On", "Details"].map((h) => <th key={h} className="py-2 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)]">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const meta = r.meta && r.meta !== "{}" ? r.meta : "";
                return (
                  <tr key={r.id} className="align-top border-b border-[var(--line)] last:border-0">
                    <td className="py-1.5 px-2 whitespace-nowrap font-mono text-[10px]">{formatZonedMoment(r.createdAt, tz)}</td>
                    <td className="py-1.5 px-2">{r.actorId ? names.get(r.actorId) ?? <span className="text-[var(--mute)]">someone who left ({r.actorId.slice(0, 8)}…)</span> : <span className="text-[var(--mute)]">the engine</span>}</td>
                    <td className="py-1.5 px-2 font-mono whitespace-nowrap">{r.action}</td>
                    <td className="py-1.5 px-2 whitespace-nowrap">{r.entityType}{r.entityId ? <span className="text-[var(--mute)] font-mono"> {r.entityId.slice(0, 14)}</span> : null}</td>
                    <td className="py-1.5 px-2 max-w-md"><span className="font-mono text-[10px] text-[var(--mute)] break-all" title={meta}>{meta.length > 160 ? `${meta.slice(0, 160)}…` : meta}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center gap-2 mt-3 text-xs">
          {page > 1 && <Link href={pageHref(page - 1)} className="btn sm">← Newer</Link>}
          <span className="text-[var(--mute)]">Page {page} of {pages}</span>
          {page < pages && <Link href={pageHref(page + 1)} className="btn sm">Older →</Link>}
        </div>
      )}
    </main>
  );
}
