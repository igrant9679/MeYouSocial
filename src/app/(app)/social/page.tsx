import Link from "next/link";
import { Share2, CalendarClock, Send, Copy, Trash2, RotateCw, Check, X, Clock, Pencil, Image as ImageIcon, Tags, Link2 as LinkIcon, ListPlus, BarChart3, Megaphone, Recycle, ShieldCheck, FileUp } from "lucide-react";
import { requireRole, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { getSetting } from "@/lib/settings";
import { SocialComposer } from "@/components/SocialComposer";
import { SocialCalendar, type CalendarPost } from "@/components/SocialCalendar";
import { PostingSchedule } from "@/components/PostingSchedule";
import { SubmitButton } from "@/components/SubmitButton";
import { DeleteButton } from "@/components/DeleteButton";
import { HelpTip } from "@/components/HelpTip";
import { SOCIAL_TIPS } from "@/lib/help-tips";
import { getUtmConfig } from "@/lib/social/utm";
import { formatInZone, getQueue } from "@/lib/social/slots";
import { saveUtmSettingsAction } from "@/app/actions/social";
import { queueSocialPostAction, queueAllDraftsAction, syncSocialPerformanceAction } from "@/app/actions/social-slots";
import {
  createCampaignAction,
  toggleCampaignAction,
  approveSocialPostAction,
  requestChangesSocialPostAction,
  submitForApprovalAction,
  saveSocialWorkflowSettingsAction,
  importSocialCsvAction,
} from "@/app/actions/social-workflow";
import { networkFor } from "@/lib/social/networks";
import {
  publishNowAction,
  cancelScheduledAction,
  deleteSocialPostAction,
  duplicateSocialPostAction,
} from "@/app/actions/social";

// Social scheduler — compose once, fan out to connected accounts, post now or
// schedule. Publishing runs through Zernio; the scheduler sweep sends due posts.

type SP = { ok?: string; err?: string; view?: string };

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  scheduled: { bg: "var(--blue-soft)", fg: "var(--blue-on)", label: "scheduled" },
  publishing: { bg: "var(--amber-soft)", fg: "var(--amber-on)", label: "publishing" },
  posted: { bg: "var(--green-soft)", fg: "var(--green-on)", label: "posted" },
  partial: { bg: "var(--amber-soft)", fg: "var(--amber-on)", label: "partly posted" },
  failed: { bg: "var(--rose-soft)", fg: "var(--rose-on)", label: "failed" },
  draft: { bg: "var(--panel)", fg: "var(--mute)", label: "draft" },
};

export default async function SocialPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { workspace, membership } = await requireRole("EDITOR");
  const { ok, err, view } = await searchParams;
  // Calendar is the natural primary view for a scheduler; agenda stays one click away.
  const mode = view === "agenda" ? "agenda" : "calendar";

  const [accounts, posts, topicRows, campaigns] = await Promise.all([
    db.zernioAccount.findMany({
      where: { workspaceId: workspace.id, status: "connected" },
      orderBy: { createdAt: "asc" },
      select: { id: true, platform: true, displayName: true, username: true },
    }),
    db.socialPost.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      include: {
        targets: true,
        topic: { select: { name: true } },
        campaign: { select: { name: true, color: true } },
        recycledFrom: { select: { id: true } },
      },
      take: 100,
    }),
    db.topic.findMany({
      where: { workspaceId: workspace.id, status: "active" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, keywords: true },
    }),
    db.campaign.findMany({
      where: { workspaceId: workspace.id },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
  ]);
  const topics = topicRows.map((t) => ({ id: t.id, name: t.name, keywords: readJson<string[]>(t.keywords, []) }));
  // Composer works in {id, provider, name}; `provider` is the Zernio platform slug.
  const composerAccounts = accounts.map((a) => ({
    id: a.id,
    provider: a.platform,
    name: a.displayName ?? a.username,
  }));
  const [utm, queue, requireApproval, evergreenFill, autoImage] = await Promise.all([
    getUtmConfig(workspace.id),
    getQueue(workspace.id),
    getSetting("social:require_approval", workspace.id).catch(() => "").then((v) => v === "true"),
    getSetting("social:evergreen_fill", workspace.id).catch(() => "").then((v) => v === "true"),
    // Default-ON: only an explicit "false" turns auto-image off.
    getSetting("social:auto_image", workspace.id).catch(() => "").then((v) => v !== "false"),
  ]);
  const isAdmin = canAdmin(membership.role);
  const activeCampaigns = campaigns.filter((c) => c.status === "active");
  // Slot categories that actually exist drive the composer's picker.
  const slotCategories = [...new Set(queue.slots.map((s) => s.category).filter((c): c is string => Boolean(c)))];

  // Slot instants are resolved here (the server owns the posting timezone) and
  // handed to the calendar as ISO, which buckets them by the VIEWER's local day.
  const freeSlotIso = queue.free.slice(0, 60).map((s) => s.at.toISOString());
  const nextFreeLabel = queue.free[0] ? formatInZone(queue.free[0].at, queue.timeZone) : null;
  const hasSlots = queue.slots.some((s) => s.enabled);

  const scheduled = posts
    .filter((p) => p.status === "scheduled")
    .sort((a, b) => (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0));
  // A held post is technically a draft; it lives in its own section so the
  // review queue is one glance, not a hunt through drafts.
  const awaiting = posts.filter((p) => p.approval === "pending");
  const drafts = posts.filter((p) => p.status === "draft" && p.approval !== "pending");
  const history = posts.filter((p) => ["posted", "partial", "failed", "publishing"].includes(p.status));

  // Group scheduled by day for the agenda. Rendered on the server, so the day
  // (and the times inside PostCard) must be read in the workspace's posting
  // timezone — Railway is UTC, and an evening post would otherwise sit under
  // tomorrow's heading. The calendar solves the same problem in the browser.
  const byDay = new Map<string, typeof scheduled>();
  for (const p of scheduled) {
    const day = p.scheduledAt!.toLocaleDateString("en-GB", {
      timeZone: queue.timeZone, weekday: "long", day: "2-digit", month: "short",
    });
    (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(p);
  }

  return (
    <div className="w-full">
      <div className="flex items-center gap-3 mb-4">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--purple-soft)", color: "var(--purple-on)" }}>
          <Share2 className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div className="flex-1 min-w-0">
          <h1 className="font-mono font-bold text-2xl leading-tight">Social scheduler</h1>
          <p className="text-xs text-[var(--mute)]">Compose once, publish to your connected profiles now or on a schedule.</p>
        </div>
        <Link href="/admin/connections" className="btn sm">Manage accounts</Link>
      </div>

      {ok && <Banner kind="ok" text={ok} />}
      {err && <Banner kind="err" text={err} />}

      <SocialComposer
        accounts={composerAccounts}
        topics={topics}
        campaigns={activeCampaigns.map((c) => ({ id: c.id, name: c.name, color: c.color }))}
        categories={slotCategories}
        approvalNotice={requireApproval && !isAdmin}
        queue={{ nextFree: nextFreeLabel, hasSlots }}
      />

      <PostingSchedule
        slots={queue.slots}
        timeZone={queue.timeZone}
        timeZoneConfigured={queue.timeZoneConfigured}
        canEdit={canAdmin(membership.role)}
        nextFree={nextFreeLabel}
      />

      {/* Link tagging — makes social traffic attributable in GA4, which is what
          lets Insights tell LinkedIn clicks apart from X clicks. */}
      <details className="card mb-6">
        <summary className="cursor-pointer text-sm font-semibold flex items-center gap-2">
          <LinkIcon className="w-4 h-4" style={{ color: "var(--blue-on)" }} />
          Link tagging (UTM)
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: utm.enabled ? "var(--green-soft)" : "var(--zebra)", color: utm.enabled ? "var(--green-on)" : "var(--mute)" }}>
            {utm.enabled ? "on" : "off"}
          </span>
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
            Workflow
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: requireApproval ? "var(--green-soft)" : "var(--zebra)", color: requireApproval ? "var(--green-on)" : "var(--mute)" }}>
              approval {requireApproval ? "on" : "off"}
            </span>
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: evergreenFill ? "var(--green-soft)" : "var(--zebra)", color: evergreenFill ? "var(--green-on)" : "var(--mute)" }}>
              evergreen fill {evergreenFill ? "on" : "off"}
            </span>
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: autoImage ? "var(--green-soft)" : "var(--zebra)", color: autoImage ? "var(--green-on)" : "var(--mute)" }}>
              auto-image {autoImage ? "on" : "off"}
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
            <div><SubmitButton className="btn sm" pendingText="Saving…">Save workflow</SubmitButton></div>
          </form>
        </details>
      )}

      {/* Bulk import */}
      <details className="card mb-6">
        <summary className="cursor-pointer text-sm font-semibold flex items-center gap-2">
          <FileUp className="w-4 h-4" style={{ color: "var(--violet-on)" }} />
          Import from CSV
          <HelpTip text={SOCIAL_TIPS.csvImport} side="bottom" wide />
        </summary>
        <p className="text-[11px] text-[var(--mute)] mt-2 mb-2 leading-relaxed">
          One post per row, up to 200 rows. Header row required; columns:{" "}
          <code className="font-mono">text</code> (required),{" "}
          <code className="font-mono">scheduledAt</code> (e.g. 2026-08-10T09:00),{" "}
          <code className="font-mono">networks</code> (e.g. facebook|linkedin — empty = all),{" "}
          <code className="font-mono">campaign</code> (by name),{" "}
          <code className="font-mono">category</code>,{" "}
          <code className="font-mono">evergreen</code> (true/false),{" "}
          <code className="font-mono">recycleEveryDays</code>. Rows without a date land as drafts.
        </p>
        <form action={importSocialCsvAction} className="flex flex-wrap items-center gap-2" encType="multipart/form-data">
          <input type="file" name="file" accept=".csv,text/csv" required className="text-xs" />
          <SubmitButton className="btn sm" pendingText="Importing…">Import</SubmitButton>
        </form>
      </details>

      {/* Awaiting approval — always visible, above the view toggle: a review
          queue nobody sees is a review queue nobody clears. */}
      {awaiting.length > 0 && (
        <>
          <Section icon={<ShieldCheck className="w-4 h-4" style={{ color: "var(--amber-on)" }} />} title="Awaiting approval" count={awaiting.length} />
          <div className="flex flex-col gap-2 mb-6">
            {awaiting.map((p) => (
              <PostCard key={p.id} post={p} timeZone={queue.timeZone} isAdmin={isAdmin} approvalOn={requireApproval} />
            ))}
          </div>
        </>
      )}

      {/* View toggle — calendar (default) or the original agenda. */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Link href="/social?view=calendar" className={`btn sm ${mode === "calendar" ? "primary" : ""}`}>Calendar</Link>
        <Link href="/social?view=agenda" className={`btn sm ${mode === "agenda" ? "primary" : ""}`}>Agenda</Link>
        <span className="flex-1" />
        {drafts.length > 0 && hasSlots && (
          <form action={queueAllDraftsAction}>
            <SubmitButton className="btn sm" pendingText="Queueing…" title="Fill the free slots with drafts, oldest first">
              <ListPlus className="w-3.5 h-3.5" /> Queue all {drafts.length} draft{drafts.length === 1 ? "" : "s"}
            </SubmitButton>
          </form>
        )}
      </div>

      {mode === "calendar" && (
        <SocialCalendar
          posts={[...scheduled, ...drafts].map((p): CalendarPost => ({
            id: p.id,
            text: p.text,
            scheduledAt: p.scheduledAt ? p.scheduledAt.toISOString() : null,
            providers: [...new Set(p.targets.map((t) => t.provider.toUpperCase()))],
            status: p.status,
          }))}
          freeSlots={freeSlotIso}
        />
      )}

      {mode === "agenda" && (<>
      {/* Scheduled — agenda grouped by day */}
      <Section icon={<CalendarClock className="w-4 h-4" style={{ color: "var(--blue-on)" }} />} title="Scheduled" count={scheduled.length} />
      {scheduled.length === 0 ? (
        <Empty text="Nothing scheduled. Use the composer above and pick “Schedule”." />
      ) : (
        [...byDay.entries()].map(([day, items]) => (
          <div key={day} className="mb-4">
            <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--mute)] mb-2">{day}</div>
            <div className="flex flex-col gap-2">
              {items.map((p) => <PostCard key={p.id} post={p} canQueue={hasSlots} timeZone={queue.timeZone} isAdmin={isAdmin} approvalOn={requireApproval} />)}
            </div>
          </div>
        ))
      )}

      {drafts.length > 0 && (
        <>
          <Section icon={<Clock className="w-4 h-4" style={{ color: "var(--mute)" }} />} title="Drafts" count={drafts.length} />
          <div className="flex flex-col gap-2 mb-6">{drafts.map((p) => <PostCard key={p.id} post={p} canQueue={hasSlots} timeZone={queue.timeZone} isAdmin={isAdmin} approvalOn={requireApproval} />)}</div>
        </>
      )}

      </>)}

      <div className="flex items-end gap-2 flex-wrap">
        <Section icon={<Send className="w-4 h-4" style={{ color: "var(--green-on)" }} />} title="History" count={history.length} />
        <span className="flex-1" />
        {history.length > 0 && (
          <form action={syncSocialPerformanceAction} className="mb-2">
            <SubmitButton className="btn sm" pendingText="Pulling…" title="Pull likes, comments, shares and impressions back from each network">
              <BarChart3 className="w-3.5 h-3.5" /> Pull engagement
            </SubmitButton>
          </form>
        )}
      </div>
      {history.length === 0 ? (
        <Empty text="Posts you publish appear here with per-network status." />
      ) : (
        <div className="flex flex-col gap-2">{history.map((p) => <PostCard key={p.id} post={p} timeZone={queue.timeZone} isAdmin={isAdmin} approvalOn={requireApproval} />)}</div>
      )}
    </div>
  );
}

type PostRow = {
  id: string;
  text: string;
  mediaKeys: string;
  status: string;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  topic: { name: string } | null;
  campaign: { name: string; color: string | null } | null;
  category: string | null;
  evergreen: boolean;
  recycleEveryDays: number;
  timesRecycled: number;
  recycledFrom: { id: string } | null;
  approval: string | null;
  reviewNote: string | null;
  targets: { id: string; provider: string; accountName: string | null; text: string | null; mediaKeys: string | null; status: string; error: string | null }[];
};

/** How many images a JSON key array holds (0 for null/malformed). */
function countKeys(raw: string | null): number {
  if (!raw) return 0;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

function PostCard({
  post, canQueue = false, timeZone, isAdmin = false, approvalOn = false,
}: {
  post: PostRow; canQueue?: boolean; timeZone: string; isAdmin?: boolean; approvalOn?: boolean;
}) {
  const s = STATUS_STYLE[post.status] ?? STATUS_STYLE.draft;
  const when = post.scheduledAt ?? post.publishedAt;
  const canRetry = post.status === "failed" || post.status === "partial";
  const held = post.approval === "pending" || post.approval === "changes";
  // Held posts hide the send buttons — the server refuses anyway, but showing
  // controls that always fail reads as broken rather than as governed.
  const unsent = (post.status === "draft" || post.status === "scheduled") && !held;
  return (
    <div className="card">
      <div className="flex items-center gap-2 flex-wrap mb-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: s.bg, color: s.fg }}>{s.label}</span>
        {post.approval === "pending" && (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
            <ShieldCheck className="w-2.5 h-2.5" /> awaiting approval
          </span>
        )}
        {post.approval === "changes" && (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded-full" title={post.reviewNote ?? undefined} style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>
            <ShieldCheck className="w-2.5 h-2.5" /> changes requested
          </span>
        )}
        {post.topic && (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--violet-soft)", color: "var(--violet-on)" }}>
            <Tags className="w-2.5 h-2.5" /> {post.topic.name}
          </span>
        )}
        {post.campaign && (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--blue-soft)", color: "var(--blue-on)" }}>
            <Megaphone className="w-2.5 h-2.5" /> {post.campaign.name}
          </span>
        )}
        {post.category && (
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--panel)", color: "var(--mute)" }}>
            {post.category}
          </span>
        )}
        {post.evergreen && (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded-full" title={`Recycles every ${post.recycleEveryDays} days${post.timesRecycled ? ` · recycled ${post.timesRecycled}×` : ""}`} style={{ background: "var(--green-soft)", color: "var(--green-on)" }}>
            <Recycle className="w-2.5 h-2.5" /> evergreen
          </span>
        )}
        {post.recycledFrom && (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded-full" title="Automatically recycled from an evergreen post" style={{ background: "var(--panel)", color: "var(--mute)" }}>
            <Recycle className="w-2.5 h-2.5" /> recycled
          </span>
        )}
        {when && (
          <span className="font-mono text-[11px] text-[var(--mute)]">
            {post.scheduledAt ? "for " : "at "}
            {when.toLocaleString("en-GB", { timeZone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        <span className="flex-1" />
        {/* Approval decisions — admin only, on held posts. */}
        {post.approval === "pending" && isAdmin && (
          <>
            <form action={approveSocialPostAction}>
              <input type="hidden" name="id" value={post.id} />
              <button className="btn sm primary" title={post.scheduledAt ? "Approve — it keeps its requested time" : "Approve — it becomes a normal draft"}>
                <Check className="w-3.5 h-3.5" /> Approve
              </button>
            </form>
            <form action={requestChangesSocialPostAction} className="inline-flex items-center gap-1">
              <input type="hidden" name="id" value={post.id} />
              <input name="note" placeholder="What needs to change?" maxLength={500} className="text-xs w-44 border border-[var(--line-2)] rounded-lg px-1.5 py-1" />
              <button className="btn sm" title="Send it back with a note"><X className="w-3.5 h-3.5" /> Request changes</button>
            </form>
          </>
        )}
        {/* A pre-workflow draft enters review here. */}
        {approvalOn && !isAdmin && post.approval === null && (post.status === "draft" || post.status === "scheduled") && (
          <form action={submitForApprovalAction}>
            <input type="hidden" name="id" value={post.id} />
            <button className="btn sm" title="Send to an admin for approval"><ShieldCheck className="w-3.5 h-3.5" /> Submit for approval</button>
          </form>
        )}
        {/* Queue = the schedule picks the time. Always available without a
            drag, which is what keeps calendar DnD an enhancement. */}
        {unsent && canQueue && !(approvalOn && !isAdmin && post.approval === null) && (
          <form action={queueSocialPostAction}>
            <input type="hidden" name="id" value={post.id} />
            <button className="btn sm" title="Move to the next free slot on the posting schedule">
              <ListPlus className="w-3.5 h-3.5" /> Queue
            </button>
          </form>
        )}
        {unsent && !(approvalOn && !isAdmin) && (
          <form action={publishNowAction}>
            <input type="hidden" name="id" value={post.id} />
            <button className="btn sm" title="Publish immediately"><Send className="w-3.5 h-3.5" /> Post now</button>
          </form>
        )}
        {canRetry && (
          <form action={publishNowAction}>
            <input type="hidden" name="id" value={post.id} />
            <button className="btn sm" title="Retry the legs that failed"><RotateCw className="w-3.5 h-3.5" /> Retry</button>
          </form>
        )}
        {post.status === "scheduled" && (
          <form action={cancelScheduledAction}>
            <input type="hidden" name="id" value={post.id} />
            <button className="btn sm" title="Move to drafts">Cancel</button>
          </form>
        )}
        {/* Held posts stay EDITABLE — editing is how changes-requested gets
            answered; it resubmits automatically. Only sending is locked. */}
        {(post.status === "draft" || post.status === "scheduled") && (
          <Link href={`/social/${post.id}/edit`} className="btn sm" title={held ? "Edit and resubmit for approval" : "Edit text, targets, schedule"}>
            <Pencil className="w-3.5 h-3.5" /> Edit
          </Link>
        )}
        <form action={duplicateSocialPostAction}>
          <input type="hidden" name="id" value={post.id} />
          <button className="btn sm" title="Duplicate"><Copy className="w-3.5 h-3.5" /></button>
        </form>
        <form action={deleteSocialPostAction}>
          <input type="hidden" name="id" value={post.id} />
          <button className="btn sm" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
        </form>
      </div>
      <p className="text-sm text-[var(--slate)] whitespace-pre-wrap mb-1">{post.text || <span className="text-[var(--mute)] italic">(image only)</span>}</p>
      {post.approval === "changes" && post.reviewNote && (
        <p className="text-xs rounded-lg px-2 py-1.5 mb-2" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>
          Reviewer: {post.reviewNote}
        </p>
      )}
      {countKeys(post.mediaKeys) > 0 && (
        <p className="font-mono text-[10px] text-[var(--mute)] mb-2 inline-flex items-center gap-1">
          <ImageIcon className="w-3 h-3" /> {countKeys(post.mediaKeys)} base image{countKeys(post.mediaKeys) > 1 ? "s" : ""}
        </p>
      )}
      {/* Per-network overrides — customized text and/or images. */}
      {post.targets.some((t) => t.text || t.mediaKeys) && (
        <div className="flex flex-col gap-1 mb-2">
          {post.targets.filter((t) => t.text || t.mediaKeys).map((t) => {
            const net = networkFor(t.provider);
            const imgs = countKeys(t.mediaKeys);
            return (
              <div key={t.id} className="text-xs text-[var(--slate)] border-l-2 pl-2" style={{ borderColor: net?.color ?? "var(--line-2)" }}>
                <span className="font-mono text-[10px] uppercase tracking-wider mr-1" style={{ color: net?.color ?? "var(--mute)" }}>{net?.label ?? t.provider}</span>
                {t.text ? <span className="whitespace-pre-wrap">{t.text}</span> : <span className="text-[var(--mute)] italic">base text</span>}
                {imgs > 0 && (
                  <span className="font-mono text-[10px] text-[var(--mute)] ml-1.5 inline-flex items-center gap-1">
                    <ImageIcon className="w-3 h-3" /> {imgs} own image{imgs > 1 ? "s" : ""}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {post.targets.map((t) => {
          const net = networkFor(t.provider);
          const posted = t.status === "posted";
          const failed = t.status === "failed";
          return (
            <span key={t.id} className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full border"
              style={{ borderColor: net?.color ?? "var(--line-2)" }}
              title={t.error ?? undefined}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: net?.color ?? "var(--mute)" }} />
              {net?.label ?? t.provider}
              {(t.text || t.mediaKeys) && <Pencil className="w-2.5 h-2.5" style={{ color: "var(--mute)" }} />}
              {posted && <Check className="w-3 h-3" style={{ color: "var(--green-on)" }} />}
              {failed && <X className="w-3 h-3" style={{ color: "var(--rose-on)" }} />}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Section({ icon, title, count }: { icon: React.ReactNode; title: string; count: number }) {
  return (
    <div className="flex items-center gap-2 mb-2 mt-6">
      {icon}
      <h2 className="font-mono font-bold text-sm">{title}</h2>
      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--panel)", color: "var(--mute)" }}>{count}</span>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="card text-xs text-[var(--mute)] mb-2">{text}</div>;
}

function Banner({ kind, text }: { kind: "ok" | "err"; text: string }) {
  const ok = kind === "ok";
  return (
    <div className="card mb-4 flex items-center gap-2 text-sm" style={{ background: ok ? "var(--green-soft)" : "var(--rose-soft)", borderColor: ok ? "var(--green)" : "var(--rose)" }}>
      {ok ? <Check className="w-4 h-4" style={{ color: "var(--green-on)" }} /> : <X className="w-4 h-4" style={{ color: "var(--rose-on)" }} />}
      {text}
    </div>
  );
}
