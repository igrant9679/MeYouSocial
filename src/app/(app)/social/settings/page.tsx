import Link from "next/link";
import { Settings2, Link2 as LinkIcon, Megaphone, ShieldCheck } from "lucide-react";
import { requireRole, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { PostingSchedule } from "@/components/PostingSchedule";
import { SubmitButton } from "@/components/SubmitButton";
import { DeleteButton } from "@/components/DeleteButton";
import { HelpTip } from "@/components/HelpTip";
import { SOCIAL_TIPS } from "@/lib/help-tips";
import { getUtmConfig } from "@/lib/social/utm";
import { formatInZone, getQueue } from "@/lib/social/slots";
import { saveUtmSettingsAction } from "@/app/actions/social";
import {
  createCampaignAction,
  toggleCampaignAction,
  saveSocialWorkflowSettingsAction,
} from "@/app/actions/social-workflow";
import { Banner, SocialHeader } from "@/components/SocialPostCard";

// Everything that configures how social BEHAVES, rather than what it says:
// the posting schedule, link tagging, campaigns, and how much runs unattended.

type SP = { ok?: string; err?: string };

export default async function SocialSettingsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { workspace, membership } = await requireRole("EDITOR");
  const { ok, err } = await searchParams;
  const isAdmin = canAdmin(membership.role);

  const [campaigns, posts, utm, queue] = await Promise.all([
    db.campaign.findMany({
      where: { workspaceId: workspace.id },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
    db.socialPost.findMany({
      where: { workspaceId: workspace.id },
      select: { status: true, campaign: { select: { name: true } } },
      take: 500,
    }),
    getUtmConfig(workspace.id),
    getQueue(workspace.id),
  ]);

  const [requireApproval, evergreenFill, autoImage, autogenOn, autogenWeekly, autogenCampaign] = await Promise.all([
    getSetting("social:require_approval", workspace.id).catch(() => "").then((v) => v === "true"),
    getSetting("social:evergreen_fill", workspace.id).catch(() => "").then((v) => v === "true"),
    // Default-ON: only an explicit "false" turns auto-image off.
    getSetting("social:auto_image", workspace.id).catch(() => "").then((v) => v !== "false"),
    getSetting("social:autogen", workspace.id).catch(() => "").then((v) => v === "true"),
    getSetting("social:autogen_weekly", workspace.id).catch(() => "").then((v) => parseInt(v, 10) || 5),
    getSetting("social:autogen_campaign", workspace.id).catch(() => ""),
  ]);

  const activeCampaigns = campaigns.filter((c) => c.status === "active");
  const nextFreeLabel = queue.free[0] ? formatInZone(queue.free[0].at, queue.timeZone) : null;

  return (
    <div className="p-6 w-full">
      <SocialHeader
        icon={<Settings2 className="w-6 h-6" strokeWidth={2.25} />}
        title="Social settings"
        blurb="Posting schedule, link tagging, campaigns, and how much the app may do unattended."
      >
        <Link href="/admin/connections" className="btn sm">Connections</Link>
      </SocialHeader>

      {ok && <Banner kind="ok" text={ok} />}
      {err && <Banner kind="err" text={err} />}

      <PostingSchedule
        slots={queue.slots}
        timeZone={queue.timeZone}
        timeZoneConfigured={queue.timeZoneConfigured}
        canEdit={isAdmin}
        nextFree={nextFreeLabel}
      />

      {/* Link tagging — makes social traffic attributable in GA4, which is what
          lets Insights tell LinkedIn clicks apart from X clicks. */}
      <details className="card mb-6" open>
        <summary className="cursor-pointer text-sm font-semibold flex items-center gap-2">
          <LinkIcon className="w-4 h-4" style={{ color: "var(--blue-on)" }} />
          Link tagging (UTM)
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: utm.enabled ? "var(--green-soft)" : "var(--zebra)", color: utm.enabled ? "var(--green-on)" : "var(--mute)" }}>
            {utm.enabled ? "on" : "off"}
          </span>
          <HelpTip text={SOCIAL_TIPS.utm} side="bottom" wide />
        </summary>
        <p className="text-[11px] text-[var(--mute)] mt-2 mb-2 leading-relaxed">
          Appends UTM parameters to links when a post is sent, using <b>the network as the source</b> — so GA4 (and the
          search &amp; traffic panels on <Link href="/insights" className="underline">Insights</Link>) can tell LinkedIn
          traffic from X traffic instead of lumping it together as referral. Links you&apos;ve already tagged yourself are
          left untouched, and the text you wrote is stored unchanged — tagging happens at send.
        </p>
        <form action={saveUtmSettingsAction} className="flex flex-wrap items-end gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs">
            <input type="checkbox" name="enabled" defaultChecked={utm.enabled} /> Enabled
          </label>
          <label className="text-[11px] text-[var(--mute)]">
            Source
            <input name="source" defaultValue={utm.source} placeholder="(network name)" className="w-32 text-xs block mt-0.5" />
          </label>
          <label className="text-[11px] text-[var(--mute)]">
            Medium
            <input name="medium" defaultValue={utm.medium} placeholder="social" className="w-28 text-xs block mt-0.5" />
          </label>
          <label className="text-[11px] text-[var(--mute)]">
            Campaign
            <input name="campaign" defaultValue={utm.campaign} placeholder="(optional)" className="w-36 text-xs block mt-0.5" />
          </label>
          <SubmitButton className="btn sm" pendingText="Saving…">Save</SubmitButton>
        </form>
      </details>

      {/* Campaigns — named series with their own UTM tag and their own roll-up. */}
      <details className="card mb-6">
        <summary className="cursor-pointer text-sm font-semibold flex items-center gap-2">
          <Megaphone className="w-4 h-4" style={{ color: "var(--blue-on)" }} />
          Campaigns
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: activeCampaigns.length ? "var(--blue-soft)" : "var(--zebra)", color: activeCampaigns.length ? "var(--blue-on)" : "var(--mute)" }}>
            {activeCampaigns.length} active
          </span>
          <HelpTip text={SOCIAL_TIPS.campaign} side="bottom" wide />
        </summary>
        {campaigns.length > 0 && (
          <div className="flex flex-col gap-1.5 mt-3 mb-3">
            {campaigns.map((c) => {
              const stats = posts.filter((p) => p.campaign && p.campaign.name === c.name);
              const out = stats.filter((p) => ["posted", "partial"].includes(p.status)).length;
              return (
                <div key={c.id} className="flex items-center gap-2 text-xs rounded-lg border border-[var(--line)] px-2 py-1.5">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: /^#[0-9a-fA-F]{6}$/.test(c.color ?? "") ? c.color! : "var(--blue)" }} />
                  <span className="font-semibold">{c.name}</span>
                  {c.status === "archived" && <span className="font-mono text-[10px] text-[var(--mute)]">archived</span>}
                  {c.utmCampaign && <span className="font-mono text-[10px] text-[var(--mute)]">utm: {c.utmCampaign}</span>}
                  <span className="font-mono text-[10px] text-[var(--mute)]">{stats.length} post{stats.length === 1 ? "" : "s"} · {out} sent</span>
                  <span className="flex-1" />
                  {isAdmin && (
                    <>
                      <form action={toggleCampaignAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <button className="btn sm" title={c.status === "active" ? "Archive — keeps the tag on existing posts" : "Reactivate"}>
                          {c.status === "active" ? "Archive" : "Reactivate"}
                        </button>
                      </form>
                      <DeleteButton kind="campaign" id={c.id} name={c.name} iconOnly className="btn sm" />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {isAdmin ? (
          <form action={createCampaignAction} className="flex flex-wrap items-end gap-2 mt-2">
            <label className="text-[11px] text-[var(--mute)]">
              Name
              <input name="name" required maxLength={60} placeholder="Q3 product launch" className="w-44 text-xs block mt-0.5" />
            </label>
            <label className="text-[11px] text-[var(--mute)]">
              utm_campaign
              <input name="utmCampaign" maxLength={80} placeholder="(optional — defaults to the workspace tag)" className="w-64 text-xs block mt-0.5" />
            </label>
            <label className="text-[11px] text-[var(--mute)]">
              Color
              <input name="color" type="color" defaultValue="#2563EB" className="block mt-0.5 h-7 w-10 p-0 border border-[var(--line-2)] rounded" />
            </label>
            <SubmitButton className="btn sm" pendingText="Creating…">Create campaign</SubmitButton>
          </form>
        ) : (
          <p className="text-[11px] text-[var(--mute)] mt-2">Only workspace admins manage campaigns; pick one on any post in the composer.</p>
        )}
      </details>

      {/* Workflow — approval + evergreen auto-fill, both opt-in. */}
      {isAdmin && (
        <details className="card mb-6">
          <summary className="cursor-pointer text-sm font-semibold flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" style={{ color: "var(--green-on)" }} />
            Workflow &amp; automation
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: requireApproval ? "var(--green-soft)" : "var(--zebra)", color: requireApproval ? "var(--green-on)" : "var(--mute)" }}>
              approval {requireApproval ? "on" : "off"}
            </span>
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: evergreenFill ? "var(--green-soft)" : "var(--zebra)", color: evergreenFill ? "var(--green-on)" : "var(--mute)" }}>
              evergreen fill {evergreenFill ? "on" : "off"}
            </span>
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: autoImage ? "var(--green-soft)" : "var(--zebra)", color: autoImage ? "var(--green-on)" : "var(--mute)" }}>
              auto-image {autoImage ? "on" : "off"}
            </span>
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: autogenOn ? "var(--green-soft)" : "var(--zebra)", color: autogenOn ? "var(--green-on)" : "var(--mute)" }}>
              auto-generate {autogenOn ? `${autogenWeekly}/wk` : "off"}
            </span>
          </summary>
          <form action={saveSocialWorkflowSettingsAction} className="mt-3 flex flex-col gap-2">
            <label className="inline-flex items-start gap-2 text-xs cursor-pointer">
              <input type="checkbox" name="requireApproval" defaultChecked={requireApproval} className="mt-0.5" />
              <span>
                <b>Require approval.</b> Posts by non-admins are held until an admin approves them —
                nothing unapproved can be sent, scheduled, queued or dragged onto the calendar.
              </span>
            </label>
            <label className="inline-flex items-start gap-2 text-xs cursor-pointer">
              <input type="checkbox" name="evergreenFill" defaultChecked={evergreenFill} className="mt-0.5" />
              <span>
                <b>Evergreen auto-fill.</b> Free queue slots in the next 7 days are refilled with
                eligible evergreen posts (each after its own cooldown). Off by default — automatic
                posting should never be a surprise.
              </span>
            </label>
            <label className="inline-flex items-start gap-2 text-xs cursor-pointer">
              <input type="checkbox" name="autoImage" defaultChecked={autoImage} className="mt-0.5" />
              <span>
                <b>Auto-generate an image</b> for any post composed without one, using the
                workspace&apos;s image provider (renders cost that provider&apos;s per-image fee). Your own
                attachments always win; when the provider is the mock, nothing is attached rather
                than faking it with stock.
              </span>
            </label>
            <div className="flex items-start gap-2 text-xs">
              <label className="inline-flex items-start gap-2 cursor-pointer">
                <input type="checkbox" name="autogen" defaultChecked={autogenOn} className="mt-0.5" />
                <b>Auto-generate posts.</b>
              </label>
              {/* Inputs are SIBLINGS of the label, never inside it — a click on
                  a nested input would toggle the checkbox instead. */}
              <span className="flex-1">
                The autopilot writes fresh posts from your Topics —{" "}
                <input type="number" name="autogenWeekly" min={1} max={50} defaultValue={autogenWeekly}
                  className="w-14 border border-[var(--line-2)] rounded px-1 py-0.5 text-xs font-mono inline-block" />{" "}
                per week, spread across the day, each with an auto-image, queued into free slots — or held
                for approval when the approval workflow is on. Needs the <b>Social</b> mode dial under
                Blog → Automation set to assisted or auto, and active Topics under Brand. Placeholder output is
                never stored: no working AI key means no posts, visibly.
                {activeCampaigns.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 ml-1">
                    Campaign:{" "}
                    <select name="autogenCampaign" defaultValue={autogenCampaign} className="border border-[var(--line-2)] rounded px-1 py-0.5 text-xs">
                      <option value="">— none —</option>
                      {activeCampaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </span>
                )}
              </span>
            </div>
            <div><SubmitButton className="btn sm" pendingText="Saving…">Save workflow</SubmitButton></div>
          </form>
        </details>
      )}
    </div>
  );
}
