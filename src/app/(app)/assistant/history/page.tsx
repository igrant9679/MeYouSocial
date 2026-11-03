import Link from "next/link";
import { History } from "lucide-react";
import { requireRole, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { actorNames } from "@/lib/audit-log";
import { formatZonedMoment } from "@/lib/zoned-dates";
import { displayTimeZone } from "@/lib/display-zone";

// Assistant → Run history (E-ENG-10): every action the assistant took — what,
// with which arguments, whether it worked, for whom, and the conversation it
// came from. Editors see their own; admins see the whole workspace. Read-only
// tools aren't recorded (they change nothing).

const PAGE = 100;

function argSummary(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  return Object.entries(args as Record<string, unknown>)
    .filter(([, v]) => v !== "" && v != null)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v.slice(0, 60) : JSON.stringify(v).slice(0, 60)}`)
    .join(" · ")
    .slice(0, 240);
}

export default async function AssistantHistoryPage({ searchParams }: { searchParams: Promise<{ tool?: string; failed?: string }> }) {
  const { user, workspace, membership } = await requireRole("EDITOR");
  const admin = canAdmin(membership.role);
  const sp = await searchParams;
  // E-SHL-09: the reader's own zone when they chose one — this page only shows times.
  const tz = await displayTimeZone(workspace.id);
  const rows = await db.auditLog.findMany({
    where: { workspaceId: workspace.id, action: "assistant.tool_run", ...(admin ? {} : { actorId: user.id }) },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { id: true, actorId: true, createdAt: true, entityId: true, meta: true },
  });
  const runs = rows.map((r) => {
    let m: { tool?: string; args?: unknown; ok?: boolean; error?: string; threadId?: string | null } = {};
    try { m = JSON.parse(r.meta); } catch { /* an unreadable row still lists */ }
    return { ...r, tool: m.tool ?? "?", args: m.args, ok: m.ok !== false, error: m.error ?? null, threadId: m.threadId ?? r.entityId ?? null };
  }).filter((r) => (!sp.tool || r.tool === sp.tool) && (sp.failed !== "1" || !r.ok)).slice(0, PAGE);
  const names = await actorNames(runs.map((r) => r.actorId ?? ""));
  // A thread link only where it opens — conversations are private to their owner.
  const mine = new Set((await db.assistantThread.findMany({ where: { workspaceId: workspace.id, userId: user.id, id: { in: runs.map((r) => r.threadId).filter((t): t is string => !!t) } }, select: { id: true } })).map((t) => t.id));
  const tools = [...new Set(rows.map((r) => { try { return (JSON.parse(r.meta) as { tool?: string }).tool ?? ""; } catch { return ""; } }).filter(Boolean))].sort();

  return (
    <main className="p-6 w-full max-w-5xl">
      <div className="flex items-center gap-3 mb-4">
        <span className="w-11 h-11 rounded-2xl grid place-items-center" style={{ background: "var(--violet-soft)", color: "var(--violet-on)" }}>
          <History className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-xl leading-tight">Assistant run history</h1>
          <p className="text-xs text-[var(--mute)] m-0">
            Everything the assistant changed {admin ? "in this workspace" : "for you"}, newest first. <Link href="/assistant" className="underline">Back to the assistant</Link>
          </p>
        </div>
      </div>

      <form className="flex flex-wrap items-center gap-2 text-xs mb-3">
        <select name="tool" defaultValue={sp.tool ?? ""} className="border border-[var(--line-2)] rounded-lg px-2 py-1.5">
          <option value="">Every action</option>
          {tools.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="flex items-center gap-1"><input type="checkbox" name="failed" value="1" defaultChecked={sp.failed === "1"} /> only the ones that failed</label>
        <button className="btn sm">Show</button>
      </form>

      {runs.length === 0 ? (
        <p className="text-xs text-[var(--mute)] card">Nothing yet — the assistant hasn&apos;t changed anything{admin ? " here" : " for you"}.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-xs" data-run-history>
            <thead>
              <tr className="text-left text-[var(--mute)]">
                <th className="py-1 pr-2 font-normal">When</th>
                {admin && <th className="py-1 pr-2 font-normal">Who</th>}
                <th className="py-1 pr-2 font-normal">Action</th>
                <th className="py-1 pr-2 font-normal">With</th>
                <th className="py-1 pr-2 font-normal">Result</th>
                <th className="py-1 font-normal">Conversation</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t border-[var(--line)] align-top" data-run={r.tool}>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{formatZonedMoment(r.createdAt, tz)}</td>
                  {admin && <td className="py-1.5 pr-2">{r.actorId ? names.get(r.actorId) ?? "someone who left" : "—"}</td>}
                  <td className="py-1.5 pr-2 font-mono">{r.tool}</td>
                  <td className="py-1.5 pr-2 text-[var(--mute)]">{argSummary(r.args) || "—"}</td>
                  <td className="py-1.5 pr-2" style={{ color: r.ok ? "var(--green-on)" : "var(--rose-on)" }}>{r.ok ? "done" : `failed${r.error ? ` — ${r.error.slice(0, 120)}` : ""}`}</td>
                  <td className="py-1.5">{r.threadId && mine.has(r.threadId) ? <Link href={`/assistant/${r.threadId}`} className="underline">open</Link> : <span className="text-[var(--mute)]">{r.threadId ? "someone else's" : "—"}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
