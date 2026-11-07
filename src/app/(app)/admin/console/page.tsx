import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole, isPlatformOperator } from "@/lib/acl";
import { operatorConsole, type Health } from "@/lib/operator-console";
import { formatZonedMoment } from "@/lib/zoned-dates";
import { displayTimeZone } from "@/lib/display-zone";

// Settings → Workspaces → Console (E-SHL-15): the operator's view of every
// tenant at once — needs-you, engine, analytics, website, what's missing and
// whose keys, what's failing, last activity. Read-only; every cell is a stored
// status, so opening it never calls a provider.

const DOT: Record<Health, string> = { ok: "var(--green)", warn: "var(--amber)", bad: "var(--rose)", none: "var(--line-2)" };
const th = "py-1.5 px-2 font-mono text-micro uppercase tracking-wider border-b-2 border-[var(--line)] text-left";
// Below md each workspace is a card of label: value rows — `data-label` names each cell.
const td = "py-1.5 px-2 border-b border-[var(--line)] align-top max-md:flex max-md:justify-between max-md:gap-3 max-md:py-1 max-md:px-0 max-md:border-0 max-md:text-right max-md:before:content-[attr(data-label)] max-md:before:text-[var(--mute)] max-md:before:text-left max-md:before:font-mono max-md:before:text-micro max-md:before:uppercase";

function Status({ h, line }: { h: Health; line: string }) {
  return (
    <span className="inline-flex items-start gap-1.5 text-left">
      <span className="w-2 h-2 rounded-full shrink-0 mt-1" style={{ background: DOT[h] }} aria-hidden />
      <span className={h === "none" ? "text-[var(--mute)]" : ""} data-health={h}>{line}</span>
    </span>
  );
}

export default async function OperatorConsolePage() {
  const { user, workspace } = await requireRole("ADMIN");
  if (!isPlatformOperator(user.email)) redirect("/forbidden?why=operator");
  const [rows, tz] = await Promise.all([operatorConsole(), displayTimeZone(workspace.id)]);
  const attention = rows.filter((r) => r.needsYou > 0 || r.engine.health === "bad" || r.analytics.health === "bad" || r.website.health === "bad" || r.missing.length || r.failing.length).length;

  return (
    <div>
      <h1 className="font-mono font-bold text-xl mb-1">Operator console</h1>
      <p className="text-xs text-[var(--mute)] mb-3">
        {rows.length} workspace{rows.length === 1 ? "" : "s"} · {attention}{" "}with something to look at. Every cell is a stored status — the engine&apos;s
        last check-in, the last analytics sync, the last website probe, account states — so this page calls no provider.{" "}
        <Link href="/admin/workspaces" className="underline">Members and roles →</Link>
      </p>
      <div className="card overflow-x-auto" data-console>
        <table className="w-full text-xs border-collapse max-md:block">
          <thead className="max-md:hidden">
            <tr>
              <th className={th}>Workspace</th><th className={th}>Needs a person</th><th className={th}>Engine</th><th className={th}>Analytics</th>
              <th className={th}>Website</th><th className={th}>Not connected</th><th className={th}>Whose keys</th><th className={th}>Failing</th><th className={th}>Last activity</th>
            </tr>
          </thead>
          <tbody className="max-md:block">
            {rows.map((r) => (
              <tr key={r.id} className="max-md:block max-md:border-b max-md:border-[var(--line)] max-md:py-2" data-console-row={r.id}>
                <td className={td} data-label="Workspace"><b>{r.name}</b> <span className="text-[var(--mute)]">· {r.members} member{r.members === 1 ? "" : "s"}, {r.admins} admin{r.admins === 1 ? "" : "s"}</span></td>
                <td className={td} data-label="Needs a person" data-cell="needs">{r.needsYou ? <b style={{ color: "var(--amber-on)" }}>{r.needsYou}</b> : <span className="text-[var(--mute)]">0</span>}</td>
                <td className={td} data-label="Engine" data-cell="engine"><Status h={r.engine.health} line={r.engine.line} /></td>
                <td className={td} data-label="Analytics" data-cell="analytics"><Status h={r.analytics.health} line={r.analytics.line} /></td>
                <td className={td} data-label="Website" data-cell="website"><Status h={r.website.health} line={r.website.line} /></td>
                <td className={td} data-label="Not connected" data-cell="missing">{r.missing.length ? <span style={{ color: "var(--rose-on)" }}>{r.missing.join(", ")}</span> : <span className="text-[var(--mute)]">nothing needed</span>}</td>
                <td className={td} data-label="Whose keys" data-cell="keys">
                  {r.keys.own.length + r.keys.platform.length + r.keys.env.length === 0 ? <span className="text-[var(--mute)]">—</span> : (
                    <span className="flex flex-col gap-0.5">
                      {r.keys.own.length > 0 && <span>own: {r.keys.own.join(", ")}</span>}
                      {r.keys.platform.length > 0 && <span>platform: {r.keys.platform.join(", ")}</span>}
                      {r.keys.env.length > 0 && <span>server: {r.keys.env.join(", ")}</span>}
                    </span>
                  )}
                </td>
                <td className={td} data-label="Failing" data-cell="failing">{r.failing.length ? <span className="flex flex-col gap-0.5" style={{ color: "var(--rose-on)" }}>{r.failing.slice(0, 4).map((f) => <span key={f}>{f}</span>)}{r.failing.length > 4 && <span>and {r.failing.length - 4} more</span>}</span> : <span className="text-[var(--mute)]">—</span>}</td>
                <td className={td} data-label="Last activity" data-cell="activity">{r.lastActivity ? formatZonedMoment(r.lastActivity, tz) : <span className="text-[var(--mute)]">nobody yet</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
