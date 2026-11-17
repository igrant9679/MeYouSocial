import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { blockingChecks } from "@/lib/blog-gates";
import { getPostingTimeZone, zonedParts, zonedTimeToUtc } from "@/lib/social/slots";
import { requestNow } from "@/lib/request-time";
import type { CalendarArticle, CalendarCell } from "@/components/ArticleCalendar";

/**
 * One month of the articles' publishing calendar (E-ART-07), laid out in the
 * POSTING timezone: what went out, what is scheduled and when, each week's
 * publish day, and the articles waiting at final approval with no time.
 *
 * Moved out of the Publish → Blog calendar page on 2026-11-17 (the owner's
 * "Yes, regroup tabs") so Distribute → Calendar can show the same month
 * without a second copy of the queries: there were two calendars, and now the
 * posts' calendar has a switch to this one. `base` is the page showing it —
 * the month links stay on that page, so the stage strip never changes under
 * the reader.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export type ArticleMonth = {
  timeZone: string;
  /** The first instant of the month, for naming the zone's offset on that date. */
  start: Date;
  label: string;
  prevHref: string;
  nextHref: string;
  /** Back to the current month — null when this already is it. */
  thisHref: string | null;
  cells: CalendarCell[];
  /** Empty cells before the 1st (weeks start on Monday). */
  blanks: number;
  articles: CalendarArticle[];
  hasSite: boolean;
  /** 0–6 (Sunday = 0), or null when no publish day is set. */
  publishDay: number | null;
  /** Scheduled this month or waiting — what a missing website would stop. */
  pending: number;
};

export async function articleMonth(workspaceId: string, month: string | undefined, base: string): Promise<ArticleMonth> {
  const tz = await getPostingTimeZone(workspaceId).catch(() => "UTC");
  const today = zonedParts(new Date(requestNow()), tz);
  const asked = /^(\d{4})-(\d{2})$/.exec(month ?? "");
  const [y, mo] = asked && +asked[2] >= 1 && +asked[2] <= 12 ? [+asked[1], +asked[2]] : [today.year, today.month];
  const start = zonedTimeToUtc(y, mo, 1, 0, 0, tz);
  const end = zonedTimeToUtc(y, mo + 1, 1, 0, 0, tz);
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  const keyOf = (at: Date) => { const z = zonedParts(at, tz); return `${z.year}-${pad(z.month)}-${pad(z.day)}`; };
  const timeOf = (at: Date) => { const z = zonedParts(at, tz); return `${pad(Math.floor(z.minute / 60))}:${pad(z.minute % 60)}`; };
  const join = base.includes("?") ? "&" : "?";
  const monthHref = (dy: number, dm: number) => {
    const d = new Date(Date.UTC(dy, dm - 1, 1));
    return `${base}${join}month=${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  };

  const [published, scheduled, waiting, wp, publishDayRaw] = await Promise.all([
    db.blogPost.findMany({ where: { workspaceId, status: "published", publishedAt: { gte: start, lt: end } }, orderBy: { publishedAt: "asc" }, select: { id: true, title: true, publishedAt: true }, take: 200 }),
    db.blogPost.findMany({ where: { workspaceId, status: "final_approval", scheduledAt: { gte: start, lt: end } }, orderBy: { scheduledAt: "asc" }, select: { id: true, title: true, scheduledAt: true }, take: 200 }),
    db.blogPost.findMany({ where: { workspaceId, status: "final_approval", scheduledAt: null }, orderBy: { updatedAt: "asc" }, select: { id: true, title: true }, take: 40 }),
    db.wordPressConnection.findUnique({ where: { workspaceId }, select: { baseUrl: true } }),
    getSetting("autopilot:publish_day", workspaceId).catch(() => ""),
  ]);
  const publishDay = /^[0-6]$/.test(publishDayRaw.trim()) ? +publishDayRaw.trim() : null;

  // What would stop each one publishing when it falls due — the same checks
  // publishing re-runs, plus having somewhere to publish to.
  const problemsFor = async (id: string) => {
    const failing = (await blockingChecks(workspaceId, id)) ?? [];
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

  return {
    timeZone: tz,
    start,
    label: `${MONTHS[mo - 1]} ${y}`,
    prevHref: monthHref(y, mo - 1),
    nextHref: monthHref(y, mo + 1),
    thisHref: y !== today.year || mo !== today.month ? base : null,
    cells,
    blanks: (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7,
    articles,
    hasSite: !!wp,
    publishDay,
    pending: scheduled.length + waiting.length,
  };
}
