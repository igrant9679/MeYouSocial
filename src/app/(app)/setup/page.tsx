import Link from "next/link";
import { Users, Bot, CalendarClock, Plug, Palette, ArrowRight, OctagonPause, Clapperboard } from "lucide-react";
import { requireMembership, canAdmin } from "@/lib/acl";
import { canFollow, whoCanFix } from "@/lib/role-links";
import { setupOverview } from "@/lib/setup-status";
import { studioState } from "@/lib/studio";
import { SubmitButton } from "@/components/SubmitButton";
import { Banner } from "@/components/SocialPostCard";
import { setStudioEnabledAction } from "@/app/actions/setup";

// One Settings (One-Loop step 5), organised by question. Each card answers its
// question in a sentence from the live dials and opens the tab that holds
// them. Brand and voice keeps its own strip (Setup → Brand) and is linked.
// The Video studio switch (step 6) sits beneath: it is a workspace option,
// not a question.

export default async function SetupOverview({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { workspace, membership } = await requireMembership();
  const { ok, err } = await searchParams;
  const admin = canAdmin(membership.role);
  const [o, studio] = await Promise.all([setupOverview(workspace.id), studioState(workspace.id)]);
  const a = o.autonomy;
  const modeLine = a.modes.map((m) => `${m.fn} ${m.mode}`).join(" · ");

  return (
    <div>
      <div className="flex items-baseline gap-3 flex-wrap mb-1">
        <h1 className="font-mono text-[22px] font-bold m-0">Settings</h1>
        <p className="text-[13px] text-[var(--mute)] m-0">Every dial for {workspace.name}, under the question it answers.</p>
      </div>
      {!admin && <p className="text-xs text-[var(--mute)] mb-4">You can read these; an admin changes them.</p>}
      {ok && <Banner kind="ok" text={ok} />}
      {err && <Banner kind="err" text={err} />}
      {o.paused && (
        <div className="card mb-4 flex items-center gap-2 text-sm" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>
          <OctagonPause className="w-4 h-4" /> Global pause is ON — every AI action is halted. <Link href="/setup/automation" className="underline">Resume under Automation</Link>.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
        <Q icon={<Users className="w-5 h-5" />} hue="teal" title="Who can do what" href="/setup/people" cta="People" open={canFollow("/setup/people", membership.role)}>
          <b>{o.members.admins}</b> admin{o.members.admins === 1 ? "" : "s"}, <b>{o.members.editors}</b> editor{o.members.editors === 1 ? "" : "s"}, <b>{o.members.viewers}</b> viewer{o.members.viewers === 1 ? "" : "s"}
          {o.invitations > 0 && <> · <b>{o.invitations}</b> invitation{o.invitations === 1 ? "" : "s"} not yet accepted</>}.
          {" "}Social posts {a.requireApproval ? <>need an <b>admin&apos;s approval</b></> : <>go out <b>without approval</b></>}; publishing an article is always an admin&apos;s act.
        </Q>

        <Q icon={<Bot className="w-5 h-5" />} hue="violet" title="What runs by itself" href="/setup/automation" cta="Automation">
          Full autonomy is <b>{a.on ? "ON" : "off"}</b>
          {a.on ? <> — ideas, drafts, images, SEO, social posts and publishing run with nobody clicking.</> : <>. {modeLine}.</>}
          {" "}Articles: <b>{a.weeklyArticles === "unset" ? "no weekly cap" : `${a.weeklyArticles} a week`}</b>, publishing <b>{o.publishDayLabel ? `on ${o.publishDayLabel}s` : "any day"}</b>.
          {" "}Social: <b>{a.weeklySocial} a week</b>, auto-queue <b>{a.autoqueue ? "on" : "off"}</b>.
        </Q>

        <Q icon={<CalendarClock className="w-5 h-5" />} hue="blue" title="When things go out" href="/setup/schedule" cta="Schedule">
          <b>{o.schedule.slotsPerWeek}</b> posting slot{o.schedule.slotsPerWeek === 1 ? "" : "s"} a week in <b>{o.schedule.timeZone}</b>
          {!o.schedule.timeZoneConfigured && <span style={{ color: "var(--amber-on)" }}> (no timezone set — that is UTC)</span>}
          {o.schedule.nextFree ? <>, next free {o.schedule.nextFree}</> : <>, no free slot ahead</>}.
          {" "}{o.schedule.campaigns > 0 ? <><b>{o.schedule.campaigns}</b> active campaign{o.schedule.campaigns === 1 ? "" : "s"}.</> : "No campaigns."}
          {" "}Articles publish {o.publishDayLabel ? `on ${o.publishDayLabel}s` : "any day"}.
        </Q>

        <Q icon={<Plug className="w-5 h-5" />} hue="green" title="Keys and connections" href="/setup/connections" cta="Connections">
          {o.missing.length === 0
            ? <>Everything the loop needs is connected.</>
            : <><b>{o.missing.length}</b> missing: {o.missing.map((m) => m.label).join(", ")}.</>}
          {" "}{o.connections.filter((c) => c.state === "ok").length} of {o.connections.length} connected.
        </Q>

        <Q icon={<Palette className="w-5 h-5" />} hue="rose" title="Brand and voice" href="/brand" cta="Brand">
          Company info, the seven Motifs, the brand kit and image specs, and the <Link href="/blog/experts" className="underline">experts</Link> the writing quotes. Brand has its own pages.
        </Q>

        {/* Workspace option, not a question: the studio is optional (decision 1). */}
        <section className="card flex flex-col gap-2" style={studio.show ? { borderColor: "var(--green-on)" } : undefined}>
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}><Clapperboard className="w-5 h-5" /></span>
            <h2 className="font-mono text-[14px] font-bold m-0">Video studio</h2>
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: studio.show ? "var(--green-soft)" : "var(--zebra)", color: studio.show ? "var(--green-on)" : "var(--mute)" }}>{studio.show ? "shown" : "hidden"}</span>
          </div>
          <p className="text-sm m-0 leading-relaxed">
            Scripts, thumbnails, video renders and the production board.{" "}
            {studio.channels === 0
              ? <>Hidden because no YouTube channel exists yet{admin ? <> — <Link href="/channels" className="underline">add one under Channels</Link></> : ""}.</>
              : studio.on
                ? <>Shown under Drafts because {studio.channels === 1 ? "a YouTube channel exists" : `${studio.channels} YouTube channels exist`}. Turning a short or a render out of an article stays available either way.</>
                : <>Switched off — the tabs and controls are hidden; nothing was deleted.</>}
          </p>
          {admin && studio.channels > 0 && (
            <form action={setStudioEnabledAction}>
              <input type="hidden" name="enabled" value={studio.on ? "false" : "true"} />
              <SubmitButton className={studio.on ? "btn sm" : "btn sm primary"} pendingText="Saving…">{studio.on ? "Hide the studio" : "Show the studio"}</SubmitButton>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}

function Q({ icon, hue, title, href, cta, children, open = true }: { icon: React.ReactNode; hue: string; title: string; href: string; cta: string; children: React.ReactNode; open?: boolean }) {
  return (
    <section className="card flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0" style={{ background: `var(--${hue}-soft)`, color: `var(--${hue}-on)` }}>{icon}</span>
        <h2 className="font-mono text-[14px] font-bold m-0">{title}</h2>
      </div>
      <p className="text-sm m-0 leading-relaxed">{children}</p>
      <div>
        {/* People is admin-only; a non-admin's button bounced to /forbidden (SHL-07). */}
        {open
          ? <Link href={href} className="btn sm inline-flex items-center gap-1">{cta} <ArrowRight className="w-3.5 h-3.5" /></Link>
          : <span className="text-[11px] text-[var(--mute)]">{whoCanFix(href)}</span>}
      </div>
    </section>
  );
}
