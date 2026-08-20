import Link from "next/link";
import { ArrowLeft, Bot, OctagonPause, Play, Search, SlidersHorizontal } from "lucide-react";
import { requireMembership, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { GOVERNED_FUNCTIONS, FUNCTION_LABELS, MODES, getModes, isGloballyPaused } from "@/lib/governance";
import { SubmitButton } from "@/components/SubmitButton";
import { runAutopilotNowAction, setFunctionModeAction, toggleGlobalPauseAction, saveWeeklyArticleTargetAction, toggleAutoSeoAction, toggleFullAutonomyAction } from "@/app/actions/blog-governance";
import { autonomyStatus } from "@/lib/autonomy";
import { getSetting } from "@/lib/settings";

// The three-mode autonomy dial + kill switch. Admin-writable; visible to all.

const MODE_HELP: Record<(typeof MODES)[number], string> = {
  manual: "Human drives — AI acts only on explicit clicks",
  assisted: "AI runs the work, queues at a human checkpoint",
  auto: "End-to-end unattended (scheduler lands in Phase 3)",
};

type SP = { ok?: string; err?: string };

export default async function AutomationPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { workspace, membership } = await requireMembership();
  const { ok, err } = await searchParams;
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
  const weeklyArticles = await getSetting("autopilot:weekly_articles", workspace.id).catch(() => "");
  // auto_image convention: absent = on, off is the explicit string "false".
  const autoSeo = (await getSetting("blog:auto_seo", workspace.id).catch(() => "")) !== "false";
  const autonomy = await autonomyStatus(workspace.id);

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

      {/* Volume — how much the autopilot writes, independent of HOW attended
          it is (the mode dial below). */}
      <div className="card mb-5 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-48">
          <div className="text-sm font-semibold">Weekly article target</div>
          <div className="text-xs text-[var(--mute)]">
            Caps how many articles the autopilot drafts in any rolling 7 days (each still parks at the
            review checkpoint unless publishing is on auto). Empty = no cap — bounded only by approved
            ideas and the daily AI budget of 20 generations. Auto-generated <b>social posts</b> have
            their own weekly dial on the Social page under Workflow.
          </div>
        </div>
        {admin ? (
          <form action={saveWeeklyArticleTargetAction} className="flex items-center gap-2">
            <input
              type="number" name="weeklyArticles" min={0} max={50}
              defaultValue={weeklyArticles || ""}
              placeholder="∞"
              className="w-20 border border-[var(--line-2)] rounded-lg p-2 text-sm font-mono"
            />
            <SubmitButton className="btn sm" pendingText="Saving…">Save</SubmitButton>
          </form>
        ) : (
          <span className="font-mono text-sm">{weeklyArticles || "no cap"}</span>
        )}
      </div>

      {/* SEO with every draft — the autonomous-mode switch the user asked for.
          The publish gate REQUIRES meta title/description/slug, so OFF means
          every autopilot draft arrives at review with those checks failing
          until someone clicks Generate in the editor. */}
      <div className="card mb-5 flex flex-wrap items-center gap-3">
        <Search className="w-5 h-5" style={{ color: autoSeo ? "var(--green-on)" : "var(--mute)" }} />
        <div className="flex-1 min-w-48">
          <div className="text-sm font-semibold">SEO metadata with every draft {autoSeo ? "— on" : "— off"}</div>
          <div className="text-xs text-[var(--mute)]">
            Each autopilot draft gets its meta title, meta description and URL slug generated with the article
            (the publish checks require all three). Only empty fields are filled — hand-tuned metadata is never
            overwritten. The Generate button in the post editor works either way.
          </div>
        </div>
        {admin ? (
          <form action={toggleAutoSeoAction}>
            <input type="hidden" name="enable" value={autoSeo ? "false" : "true"} />
            <SubmitButton className={autoSeo ? "btn" : "btn primary"} pendingText="Saving…">
              {autoSeo ? "Turn off" : "Turn on"}
            </SubmitButton>
          </form>
        ) : (
          <span className="font-mono text-sm">{autoSeo ? "on" : "off"}</span>
        )}
      </div>

      {ok && <div className="card mb-4" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}><p className="text-xs">{ok}</p></div>}
      {err && <div className="card mb-4" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}><p className="text-xs">{err}</p></div>}

      {/* Full autonomy — the master switch */}
      <div className="card mb-4" style={autonomy.on ? { borderColor: "var(--green-on)" } : undefined}>
        <h2 className="text-sm font-semibold mb-1 flex items-center gap-2">
          Run completely autonomously
          <span
            className="font-mono text-[10px] px-1.5 py-0.5 rounded-full"
            style={{
              background: autonomy.on ? "var(--green-soft)" : "var(--zebra)",
              color: autonomy.on ? "var(--green-on)" : "var(--mute)",
            }}
          >
            {autonomy.on ? "ON" : "off"}
          </span>
        </h2>
        <p className="text-xs text-[var(--mute)] mb-2">
          One switch for the whole loop: ideas are discovered, articles are drafted with their images and SEO,
          social posts are written, both are queued, and articles publish — with nobody clicking.
          {autonomy.on ? " It is running now." : " Off by default."}
        </p>
        <p className="text-xs mb-3">
          <b>What still stops a post:</b> the truthfulness gates. An unresolved <span className="font-mono">[NEEDS SOURCE]</span>,
          an unverified citation, a missing featured image or absent SEO metadata holds an article at review
          indefinitely — this makes the app press the buttons you would, it doesn&apos;t lower what they check.
          {autonomy.requireApproval && (
            <> Social posts here are also held by <b>require approval</b>, so they wait for an admin even with this on —
            turn that off on Social → Settings if you want them to go out unattended.</>
          )}
        </p>
        <div className="rounded-lg bg-[var(--zebra)] px-3 py-2 mb-3">
          <p className="font-mono text-[10px] text-[var(--mute)]">
            {autonomy.modes.map((m) => `${m.fn}=${m.mode}`).join(" · ")} · auto-queue {autonomy.autoqueue ? "on" : "off"} ·{" "}
            {autonomy.weeklyArticles === "unset" ? "articles uncapped" : `${autonomy.weeklyArticles} articles/wk`} ·{" "}
            {autonomy.weeklySocial} social/wk
          </p>
        </div>
        {admin ? (
          <form action={toggleFullAutonomyAction} className="flex flex-wrap items-center gap-2">
            {!autonomy.on && (
              <input
                name="confirm"
                placeholder="Type AUTONOMOUS to confirm"
                className="text-xs"
                aria-label="Type AUTONOMOUS to confirm"
              />
            )}
            <SubmitButton className={autonomy.on ? "btn" : "btn primary"}>
              {autonomy.on ? "Turn full autonomy off" : "Turn full autonomy on"}
            </SubmitButton>
            <span className="text-[10px] text-[var(--mute)]">
              {autonomy.on
                ? "Switching off restores the exact automation settings you had before."
                : "Turning this on sets the four functions below to auto and queues on approval."}
            </span>
          </form>
        ) : (
          <p className="text-xs text-[var(--mute)]">An admin can change this.</p>
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
