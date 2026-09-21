import Link from "next/link";
import { Bot, OctagonPause, Play, Search, Sparkles } from "lucide-react";
import { requireMembership, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { GOVERNED_FUNCTIONS, FUNCTION_LABELS, MODES, getModes, isGloballyPaused } from "@/lib/governance";
import { SubmitButton } from "@/components/SubmitButton";
import { Banner } from "@/components/SocialPostCard";
import { runAutopilotNowAction, setFunctionModeAction, toggleGlobalPauseAction, saveWeeklyArticleTargetAction, toggleAutoSeoAction, toggleFullAutonomyAction } from "@/app/actions/blog-governance";
import { saveSocialWorkflowSettingsAction } from "@/app/actions/social-workflow";
import { autonomyStatus } from "@/lib/autonomy";
import { getSetting } from "@/lib/settings";
import { formatInZone, getQueue } from "@/lib/social/slots";

// Settings → Automation: what runs by itself. The master switch, the global
// pause, the function modes, the article cadence and publish day, SEO and
// images on drafts, and the social auto-dials — every dial the autopilot
// reads, on one page. (Was Blog → Automation + the workflow half of Social →
// Settings; both redirect here.)

const MODE_HELP: Record<(typeof MODES)[number], string> = {
  manual: "Human drives — AI acts only on explicit clicks",
  assisted: "AI runs the work, queues at a human checkpoint",
  auto: "End-to-end unattended",
};

export default async function SetupAutomation({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { workspace, membership } = await requireMembership();
  const { ok, err } = await searchParams;
  const admin = canAdmin(membership.role);
  const [modes, paused, lastCycle, weeklyArticles, publishDay, autoSeoRaw, autonomy, queue, campaigns, autoQueue, evergreenFill, autoImage, autogenOn, autogenWeekly, autogenCampaign, socialGate, socialSource] = await Promise.all([
    getModes(workspace.id),
    isGloballyPaused(workspace.id),
    db.auditLog.findFirst({ where: { workspaceId: workspace.id, action: { in: ["autopilot.cycle", "autopilot.manual_run"] } }, orderBy: { createdAt: "desc" } }),
    getSetting("autopilot:weekly_articles", workspace.id).catch(() => ""),
    getSetting("autopilot:publish_day", workspace.id).catch(() => ""),
    getSetting("blog:auto_seo", workspace.id).catch(() => ""),
    autonomyStatus(workspace.id),
    getQueue(workspace.id),
    db.campaign.findMany({ where: { workspaceId: workspace.id, status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getSetting("social:autoqueue", workspace.id).catch(() => "").then((v) => v === "true"),
    getSetting("social:evergreen_fill", workspace.id).catch(() => "").then((v) => v === "true"),
    // Default-ON: only an explicit "false" turns auto-image off.
    getSetting("social:auto_image", workspace.id).catch(() => "").then((v) => v !== "false"),
    getSetting("social:autogen", workspace.id).catch(() => "").then((v) => v === "true"),
    getSetting("social:autogen_weekly", workspace.id).catch(() => "").then((v) => parseInt(v, 10) || 5),
    getSetting("social:autogen_campaign", workspace.id).catch(() => ""),
    getSetting("ideas:social_gate", workspace.id).catch(() => "").then((v) => (v === "human" ? "human" : "auto")),
    getSetting("social:source", workspace.id).catch(() => "").then((v) => (v === "rotation" ? "rotation" : "ideas")),
  ]);
  const autoSeo = autoSeoRaw !== "false";
  const intervalMin = Math.max(5, parseInt(process.env.AUTOPILOT_INTERVAL_MIN ?? "30", 10) || 30);
  const autopilotOff = process.env.AUTOPILOT === "off";
  const nextFreeLabel = queue.free[0] ? formatInZone(queue.free[0].at, queue.timeZone) : null;

  return (
    <div>
      <div className="flex items-baseline gap-3 flex-wrap mb-4">
        <h1 className="font-mono text-[22px] font-bold m-0">Automation</h1>
        <p className="text-[13px] text-[var(--mute)] m-0">What runs by itself in {workspace.name}. The global pause overrides everything.</p>
      </div>
      {ok && <Banner kind="ok" text={ok} />}
      {err && <Banner kind="err" text={err} />}

      {/* Master switch */}
      <div className="card mb-4" style={autonomy.on ? { borderColor: "var(--green-on)" } : undefined}>
        <h2 className="text-sm font-semibold mb-1 flex items-center gap-2">
          Run completely autonomously
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: autonomy.on ? "var(--green-soft)" : "var(--zebra)", color: autonomy.on ? "var(--green-on)" : "var(--mute)" }}>{autonomy.on ? "ON" : "off"}</span>
        </h2>
        <p className="text-xs text-[var(--mute)] mb-2">
          One switch for the whole loop: ideas are discovered, articles are drafted with their images and SEO, social posts are written, both are queued, and articles publish — with nobody clicking.
          {autonomy.on ? " It is running now." : " Off by default."}
        </p>
        <p className="text-xs mb-3">
          <b>The gates review as well as block:</b> with this on, the app fills missing SEO, renders missing images and has a vision model look at every AI image before approving it, and sources <span className="font-mono">[NEEDS SOURCE]</span> claims from live web search. <b>What still stops a post:</b> a claim no real source backs, an image that keeps failing inspection, or a provider outage — those hold at Review and reach your Inbox.
          {autonomy.requireApproval && <> Social posts are also held by <b>require approval</b> (under <Link href="/setup/people" className="underline">People</Link>), so they wait for an admin even with this on.</>}
        </p>
        <div className="rounded-lg bg-[var(--zebra)] px-3 py-2 mb-3">
          <p className="font-mono text-[10px] text-[var(--mute)] m-0">
            {autonomy.modes.map((m) => `${m.fn}=${m.mode}`).join(" · ")} · auto-queue {autonomy.autoqueue ? "on" : "off"} · {autonomy.weeklyArticles === "unset" ? "articles uncapped" : `${autonomy.weeklyArticles} articles/wk`} · publishes {autonomy.publishDay} · {autonomy.weeklySocial} social/wk
          </p>
        </div>
        {admin ? (
          <form action={toggleFullAutonomyAction} className="flex flex-wrap items-center gap-2">
            {!autonomy.on && <input name="confirm" placeholder="Type AUTONOMOUS to confirm" className="text-xs" aria-label="Type AUTONOMOUS to confirm" />}
            <SubmitButton className={autonomy.on ? "btn" : "btn primary"}>{autonomy.on ? "Turn full autonomy off" : "Turn full autonomy on"}</SubmitButton>
            <span className="text-[10px] text-[var(--mute)]">{autonomy.on ? "Switching off restores the exact settings you had before." : "Turning this on sets the four functions to auto and queues on approval."}</span>
          </form>
        ) : <p className="text-xs text-[var(--mute)] m-0">An admin can change this.</p>}
      </div>

      {/* Kill switch + scheduler status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <div className="card flex flex-wrap items-center gap-3" style={paused ? { background: "var(--rose-soft)" } : undefined}>
          <OctagonPause className="w-5 h-5" style={{ color: paused ? "var(--rose-on)" : "var(--mute)" }} />
          <div className="flex-1 min-w-40">
            <div className="text-sm font-semibold" style={paused ? { color: "var(--rose-on)" } : undefined}>Global pause {paused ? "— ON" : "— off"}</div>
            <div className="text-xs text-[var(--mute)]">The emergency brake: blocks every AI action, manual clicks included.</div>
          </div>
          {admin && (
            <form action={toggleGlobalPauseAction}>
              <button className={paused ? "btn primary" : "btn"}>{paused ? <><Play className="w-4 h-4" /> Resume</> : <><OctagonPause className="w-4 h-4" /> Pause everything</>}</button>
            </form>
          )}
        </div>
        <div className="card flex flex-wrap items-center gap-3">
          <Bot className="w-5 h-5" style={{ color: autopilotOff ? "var(--mute)" : "var(--teal-on)" }} />
          <div className="flex-1 min-w-40">
            <div className="text-sm font-semibold">Autopilot {autopilotOff ? "— disabled (AUTOPILOT=off)" : `— sweeps every ${intervalMin} min`}</div>
            <div className="text-xs text-[var(--mute)]">
              {lastCycle ? `Last activity ${lastCycle.createdAt.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}: ${lastCycle.meta}` : "No activity yet — it acts only when a function is assisted or auto and there is due work."}
            </div>
          </div>
          {admin && !autopilotOff && (
            <form action={runAutopilotNowAction}><SubmitButton className="btn" pendingText="Running cycle…">Run cycle now</SubmitButton></form>
          )}
        </div>
      </div>

      {/* Articles: cadence + publish day + SEO */}
      <div className="card mb-4">
        <h2 className="text-sm font-semibold mb-1">Articles</h2>
        <div className="flex flex-wrap items-center gap-3 py-2 border-b border-[var(--line)]">
          <div className="flex-1 min-w-56">
            <div className="text-sm">Weekly target and publish day</div>
            <div className="text-xs text-[var(--mute)]">
              The target caps how many articles the autopilot drafts in any rolling 7 days (empty = no cap, bounded by approved ideas and the daily AI budget). The publish day holds auto-publishing to one weekday in your posting timezone; a date set on a post by hand is always honoured.
            </div>
          </div>
          {admin ? (
            <form action={saveWeeklyArticleTargetAction} className="flex items-center gap-2">
              <input type="number" name="weeklyArticles" min={0} max={50} defaultValue={weeklyArticles || ""} placeholder="∞" className="w-20 border border-[var(--line-2)] rounded-lg p-2 text-sm font-mono" aria-label="Articles per week" />
              <select name="publishDay" defaultValue={publishDay} className="border border-[var(--line-2)] rounded-lg p-2 text-sm" aria-label="Publish day">
                <option value="">Any day</option>
                <option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option><option value="0">Sunday</option>
              </select>
              <SubmitButton className="btn sm" pendingText="Saving…">Save</SubmitButton>
            </form>
          ) : (
            <span className="font-mono text-sm">{weeklyArticles || "no cap"} · {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][parseInt(publishDay, 10)] ?? "any day"}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 py-2">
          <Search className="w-4 h-4" style={{ color: autoSeo ? "var(--green-on)" : "var(--mute)" }} />
          <div className="flex-1 min-w-56">
            <div className="text-sm">SEO metadata with every draft {autoSeo ? "— on" : "— off"}</div>
            <div className="text-xs text-[var(--mute)]">Meta title, description and slug generated with the article (the publish checks require all three). Only empty fields are filled.</div>
          </div>
          {admin ? (
            <form action={toggleAutoSeoAction}>
              <input type="hidden" name="enable" value={autoSeo ? "false" : "true"} />
              <SubmitButton className={autoSeo ? "btn sm" : "btn sm primary"} pendingText="Saving…">{autoSeo ? "Turn off" : "Turn on"}</SubmitButton>
            </form>
          ) : <span className="font-mono text-sm">{autoSeo ? "on" : "off"}</span>}
        </div>
      </div>

      {/* Social auto-dials — the workflow form, minus require-approval (People) */}
      {admin && (
        <div className="card mb-4">
          <h2 className="text-sm font-semibold mb-1 flex items-center gap-2"><Sparkles className="w-4 h-4" style={{ color: "var(--blue-on)" }} /> Social posts</h2>
          <p className="text-[11px] text-[var(--mute)] mb-2">Whether posts need an admin&apos;s approval is under <Link href="/setup/people" className="underline">People</Link>; the slots they go into are under <Link href="/setup/schedule" className="underline">Schedule</Link>.</p>
          <form action={saveSocialWorkflowSettingsAction} className="flex flex-col gap-2">
            <label className="inline-flex items-start gap-2 text-xs cursor-pointer">
              <input type="checkbox" name="autoQueue" defaultChecked={autoQueue} className="mt-0.5" />
              <span><b>Queue on approval.</b> Approving a post drops it into the next free slot ({nextFreeLabel ? <>next is <b>{nextFreeLabel}</b></> : "no free slot right now"}) instead of leaving it a draft.</span>
            </label>
            <label className="inline-flex items-start gap-2 text-xs cursor-pointer">
              <input type="checkbox" name="evergreenFill" defaultChecked={evergreenFill} className="mt-0.5" />
              <span><b>Evergreen auto-fill.</b> Free slots in the next 7 days are refilled with eligible evergreen posts, each after its own cooldown.</span>
            </label>
            <label className="inline-flex items-start gap-2 text-xs cursor-pointer">
              <input type="checkbox" name="autoImage" defaultChecked={autoImage} className="mt-0.5" />
              <span><b>Auto-generate an image</b> for any post composed without one (the image provider&apos;s per-image fee applies). Your own attachments always win.</span>
            </label>
            <div className="flex items-start gap-2 text-xs">
              <label className="inline-flex items-start gap-2 cursor-pointer">
                <input type="checkbox" name="autogen" defaultChecked={autogenOn} className="mt-0.5" />
                <b>Auto-generate posts.</b>
              </label>
              {/* Inputs are SIBLINGS of the label, never inside it — a click on a nested input would toggle the checkbox. */}
              <span className="flex-1">
                The autopilot writes fresh posts from your Topics —{" "}
                <input type="number" name="autogenWeekly" min={1} max={50} defaultValue={autogenWeekly} className="w-14 border border-[var(--line-2)] rounded px-1 py-0.5 text-xs font-mono inline-block" />{" "}
                per week, each with an auto-image, queued into free slots (or held for approval). Needs the Social mode below at assisted or auto and active Topics under <Link href="/ideas/topics" className="underline">Ideas → Topics</Link>.
                {campaigns.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 ml-1">Campaign:{" "}
                    <select name="autogenCampaign" defaultValue={autogenCampaign} className="border border-[var(--line-2)] rounded px-1 py-0.5 text-xs">
                      <option value="">— none —</option>
                      {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </span>
                )}
              </span>
            </div>
            {/* The social idea gate (Topics as the spine, 2026-09-21). A social
                post now starts as an idea on the board; this decides whether
                the engine's own ideas wait for a person. `auto` is the default
                because the feed was already running unattended. */}
            <fieldset className="text-xs border-t border-[var(--line)] pt-2 mt-1">
              <legend className="sr-only">Social ideas</legend>
              <p className="mb-1"><b>Social ideas the engine discovers</b> — every auto-generated post starts as an idea on the <Link href="/ideas?format=social" className="underline">board</Link>, in its Topic&apos;s lane.</p>
              <label className="inline-flex items-start gap-2 cursor-pointer mr-4">
                <input type="radio" name="socialGate" value="auto" defaultChecked={socialGate === "auto"} className="mt-0.5" />
                <span><b>Approve themselves</b> — drafted into the queue on the next sweep, as before. Ideas you or Research add still wait for you.</span>
              </label>
              <label className="inline-flex items-start gap-2 cursor-pointer">
                <input type="radio" name="socialGate" value="human" defaultChecked={socialGate === "human"} className="mt-0.5" />
                <span><b>Wait for a person</b> — like article ideas; the Inbox counts them to triage.</span>
              </label>
              {socialSource === "rotation" && (
                <p className="mt-2 mb-0" style={{ color: "var(--amber-on)" }}>
                  This workspace is on the <b>rotation</b> generator (the pre-idea-stage path: a Topic picked in turn, written straight into the queue, plus per-network variants on publish). Switch it back to ideas here.{" "}
                  <label className="inline-flex items-center gap-1 cursor-pointer"><input type="checkbox" name="socialSourceIdeas" defaultChecked={false} /> Use ideas</label>
                </p>
              )}
              <input type="hidden" name="socialSourceCurrent" value={socialSource} />
            </fieldset>
            <div><SubmitButton className="btn sm" pendingText="Saving…">Save</SubmitButton></div>
          </form>
        </div>
      )}

      {/* Mode dial */}
      <div className="card">
        <h2 className="text-sm font-semibold mb-1">Function modes</h2>
        <p className="text-xs text-[var(--mute)] mb-3">manual — {MODE_HELP.manual} · assisted — {MODE_HELP.assisted} · auto — {MODE_HELP.auto}</p>
        <ul className="flex flex-col">
          {GOVERNED_FUNCTIONS.map((fn) => (
            <li key={fn} className="flex flex-wrap items-center gap-2 py-2 border-b border-[var(--line)] last:border-0">
              <span className="text-sm flex-1 min-w-40">{FUNCTION_LABELS[fn]}</span>
              {MODES.map((m) => {
                const active = modes[fn] === m;
                const style = active
                  ? { background: "var(--accent-soft)", color: "var(--accent-on)", borderColor: "var(--accent-on)" }
                  : { background: "var(--panel)", color: "var(--mute)", borderColor: "var(--line)" };
                return admin ? (
                  <form key={m} action={setFunctionModeAction}>
                    <input type="hidden" name="function" value={fn} />
                    <input type="hidden" name="mode" value={m} />
                    <button className="font-mono text-xs px-2.5 py-1 rounded-full border" style={style} title={MODE_HELP[m]}>{m}</button>
                  </form>
                ) : <span key={m} className="font-mono text-xs px-2.5 py-1 rounded-full border" style={style}>{m}</span>;
              })}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
