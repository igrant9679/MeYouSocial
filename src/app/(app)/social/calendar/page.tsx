import Link from "next/link";
import { CalendarClock, Clock, ListPlus } from "lucide-react";
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

type SP = { ok?: string; err?: string; view?: string };

export default async function SocialCalendarPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { workspace, membership } = await requireRole("EDITOR");
  const { ok, err, view } = await searchParams;
  // Calendar is the natural primary view for a scheduler; agenda stays one click away.
  const mode = view === "agenda" ? "agenda" : "calendar";
  const isAdmin = canAdmin(membership.role);

  const [posts, queue, requireApproval] = await Promise.all([
    db.socialPost.findMany({
      where: { workspaceId: workspace.id, status: { in: ["draft", "scheduled"] } },
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

  const scheduled = posts
    .filter((p) => p.status === "scheduled")
    .sort((a, b) => (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0));
  // Held posts live on Approvals, not here — the calendar is for things that
  // can actually move.
  const drafts = posts.filter((p) => p.status === "draft" && p.approval !== "pending");
  const hasSlots = queue.slots.some((s) => s.enabled);

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
        blurb={`Scheduled and draft posts. Times shown in ${queue.timeZone}${queue.timeZoneConfigured ? "" : " (no timezone set)"}.`}
      >
        <Link href="/social/compose" className="btn sm primary">New post</Link>
      </SocialHeader>

      {ok && <Banner kind="ok" text={ok} />}
      {err && <Banner kind="err" text={err} />}

      {!hasSlots && (
        <div className="card mb-4 text-xs" style={{ borderColor: "var(--amber)" }}>
          No posting slots set, so nothing can be queued automatically — every post needs a hand-picked time.{" "}
          <Link href="/social/settings" className="underline">Set your posting schedule</Link>.
        </div>
      )}

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Link href="/social/calendar?view=calendar" className={`btn sm ${mode === "calendar" ? "primary" : ""}`}>Calendar</Link>
        <Link href="/social/calendar?view=agenda" className={`btn sm ${mode === "agenda" ? "primary" : ""}`}>Agenda</Link>
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

      {mode === "agenda" && (
        <>
          <Section icon={<CalendarClock className="w-4 h-4" style={{ color: "var(--blue-on)" }} />} title="Scheduled" count={scheduled.length} />
          {scheduled.length === 0 ? (
            <Empty text="Nothing scheduled. Compose a post and pick “Schedule”, or queue a draft." />
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
        </>
      )}

      {drafts.length > 0 && (
        <>
          <Section icon={<Clock className="w-4 h-4" style={{ color: "var(--mute)" }} />} title="Drafts" count={drafts.length} />
          <div className="flex flex-col gap-2 mb-6">
            {drafts.map((p) => <PostCard key={p.id} post={p} canQueue={hasSlots} timeZone={queue.timeZone} isAdmin={isAdmin} approvalOn={requireApproval} />)}
          </div>
        </>
      )}
    </div>
  );
}
