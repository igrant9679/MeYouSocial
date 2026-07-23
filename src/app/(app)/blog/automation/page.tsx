import Link from "next/link";
import { ArrowLeft, Bot, OctagonPause, Play, SlidersHorizontal } from "lucide-react";
import { requireMembership, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { GOVERNED_FUNCTIONS, FUNCTION_LABELS, MODES, getModes, isGloballyPaused } from "@/lib/governance";
import { SubmitButton } from "@/components/SubmitButton";
import { runAutopilotNowAction, setFunctionModeAction, toggleGlobalPauseAction } from "@/app/actions/blog-governance";

// The three-mode autonomy dial + kill switch. Admin-writable; visible to all.

const MODE_HELP: Record<(typeof MODES)[number], string> = {
  manual: "Human drives — AI acts only on explicit clicks",
  assisted: "AI runs the work, queues at a human checkpoint",
  auto: "End-to-end unattended (scheduler lands in Phase 3)",
};

export default async function AutomationPage() {
  const { workspace, membership } = await requireMembership();
  const admin = canAdmin(membership.role);
  const [modes, paused, recentAudit, lastCycle] = await Promise.all([
    getModes(workspace.id),
    isGloballyPaused(workspace.id),
    db.auditLog.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.auditLog.findFirst({
      where: { workspaceId: workspace.id, action: { in: ["autopilot.cycle", "autopilot.manual_run"] } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const intervalMin = Math.max(5, parseInt(process.env.AUTOPILOT_INTERVAL_MIN ?? "30", 10) || 30);
  const autopilotOff = process.env.AUTOPILOT === "off";

  return (
    <main className="p-6 w-full">
      <Link href="/blog" className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Blog
      </Link>
      <div className="flex items-center gap-3 mb-5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--violet-soft)", color: "var(--violet-on)" }}>
          <SlidersHorizontal className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-2xl leading-tight">Automation</h1>
          <p className="text-xs text-[var(--mute)]">
            Every major function runs in one of three modes. The global pause overrides everything.
          </p>
        </div>
      </div>

      {/* Kill switch */}
      <div
        className="card mb-5 flex flex-wrap items-center gap-3"
        style={paused ? { background: "var(--rose-soft)" } : undefined}
      >
        <OctagonPause className="w-5 h-5" style={{ color: paused ? "var(--rose-on)" : "var(--mute)" }} />
        <div className="flex-1 min-w-48">
          <div className="text-sm font-semibold" style={paused ? { color: "var(--rose-on)" } : undefined}>
            Global pause {paused ? "— ON: all AI generation is halted" : "— off"}
          </div>
          <div className="text-xs text-[var(--mute)]">
            The emergency brake: blocks every AI action (manual clicks included) across this workspace.
          </div>
        </div>
        {admin && (
          <form action={toggleGlobalPauseAction}>
            <button className={paused ? "btn primary" : "btn"}>
              {paused ? <><Play className="w-4 h-4" /> Resume automation</> : <><OctagonPause className="w-4 h-4" /> Pause everything</>}
            </button>
          </form>
        )}
      </div>

      {/* Autopilot scheduler status */}
      <div className="card mb-5 flex flex-wrap items-center gap-3">
        <Bot className="w-5 h-5" style={{ color: autopilotOff ? "var(--mute)" : "var(--teal-on)" }} />
        <div className="flex-1 min-w-48">
          <div className="text-sm font-semibold">
            Autopilot {autopilotOff ? "— disabled (AUTOPILOT=off)" : `— sweeps every ${intervalMin} min`}
          </div>
          <div className="text-xs text-[var(--mute)]">
            {lastCycle
              ? `Last activity ${lastCycle.createdAt.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}: ${lastCycle.meta}`
              : "No autopilot activity yet — it acts only when a function is in assisted or auto mode and there is due work."}
          </div>
        </div>
        {admin && !autopilotOff && (
          <form action={runAutopilotNowAction}>
            <SubmitButton className="btn" pendingText="Running cycle…">Run cycle now</SubmitButton>
          </form>
        )}
      </div>

      {/* Mode dial */}
      <div className="card">
        <h2 className="text-sm font-semibold mb-1">Function modes</h2>
        <p className="text-xs text-[var(--mute)] mb-3">
          manual — {MODE_HELP.manual} · assisted — {MODE_HELP.assisted} · auto — {MODE_HELP.auto}
        </p>
        <ul className="flex flex-col">
          {GOVERNED_FUNCTIONS.map((fn) => (
            <li key={fn} className="flex flex-wrap items-center gap-2 py-2 border-b border-[var(--line)] last:border-0">
              <span className="text-sm flex-1 min-w-40">{FUNCTION_LABELS[fn]}</span>
              {MODES.map((m) => {
                const active = modes[fn] === m;
                return admin ? (
                  <form key={m} action={setFunctionModeAction}>
                    <input type="hidden" name="function" value={fn} />
                    <input type="hidden" name="mode" value={m} />
                    <button
                      className="font-mono text-xs px-2.5 py-1 rounded-full border"
                      style={
                        active
                          ? { background: "var(--accent-soft)", color: "var(--accent-on)", borderColor: "var(--accent-on)" }
                          : { background: "var(--panel)", color: "var(--mute)", borderColor: "var(--line)" }
                      }
                      title={MODE_HELP[m]}
                    >
                      {m}
                    </button>
                  </form>
                ) : (
                  <span
                    key={m}
                    className="font-mono text-xs px-2.5 py-1 rounded-full border"
                    style={
                      active
                        ? { background: "var(--accent-soft)", color: "var(--accent-on)", borderColor: "var(--accent-on)" }
                        : { background: "var(--panel)", color: "var(--mute)", borderColor: "var(--line)" }
                    }
                  >
                    {m}
                  </span>
                );
              })}
            </li>
          ))}
        </ul>
      </div>

      {/* Audit trail */}
      <div className="card mt-5">
        <h2 className="text-sm font-semibold mb-2">Recent activity (audit log)</h2>
        {recentAudit.length === 0 ? (
          <p className="text-xs text-[var(--mute)]">Actions will appear here as they happen.</p>
        ) : (
          <ul className="text-xs flex flex-col gap-1">
            {recentAudit.map((a) => (
              <li key={a.id} className="flex gap-2">
                <span className="font-mono text-[var(--mute)] shrink-0">
                  {a.createdAt.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="font-mono">{a.action}</span>
                <span className="text-[var(--mute)] truncate">{a.entityType}{a.actorId ? "" : " · system"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
