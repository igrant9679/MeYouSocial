import Link from "next/link";
import { CalendarClock, Clock, ListPlus } from "lucide-react";
import { formatZonedMoment, zoneLabel } from "@/lib/zoned-dates";
import { articleMarks, articleMonth } from "@/lib/article-calendar";
import { requestNow } from "@/lib/request-time";
import { ArticleCalendarBody, ArticleMonthNav } from "@/components/ArticleCalendarView";
import { requireRole, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { SocialCalendar, type CalendarPost } from "@/components/SocialCalendar";
import { SubmitButton } from "@/components/SubmitButton";
import { getQueue } from "@/lib/social/slots";
import { queueAllDraftsAction } from "@/app/actions/social-slots";
import { Banner, Empty, PostCard, Section, SocialHeader } from "@/components/SocialPostCard";

// The queue: everything scheduled or drafted, on a grid you can drag, with the
// agenda as the same data listed by day.
//
// ONE calendar, a switch for what it shows (2026-11-17, the owner's "Yes,
// regroup tabs"): there were two calendars under two stages, and someone asking
// "what goes out when" had to know which. `?show=articles` puts the articles'
// publishing month here — the same one as Publish → Article calendar, from
// lib/article-calendar.ts — without leaving this page or its strip.
//
// ONE GRID since 2026-11-18 (the owner's "Yes, build it"): the default view,
// Show: All, puts articles on the posts' grid as read-only marks on the day
// and hour they went out or are due. `?show=posts` is the grid without them;
// `?show=articles` is still the publishing month, where an admin schedules.

type SP = { ok?: string; err?: string; view?: string; net?: string; cat?: string; camp?: string; ghosts?: string; show?: string; month?: string };

type Show = "all" | "posts" | "articles";

/** All, Posts or Articles — the same three links on every view, the current one lit. */
function ShowSwitch({ show }: { show: Show }) {
  const item = (key: Show, href: string, label: string, title: string) => (
    <Link href={href} aria-current={show === key ? "true" : undefined} className={`btn sm ${show === key ? "primary" : ""}`} title={title}>{label}</Link>
  );
  return (
    <div className="inline-flex items-center gap-1" role="group" aria-label="What the calendar shows" data-calendar-show={show}>
      <span className="text-2xs text-[var(--mute)] pr-1">Show</span>
      {item("all", "/social/calendar", "All", "Posts, with articles on the day they went out or are due")}
      {item("posts", "/social/calendar?show=posts", "Posts", "Posts only")}
      {item("articles", "/social/calendar?show=articles", "Articles", "The articles' publishing month — where an admin gives one a date")}
    </div>
  );
}

export default async function SocialCalendarPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { workspace, membership } = await requireRole("EDITOR");
  const { ok, err, view, net, cat, camp, ghosts, show, month } = await searchParams;
  // Calendar is the natural primary view for a scheduler; agenda stays one click away.
  const mode = view === "agenda" ? "agenda" : "calendar";
  const isAdmin = canAdmin(membership.role);
  const showing: Show = show === "articles" ? "articles" : show === "posts" ? "posts" : "all";

  // The articles' month: its own queries only — none of the posts' below run.
  if (show === "articles") {
    const m = await articleMonth(workspace.id, month, "/social/calendar?show=articles");
    return (
      <div className="p-6 w-full">
        <SocialHeader
          icon={<CalendarClock className="w-6 h-6" strokeWidth={2.25} />}
          title="Calendar"
          blurb={`Articles: what went out, what's scheduled, and each week's publish day. Days and times in ${m.timeZone} (${zoneLabel(m.timeZone, m.start)}).${isAdmin ? " Drag an article to a day to schedule it; the checks run again when it falls due." : " An admin schedules articles."}`}
        >
          <ArticleMonthNav m={m} />
        </SocialHeader>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <ShowSwitch show="articles" />
        </div>
        <ArticleCalendarBody m={m} admin={isAdmin} />
      </div>
    );
  }

  // ⚠ Two queries, not one. This was a single `status in [draft, scheduled]`
  // read ordered by createdAt with `take: 200`, split client-side — so 200
  // freshly created drafts pushed every scheduled post out of the window and
  // the agenda announced "Nothing is scheduled" while the queue was full. It
  // is easy to reach: autogen creates its posts as drafts, and under the
  // approval workflow they pile up as `pending`.
  const [scheduled, drafts, queue, requireApproval] = await Promise.all([
    db.socialPost.findMany({
      where: { workspaceId: workspace.id, status: "scheduled" },
      orderBy: { scheduledAt: "asc" },
      include: {
        targets: true,
        topic: { select: { name: true } },
        campaign: { select: { name: true, color: true } },
        recycledFrom: { select: { id: true } },
      },
      take: 200,
    }),
    db.socialPost.findMany({
      // Held posts live on Approvals, not here — the calendar is for things
      // that can actually move.
      // ⚠ `OR [null, not pending]`, never a bare `not` — SQL `<> 'pending'`
      // drops NULL rows, and an un-reviewed draft has approval NULL. This is
      // the documented trap that once silently stopped every normal post.
      where: {
        workspaceId: workspace.id,
        status: "draft",
        OR: [{ approval: null }, { approval: { not: "pending" } }],
      },
      orderBy: { createdAt: "desc" },
      include: {
        targets: true,
        topic: { select: { name: true } },
        campaign: { select: { name: true, color: true } },
        recycledFrom: { select: { id: true } },
      },
      take: 200,
    }),
    getQueue(workspace.id),
    getSetting("social:require_approval", workspace.id).catch(() => "").then((v) => v === "true"),
  ]);
  // Posts awaiting approval, for the calendar only: ghosts that show where
  // review is holding things up (E-SOC-12). The Drafts list below keeps
  // leaving them to Approvals.
  const pending = await db.socialPost.findMany({
    where: { workspaceId: workspace.id, status: "draft", approval: "pending" },
    orderBy: { createdAt: "desc" },
    select: { id: true, text: true, scheduledAt: true, status: true, approval: true, category: true, campaignId: true, targets: { select: { provider: true } }, campaign: { select: { name: true, color: true } } },
    take: 100,
  });
  // Show: All — the articles that have an instant, and how many don't. Posts alone runs neither query.
  const articles = showing === "all" ? await articleMarks(workspace.id) : null;
  const viewHref = (v: "calendar" | "agenda") => `/social/calendar?${showing === "posts" ? "show=posts&" : ""}view=${v}`;
  const now = requestNow();
  const articlesAhead = (articles?.marks ?? []).filter((a) => a.kind === "scheduled" && new Date(a.at).getTime() >= now);
  const hasSlots = queue.slots.some((s) => s.enabled);
  // Queue all leaves held drafts (SOC-04), so its count does too.
  const queueable = drafts.filter((d) => !d.heldAt).length;
  const heldDrafts = drafts.length - queueable;
  type CalendarSource = Pick<(typeof drafts)[number], "id" | "text" | "scheduledAt" | "status" | "approval" | "category" | "campaignId"> & {
    targets: { provider: string }[];
    campaign: { name: string; color: string | null } | null;
  };
  const toCalendar = (p: CalendarSource): CalendarPost => ({
    id: p.id,
    text: p.text,
    scheduledAt: p.scheduledAt ? p.scheduledAt.toISOString() : null,
    providers: [...new Set(p.targets.map((t) => t.provider.toUpperCase()))],
    status: p.status,
    kind: p.status === "scheduled" ? "scheduled" : p.approval === "pending" || p.approval === "changes" ? "held" : p.scheduledAt ? "proposed" : "draft",
    held: p.approval === "pending" ? "pending" : p.approval === "changes" ? "changes" : undefined,
    category: p.category,
    campaign: p.campaign && p.campaignId ? { id: p.campaignId, name: p.campaign.name, color: p.campaign.color } : null,
  });

  // Slot instants are resolved here (the server owns the posting timezone) and
  // handed to the calendar as ISO, which buckets them by the VIEWER's local day.
  const freeSlotIso = queue.free.slice(0, 60).map((s) => s.at.toISOString());

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
    <div className="p-6 w-full">
      <SocialHeader
        icon={<CalendarClock className="w-6 h-6" strokeWidth={2.25} />}
        title="Calendar"
        blurb={`Scheduled and draft posts${articles ? ", with articles on the day they went out or are due" : ""}. Times shown in ${queue.timeZone}${queue.timeZoneConfigured ? "" : " (no timezone set)"}.`}
      >
        <Link href="/social/compose" className="btn sm primary">New post</Link>
      </SocialHeader>

      {ok && <Banner kind="ok" text={ok} />}
      {err && <Banner kind="err" text={err} />}

      {!hasSlots && (
        <div className="card mb-4 text-xs" style={{ borderColor: "var(--amber)" }}>
          No posting slots set, so nothing can be queued automatically — every post needs a hand-picked time.{" "}
          <Link href="/setup/schedule" className="underline">Set your posting schedule</Link>.
        </div>
      )}

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <ShowSwitch show={showing} />
        <span className="w-px h-5 bg-[var(--line)] mx-1" aria-hidden />
        <Link href={viewHref("calendar")} className={`btn sm ${mode === "calendar" ? "primary" : ""}`}>Calendar</Link>
        <Link href={viewHref("agenda")} className={`btn sm ${mode === "agenda" ? "primary" : ""}`}>Agenda</Link>
        <span className="flex-1" />
        {queueable > 0 && hasSlots && (
          <form action={queueAllDraftsAction}>
            <SubmitButton className="btn sm" pendingText="Queueing…" title={`Fill the free slots with drafts, oldest first — a draft that already has a date is scheduled at that date instead${heldDrafts ? `; ${heldDrafts} held draft${heldDrafts === 1 ? " stays" : "s stay"} on Post drafts` : ""}`}>
              <ListPlus className="w-3.5 h-3.5" /> Queue all {queueable} draft{queueable === 1 ? "" : "s"}
            </SubmitButton>
          </form>
        )}
      </div>

      {/* An article with no time has no day to sit on — say so rather than leave it out silently. */}
      {articles && articles.waiting > 0 && (
        <p className="text-2xs text-[var(--mute)] mb-3" data-calendar-waiting={articles.waiting}>
          {articles.waiting} article{articles.waiting === 1 ? " is" : "s are"} at final approval with no publish date, so {articles.waiting === 1 ? "it is" : "they are"} not on this grid.{" "}
          <Link href="/social/calendar?show=articles" className="underline">Show: Articles</Link> lists {articles.waiting === 1 ? "it" : "them"}{isAdmin ? " and is where you give one a date" : ""}.
        </p>
      )}

      {mode === "calendar" && (
        <SocialCalendar
          posts={[...scheduled, ...drafts, ...pending].map(toCalendar)}
          freeSlots={freeSlotIso}
          articles={articles?.marks}
          initialFilter={{ net: net ?? "", cat: cat ?? "", camp: camp ?? "", ghosts: ghosts !== "0" }}
        />
      )}

      {mode === "agenda" && articlesAhead.length > 0 && (
        <div className="mb-4" data-agenda-articles>
          <Section icon={<CalendarClock className="w-4 h-4" style={{ color: "var(--blue-on)" }} />} title="Articles due" count={articlesAhead.length} />
          <ul className="card m-0 list-none flex flex-col gap-1 text-sm">
            {articlesAhead.map((a) => (
              <li key={a.id} className="flex items-baseline gap-2 flex-wrap">
                <span className="font-mono text-2xs text-[var(--mute)] w-44 shrink-0">{formatZonedMoment(new Date(a.at), queue.timeZone)}</span>
                <Link href={`/blog/${a.id}`} className="underline">{a.title}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {mode === "agenda" && (
        <>
          <Section icon={<CalendarClock className="w-4 h-4" style={{ color: "var(--blue-on)" }} />} title="Scheduled" count={scheduled.length} />
          {scheduled.length === 0 ? (
            <Empty text="Nothing is scheduled." note="Compose a post and pick Schedule, or queue an approved draft into the next free slot." to="/social/compose" cta="Compose a post" />
          ) : (
            [...byDay.entries()].map(([day, items]) => (
              <div key={day} className="mb-4">
                <div className="text-2xs font-mono uppercase tracking-wider text-[var(--mute)] mb-2">{day}</div>
                <div className="flex flex-col gap-2">
                  {items.map((p) => <PostCard key={p.id} post={p} returnTo="/social/calendar" canQueue={hasSlots} timeZone={queue.timeZone} isAdmin={isAdmin} approvalOn={requireApproval} />)}
                </div>
              </div>
            ))
          )}
        </>
      )}

      {drafts.length > 0 && (
        <>
          <Section icon={<Clock className="w-4 h-4" style={{ color: "var(--mute)" }} />} title="Drafts" count={drafts.length} />
          <div className="flex flex-col gap-2 mb-6">
            {drafts.map((p) => <PostCard key={p.id} post={p} returnTo="/social/calendar" canQueue={hasSlots} timeZone={queue.timeZone} isAdmin={isAdmin} approvalOn={requireApproval} />)}
          </div>
        </>
      )}
    </div>
  );
}
