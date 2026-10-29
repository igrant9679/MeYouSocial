import Link from "next/link";
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { requireMembership, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { blockingChecks } from "@/lib/blog-gates";
import { getPostingTimeZone, zonedParts, zonedTimeToUtc } from "@/lib/social/slots";
import { zoneLabel } from "@/lib/zoned-dates";
import { requestNow } from "@/lib/request-time";
import { ArticleCalendar, type CalendarArticle, type CalendarCell } from "@/components/ArticleCalendar";

// The articles' publishing calendar (E-ART-07): a month in the POSTING
// timezone — what went out, what is scheduled and when, the publish day each
// week — with the articles waiting at final approval underneath. Admins drag
// one onto a day to schedule it, or off to unschedule. Every scheduled or
// waiting article says what would stop it publishing: a failing check, or no
// website to publish to. It was a list by month in UTC, with nothing scheduled.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default async function BlogCalendarPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { workspace, membership } = await requireMembership();
  const admin = canAdmin(membership.role);
  const sp = await searchParams;
  const tz = await getPostingTimeZone(workspace.id).catch(() => "UTC");
  const now = new Date(requestNow());
  const today = zonedParts(now, tz);
  const asked = /^(\d{4})-(\d{2})$/.exec(sp.month ?? "");
  const [y, mo] = asked && +asked[2] >= 1 && +asked[2] <= 12 ? [+asked[1], +asked[2]] : [today.year, today.month];
  const start = zonedTimeToUtc(y, mo, 1, 0, 0, tz);
  const end = zonedTimeToUtc(y, mo + 1, 1, 0, 0, tz);
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  const keyOf = (at: Date) => { const z = zonedParts(at, tz); return `${z.year}-${pad(z.month)}-${pad(z.day)}`; };
  const timeOf = (at: Date) => { const z = zonedParts(at, tz); return `${pad(Math.floor(z.minute / 60))}:${pad(z.minute % 60)}`; };
  const monthHref = (dy: number, dm: number) => {
    const d = new Date(Date.UTC(dy, dm - 1, 1));
    return `/blog/calendar?month=${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  };

  const [published, scheduled, waiting, wp, publishDayRaw] = await Promise.all([
    db.blogPost.findMany({ where: { workspaceId: workspace.id, status: "published", publishedAt: { gte: start, lt: end } }, orderBy: { publishedAt: "asc" }, select: { id: true, title: true, publishedAt: true }, take: 200 }),
    db.blogPost.findMany({ where: { workspaceId: workspace.id, status: "final_approval", scheduledAt: { gte: start, lt: end } }, orderBy: { scheduledAt: "asc" }, select: { id: true, title: true, scheduledAt: true }, take: 200 }),
    db.blogPost.findMany({ where: { workspaceId: workspace.id, status: "final_approval", scheduledAt: null }, orderBy: { updatedAt: "asc" }, select: { id: true, title: true }, take: 40 }),
    db.wordPressConnection.findUnique({ where: { workspaceId: workspace.id }, select: { baseUrl: true } }),
    getSetting("autopilot:publish_day", workspace.id).catch(() => ""),
  ]);
  const publishDay = /^[0-6]$/.test(publishDayRaw.trim()) ? +publishDayRaw.trim() : null;

  // What would stop each one publishing when it falls due — the same checks
  // publishing re-runs, plus having somewhere to publish to.
  const problemsFor = async (id: string) => {
    const failing = (await blockingChecks(workspace.id, id)) ?? [];
    return wp ? failing : ["no website connected", ...failing];
  };
  const articles: CalendarArticle[] = [
    ...published.map((p) => ({ id: p.id, title: p.title, day: keyOf(p.publishedAt!), time: timeOf(p.publishedAt!), kind: "published" as const, problems: [] })),
    ...(await Promise.all(scheduled.map(async (p) => ({ id: p.id, title: p.title, day: keyOf(p.scheduledAt!), time: timeOf(p.scheduledAt!), kind: "scheduled" as const, problems: await problemsFor(p.id) })))),
    ...(await Promise.all(waiting.map(async (p) => ({ id: p.id, title: p.title, day: null, time: null, kind: "ready" as const, problems: await problemsFor(p.id) })))),
  ];

  const todayKey = `${today.year}-${pad(today.month)}-${pad(today.day)}`;
  const cells: CalendarCell[] = Array.from({ length: daysInMonth }, (_, i) => {
    const key = `${y}-${pad(mo)}-${pad(i + 1)}`;
    const weekday = new Date(Date.UTC(y, mo - 1, i + 1)).getUTCDay();
    return { key, day: i + 1, past: key < todayKey, today: key === todayKey, publishDay: publishDay === weekday };
  });
  const blanks = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7;

  return (
    <main className="p-6 w-full">
      <Link href="/publish" className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Publish
      </Link>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--cyan-soft)", color: "var(--cyan-on)" }}>
          <CalendarDays className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div className="flex-1 min-w-56">
          <h1 className="font-mono font-bold text-2xl leading-tight">Publishing calendar</h1>
          <p className="text-xs text-[var(--mute)] m-0">
            What went out, what&apos;s scheduled, and each week&apos;s publish day — days and times in <b>{tz}</b> ({zoneLabel(tz, start)}).
            {admin ? " Drag an article to a day to schedule it; the checks run again when it falls due." : " An admin schedules articles."}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Link href={monthHref(y, mo - 1)} className="btn sm" aria-label="Previous month"><ChevronLeft className="w-3.5 h-3.5" /></Link>
          <span className="font-mono text-sm font-bold px-2">{MONTHS[mo - 1]} {y}</span>
          <Link href={monthHref(y, mo + 1)} className="btn sm" aria-label="Next month"><ChevronRight className="w-3.5 h-3.5" /></Link>
          {(y !== today.year || mo !== today.month) && <Link href="/blog/calendar" className="btn sm">This month</Link>}
        </div>
      </div>

      {!wp && (scheduled.length > 0 || waiting.length > 0) && (
        <div className="card mb-3 text-xs" style={{ borderColor: "var(--rose)", background: "var(--rose-soft)", color: "var(--rose-on)" }}>
          No website is connected, so nothing here can publish when it falls due.{" "}
          {admin ? <Link href="/admin/connections" className="underline">Connect WordPress</Link> : "An admin connects WordPress under Settings → Connections."}
          {" "}Or publish by hand from each article.
        </div>
      )}
      {publishDay === null && <p className="text-[11px] text-[var(--mute)] mb-2">No publish day is set, so the autopilot publishes on any day; set one under Settings → Automation.</p>}

      <ArticleCalendar key={`${y}-${mo}`} cells={cells} blanks={blanks} articles={articles} canSchedule={admin} />
    </main>
  );
}
