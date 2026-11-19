import Link from "next/link";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { requireMembership, canAdmin } from "@/lib/acl";
import { canFollow } from "@/lib/role-links";
import { zoneLabel } from "@/lib/zoned-dates";
import { articleMonth } from "@/lib/article-calendar";
import { ArticleCalendarBody, ArticleMonthNav } from "@/components/ArticleCalendarView";

// The articles' publishing calendar (E-ART-07): a month in the POSTING
// timezone — what went out, what is scheduled and when, the publish day each
// week — with the articles waiting at final approval underneath. Admins drag
// one onto a day to schedule it, or off to unschedule. Every scheduled or
// waiting article says what would stop it publishing: a failing check, or no
// website to publish to. It was a list by month in UTC, with nothing scheduled.
//
// The month itself is lib/article-calendar.ts since 2026-11-17: Distribute →
// Calendar shows the same one behind its "Articles" switch.

export default async function BlogCalendarPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { workspace, membership } = await requireMembership();
  const admin = canAdmin(membership.role);
  const sp = await searchParams;
  const m = await articleMonth(workspace.id, sp.month, "/blog/calendar");

  return (
    <main className="p-6 w-full">
      <Link href="/publish" className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Articles
      </Link>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--cyan-soft)", color: "var(--cyan-on)" }}>
          <CalendarDays className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div className="flex-1 min-w-56">
          <h1 className="font-mono font-bold text-2xl leading-tight">Publishing calendar</h1>
          <p className="text-xs text-[var(--mute)] m-0">
            What went out, what&apos;s scheduled, and each week&apos;s publish day — days and times in <b>{m.timeZone}</b> ({zoneLabel(m.timeZone, m.start)}).
            {admin ? " Drag an article to a day to schedule it; the checks run again when it falls due." : " An admin schedules articles."}
            {/* One calendar, two kinds of thing: the posts' side is a click away, and shows these articles too. */}
            {canFollow("/social/calendar", membership.role) && <> Social posts are on <Link href="/social/calendar" className="underline" data-calendar-other="posts">Social posts → Calendar</Link>.</>}
          </p>
        </div>
        <ArticleMonthNav m={m} />
      </div>

      <ArticleCalendarBody m={m} admin={admin} />
    </main>
  );
}
