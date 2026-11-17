import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ArticleCalendar } from "@/components/ArticleCalendar";
import type { ArticleMonth } from "@/lib/article-calendar";

/**
 * The articles' publishing calendar as two pieces a page drops under its own
 * heading — the month stepper and the month itself with its warnings. Shared
 * by Publish → Blog calendar and by Distribute → Calendar's "Articles" view
 * (2026-11-17), fed by lib/article-calendar.ts `articleMonth`.
 */

export function ArticleMonthNav({ m }: { m: ArticleMonth }) {
  return (
    <div className="flex items-center gap-1">
      <Link href={m.prevHref} className="btn sm" aria-label="Previous month"><ChevronLeft className="w-3.5 h-3.5" /></Link>
      <span className="font-mono text-sm font-bold px-2">{m.label}</span>
      <Link href={m.nextHref} className="btn sm" aria-label="Next month"><ChevronRight className="w-3.5 h-3.5" /></Link>
      {m.thisHref && <Link href={m.thisHref} className="btn sm">This month</Link>}
    </div>
  );
}

export function ArticleCalendarBody({ m, admin }: { m: ArticleMonth; admin: boolean }) {
  return (
    <>
      {!m.hasSite && m.pending > 0 && (
        <div className="card mb-3 text-xs" style={{ borderColor: "var(--rose)", background: "var(--rose-soft)", color: "var(--rose-on)" }}>
          No website is connected, so nothing here can publish when it falls due.{" "}
          {admin ? <Link href="/admin/connections" className="underline">Connect WordPress</Link> : "An admin connects WordPress under Settings → Connections."}
          {" "}Or publish by hand from each article.
        </div>
      )}
      {m.publishDay === null && <p className="text-2xs text-[var(--mute)] mb-2">No publish day is set, so the autopilot publishes on any day; set one under Settings → Automation.</p>}
      <ArticleCalendar key={m.label} cells={m.cells} blanks={m.blanks} articles={m.articles} canSchedule={admin} />
    </>
  );
}
