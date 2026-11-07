import { stop } from "@/lib/sentence";
import Link from "next/link";
import { Link2 as LinkIcon, Megaphone, Clock } from "lucide-react";
import { requireMembership, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { PostingSchedule } from "@/components/PostingSchedule";
import { SubmitButton } from "@/components/SubmitButton";
import { DeleteButton } from "@/components/DeleteButton";
import { HelpTip } from "@/components/HelpTip";
import { SOCIAL_TIPS } from "@/lib/help-tips";
import { getUtmConfig } from "@/lib/social/utm";
import { formatInZone, formatMinute, getQueue, WEEKDAY_LABELS, type PostingSlotRow } from "@/lib/social/slots";
import { saveUtmSettingsAction } from "@/app/actions/social";
import { addPostingSlotsAction, addBestTimeSlotsAction, updatePostingSlotAction } from "@/app/actions/social-slots";
import { analyseBestTimes, MIN_POSTS, MIN_PER_BUCKET, OUTPERFORM, type BestTimeReport } from "@/lib/social/best-time";
import { addCategoryAction, createCampaignAction, removeCategoryAction, toggleCampaignAction } from "@/app/actions/social-workflow";
import { listCategories } from "@/lib/social/categories";
import { Banner } from "@/components/SocialPostCard";
import { saveLinkInBioAction } from "@/app/actions/link-in-bio";
import { LIB_ENABLED, LIB_SLUG } from "@/lib/link-in-bio";

// Settings → Schedule: when things go out. The posting slots and timezone,
// the measured best times, link tagging and campaigns (moved from Social →
// Settings, which redirects here), and the article publish day (a link — it
// is set with the article cadence under Automation).

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function SetupSchedule({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { workspace, membership } = await requireMembership();
  const { ok, err } = await searchParams;
  const isAdmin = canAdmin(membership.role);
  const [bioEnabled, bioSlug] = await Promise.all([getSetting(LIB_ENABLED, workspace.id).catch(() => ""), getSetting(LIB_SLUG, workspace.id).catch(() => "")]);
  const bio = { enabled: bioEnabled === "true", slug: bioSlug, suggested: workspace.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "our-links" };
  const [campaigns, posts, utm, queue, bestTimes, publishDay, categories] = await Promise.all([
    db.campaign.findMany({ where: { workspaceId: workspace.id }, orderBy: [{ status: "asc" }, { name: "asc" }] }),
    db.socialPost.findMany({ where: { workspaceId: workspace.id }, select: { status: true, campaign: { select: { name: true } } }, take: 500 }),
    getUtmConfig(workspace.id),
    getQueue(workspace.id),
    analyseBestTimes(workspace.id),
    getSetting("autopilot:publish_day", workspace.id).catch(() => ""),
    listCategories(workspace.id),
  ]);
  const activeCampaigns = campaigns.filter((c) => c.status === "active");
  const nextFreeLabel = queue.free[0] ? formatInZone(queue.free[0].at, queue.timeZone) : null;
  const publishDayLabel = /^\d$/.test(publishDay) ? DAY[Number(publishDay)] : null;

  return (
    <div>
      <div className="flex items-baseline gap-3 flex-wrap mb-4">
        <h1 className="font-mono text-2xl font-bold m-0">Schedule</h1>
        <p className="text-sm text-[var(--mute)] m-0">When things go out of {workspace.name}{stop(workspace.name)}</p>
      </div>
      {ok && <Banner kind="ok" text={ok} />}
      {err && <Banner kind="err" text={err} />}

      <p className="text-xs mb-4">
        Articles publish <b>{publishDayLabel ? `on ${publishDayLabel}s` : "on any day"}</b> — set with the article cadence under{" "}
        <Link href="/setup/automation" className="underline">Automation</Link>. Social posts go into the slots below.
      </p>

      <PostingSchedule slots={queue.slots} timeZone={queue.timeZone} timeZoneConfigured={queue.timeZoneConfigured} canEdit={isAdmin} nextFree={nextFreeLabel} />

      <BestTimes report={bestTimes} canEdit={isAdmin} slots={queue.slots} />

      {/* Post categories — the list the composer, Caption Studio and the
          Queue / Sent / Drafts filters offer (social/categories.ts). */}
      <details className="card mb-6">
        <summary className="cursor-pointer text-sm font-semibold flex items-center gap-2">
          Post categories
          <span className="font-mono text-micro px-1.5 py-0.5 rounded-full" style={{ background: "var(--zebra)", color: "var(--mute)" }}>{categories.length}</span>
          <HelpTip text={SOCIAL_TIPS.slotCategory} side="bottom" wide />
        </summary>
        <p className="text-2xs text-[var(--mute)] mt-2 mb-2">Every post can be filed under one. A posting slot with the same category takes those posts first. Removing one takes it off the list; posts already filed under it keep the label.</p>
        <ul className="flex flex-wrap gap-1.5 m-0 p-0 list-none mb-2">
          {categories.map((c) => (
            <li key={c} className="inline-flex items-center gap-1 font-mono text-2xs px-2 py-0.5 rounded-full border border-[var(--line-2)]">
              {c}
              {isAdmin && (
                <form action={removeCategoryAction} className="inline">
                  <input type="hidden" name="name" value={c} />
                  <button type="submit" className="text-[var(--mute)] hover:text-[var(--rose-on)]" title={`Remove ${c} from the list`} aria-label={`Remove ${c}`}>×</button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {isAdmin && (
          <form action={addCategoryAction} className="flex items-center gap-2">
            <input name="name" maxLength={40} placeholder="New category" className="text-xs w-48" />
            <SubmitButton className="btn sm" pendingText="Adding…">Add</SubmitButton>
          </form>
        )}
      </details>

      <details className="card mb-6" open>
        <summary className="cursor-pointer text-sm font-semibold flex items-center gap-2">
          <LinkIcon className="w-4 h-4" style={{ color: "var(--blue-on)" }} /> Link tagging (UTM)
          <span className="font-mono text-micro px-1.5 py-0.5 rounded-full" style={{ background: utm.enabled ? "var(--green-soft)" : "var(--zebra)", color: utm.enabled ? "var(--green-on)" : "var(--mute)" }}>{utm.enabled ? "on" : "off"}</span>
          <HelpTip text={SOCIAL_TIPS.utm} side="bottom" wide />
        </summary>
        <p className="text-2xs text-[var(--mute)] mt-2 mb-2 leading-relaxed">
          Appends UTM parameters to links when a post is sent, using <b>the network as the source</b>, so GA4 and <Link href="/insights" className="underline">Insights</Link> can tell LinkedIn traffic from X traffic. Links you tagged yourself are left untouched; tagging happens at send.
        </p>
        <form action={saveUtmSettingsAction} className="flex flex-wrap items-end gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs"><input type="checkbox" name="enabled" defaultChecked={utm.enabled} /> Enabled</label>
          <label className="text-2xs text-[var(--mute)]">Source<input name="source" defaultValue={utm.source} placeholder="(network name)" className="w-32 text-xs block mt-0.5" /></label>
          <label className="text-2xs text-[var(--mute)]">Medium<input name="medium" defaultValue={utm.medium} placeholder="social" className="w-28 text-xs block mt-0.5" /></label>
          <label className="text-2xs text-[var(--mute)]">Campaign<input name="campaign" defaultValue={utm.campaign} placeholder="(optional)" className="w-36 text-xs block mt-0.5" /></label>
          <SubmitButton className="btn sm" pendingText="Saving…">Save</SubmitButton>
        </form>
      </details>

      {/* E-SOC-11: a public page of the links in recently sent posts, tagged utm_source=linkinbio. */}
      <details className="card mb-6" id="link-in-bio" open={bio.enabled} data-link-in-bio-card>
        <summary className="cursor-pointer text-sm font-semibold flex items-center gap-2">
          <LinkIcon className="w-4 h-4" style={{ color: "var(--blue-on)" }} /> Link in bio
          <span className="font-mono text-micro px-1.5 py-0.5 rounded-full" style={{ background: bio.enabled ? "var(--green-soft)" : "var(--zebra)", color: bio.enabled ? "var(--green-on)" : "var(--mute)" }}>{bio.enabled ? "on" : "off"}</span>
        </summary>
        <p className="text-2xs text-[var(--mute)] mt-2 mb-2 leading-relaxed">
          One public page for the link a profile allows: the links in your recently sent posts, newest first, one per
          destination, with an article&apos;s own title where the link is yours. Each is tagged <span className="font-mono">utm_source=linkinbio</span> so
          its clicks are told apart. Only what was already posted appears; nothing needs signing in to see it.
          {bio.enabled && bio.slug && <> Live at <a href={`/l/${bio.slug}`} className="underline font-mono" target="_blank" rel="noreferrer">/l/{bio.slug}</a>.</>}
        </p>
        {isAdmin ? (
          <form action={saveLinkInBioAction} className="flex flex-wrap items-end gap-2">
            <label className="inline-flex items-center gap-1.5 text-xs"><input type="checkbox" name="enabled" defaultChecked={bio.enabled} /> On</label>
            <label className="text-2xs text-[var(--mute)]">Address<span className="flex items-center gap-1 mt-0.5"><span className="font-mono text-xs">/l/</span><input name="slug" defaultValue={bio.slug} placeholder={bio.suggested} maxLength={40} className="w-44 text-xs font-mono border border-[var(--line-2)] rounded-lg px-2 py-1" /></span></label>
            <SubmitButton className="btn sm" pendingText="Saving…">Save</SubmitButton>
          </form>
        ) : (
          <p className="text-2xs text-[var(--mute)] m-0">An admin turns it on and picks its address.</p>
        )}
      </details>

      <details className="card mb-6">
        <summary className="cursor-pointer text-sm font-semibold flex items-center gap-2">
          <Megaphone className="w-4 h-4" style={{ color: "var(--blue-on)" }} /> Campaigns
          <span className="font-mono text-micro px-1.5 py-0.5 rounded-full" style={{ background: activeCampaigns.length ? "var(--blue-soft)" : "var(--zebra)", color: activeCampaigns.length ? "var(--blue-on)" : "var(--mute)" }}>{activeCampaigns.length} active</span>
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
                  <Link href={`/social/campaigns/${c.id}`} className="font-semibold hover:underline" title="Its calendar, counts and results">{c.name}</Link>
                  {c.status === "archived" && <span className="font-mono text-micro text-[var(--mute)]">archived</span>}
                  {c.utmCampaign && <span className="font-mono text-micro text-[var(--mute)]">utm: {c.utmCampaign}</span>}
                  <span className="font-mono text-micro text-[var(--mute)]">{stats.length} post{stats.length === 1 ? "" : "s"} · {out} sent</span>
                  <span className="flex-1" />
                  {isAdmin && (
                    <>
                      <form action={toggleCampaignAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <button className="btn sm" title={c.status === "active" ? "Archive — keeps the tag on existing posts" : "Reactivate"}>{c.status === "active" ? "Archive" : "Reactivate"}</button>
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
            <label className="text-2xs text-[var(--mute)]">Name<input name="name" required maxLength={60} placeholder="Q3 product launch" className="w-44 text-xs block mt-0.5" /></label>
            <label className="text-2xs text-[var(--mute)]">utm_campaign<input name="utmCampaign" maxLength={80} placeholder="(optional — defaults to the workspace tag)" className="w-64 text-xs block mt-0.5" /></label>
            {/* raw-colour: a colour input only takes hex */}
            <label className="text-2xs text-[var(--mute)]">Color<input name="color" type="color" defaultValue="#2563EB" className="block mt-0.5 h-7 w-10 p-0 border border-[var(--line-2)] rounded" /></label>
            <SubmitButton className="btn sm" pendingText="Creating…">Create campaign</SubmitButton>
          </form>
        ) : <p className="text-2xs text-[var(--mute)] mt-2">Only workspace admins manage campaigns; pick one on any post in the composer.</p>}
      </details>
    </div>
  );
}

/**
 * Best time to post — measured from engagement actually pulled back from the
 * networks, never modelled, and it refuses to answer below the evidence bar.
 */
function BestTimes({ report, canEdit, slots }: { report: BestTimeReport; canEdit: boolean; slots: PostingSlotRow[] }) {
  const { reason, baseline, best, worst, buckets, measured, unmeasurable, suggestions } = report;
  // Slots sitting in a time that measures worse than the baseline (E-SOC-18),
  // each offered the next measured best time the schedule doesn't have — one
  // suggestion per slot, so two slots aren't both told to move to the same place.
  const free = [...suggestions];
  const moves = slots
    .filter((s) => s.enabled)
    .map((s) => ({ slot: s, bucket: worst.find((w) => w.weekday === s.weekday && w.hour === Math.floor(s.minute / 60)) }))
    .filter((m): m is { slot: PostingSlotRow; bucket: (typeof worst)[number] } => !!m.bucket)
    .map((m) => ({ ...m, to: free.shift() ?? null }));
  return (
    <details className="card mb-6" open={!reason}>
      <summary className="cursor-pointer text-sm font-semibold flex items-center gap-2">
        <Clock className="w-4 h-4" style={{ color: "var(--green-on)" }} /> Best time to post
        <span className="font-mono text-micro px-1.5 py-0.5 rounded-full" style={reason ? { background: "var(--zebra)", color: "var(--mute)" } : { background: "var(--green-soft)", color: "var(--green-on)" }}>{reason ? "not enough data" : `${measured} posts`}</span>
      </summary>
      <p className="text-2xs text-[var(--mute)] mt-2 mb-2 leading-relaxed">
        Posts are grouped by the hour they went out in <b>{report.timeZone}</b>{!report.timeZoneConfigured && " (no timezone set, so this is UTC)"} and compared on <b>engagement rate</b>. A time is only judged once it has {MIN_PER_BUCKET} posts of its own, and nothing is shown below {MIN_POSTS} measured posts.
      </p>
      {reason ? (
        <div className="flex items-baseline gap-2"><span className="text-2xl font-bold text-[var(--mute)]">—</span><span className="text-xs text-[var(--mute)]">{reason}</span></div>
      ) : (
        <>
          <div className="text-2xs text-[var(--mute)] mb-2">
            Baseline engagement rate across {measured} measured post{measured === 1 ? "" : "s"}: <b className="text-[var(--slate)]">{baseline!.toFixed(2)}%</b>
            {unmeasurable > 0 && <> · {unmeasurable} excluded for having no impressions figure</>}
          </div>
          {best.length > 0 ? (
            <div className="flex flex-col gap-1 mb-2">
              {best.map((b) => (
                <div key={b.label} className="flex items-center gap-2 text-xs rounded-lg border px-2 py-1.5" style={{ borderColor: "var(--green)" }}>
                  <span className="font-mono font-semibold w-20">{b.label}</span>
                  <span style={{ color: "var(--green-on)" }}>{b.ratio.toFixed(1)}× the baseline</span>
                  <span className="text-[var(--mute)]">{b.rate.toFixed(2)}%</span>
                  <span className="flex-1" />
                  <span className="font-mono text-micro text-[var(--mute)]">n={b.posts}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--mute)] mb-2">No time beats the baseline by {OUTPERFORM}× yet — on this evidence, when you post matters less than that you post.</p>
          )}
          {worst.length > 0 && <p className="text-2xs text-[var(--mute)] mb-2">Underperforming: {worst.map((w) => `${w.label} (${w.ratio.toFixed(1)}×, n=${w.posts})`).join(", ")}.</p>}
          {moves.length > 0 && (
            <div className="flex flex-col gap-1 mb-2" data-slot-moves>
              {moves.map(({ slot, bucket, to }) => (
                <div key={slot.id} className="flex flex-wrap items-center gap-2 text-xs rounded-lg border px-2 py-1.5" style={{ borderColor: "var(--amber)" }}>
                  <span>Your <b className="font-mono">{WEEKDAY_LABELS[slot.weekday]} {formatMinute(slot.minute)}</b> slot posts at a time that measures <b>{bucket.ratio.toFixed(1)}×</b> the baseline (n={bucket.posts}).</span>
                  <span className="flex-1" />
                  {to && canEdit ? (
                    <form action={updatePostingSlotAction}>
                      <input type="hidden" name="id" value={slot.id} />
                      <input type="hidden" name="weekday" value={to.weekday} />
                      <input type="hidden" name="time" value={formatMinute(to.minute)} />
                      <SubmitButton className="btn sm" pendingText="Moving…" title="Move the slot; posts the queue put there move with it">Move it to {to.label} ({to.ratio.toFixed(1)}×)</SubmitButton>
                    </form>
                  ) : <span className="text-2xs text-[var(--mute)]">{to ? `${to.label} measures ${to.ratio.toFixed(1)}× — an admin can move it.` : "No better time without a slot yet."}</span>}
                </div>
              ))}
            </div>
          )}
          {suggestions.length > 0 && canEdit && (
            <div className="mt-2 pt-2 border-t border-[var(--line)]">
              <div className="text-2xs text-[var(--mute)] mb-1.5 flex items-center gap-2">
                Not in your posting schedule yet:
                {suggestions.length > 1 && (
                  <form action={addBestTimeSlotsAction} className="ml-auto">
                    <SubmitButton className="btn sm" pendingText="Adding…" title="Add a general slot at every time listed here">Fill from best times ({suggestions.length})</SubmitButton>
                  </form>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <form key={s.label} action={addPostingSlotsAction}>
                    <input type="hidden" name="time" value={formatMinute(s.minute)} />
                    <input type="hidden" name="weekdays" value={String(s.weekday)} />
                    <SubmitButton className="btn sm" pendingText="Adding…" title={`Add a ${s.label} slot to the posting schedule`}>+ {s.label}</SubmitButton>
                  </form>
                ))}
              </div>
            </div>
          )}
          {buckets.length > best.length && (
            <details className="mt-2">
              <summary className="cursor-pointer text-2xs text-[var(--mute)]">All {buckets.length} times measured</summary>
              <div className="flex flex-col gap-0.5 mt-1.5">
                {buckets.map((b) => (
                  <div key={b.label} className="flex items-center gap-2 text-2xs">
                    <span className="font-mono w-20">{b.label}</span>
                    <span className="text-[var(--mute)] w-16">{b.rate.toFixed(2)}%</span>
                    <span className="text-[var(--mute)]">{b.judged ? `${b.ratio.toFixed(1)}×` : <span title={`Only ${b.posts} post${b.posts === 1 ? "" : "s"} — needs ${MIN_PER_BUCKET} to judge`}>—</span>}</span>
                    <span className="flex-1" />
                    <span className="font-mono text-micro text-[var(--mute)]">n={b.posts}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </details>
  );
}
