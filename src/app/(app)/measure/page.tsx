import { db } from "@/lib/db";
import Link from "next/link";
import { requireMembership, canAdmin, canEdit } from "@/lib/acl";
import { hasSeriesData, postPerformance, unmeasuredWeeks, weeklySeries } from "@/lib/dashboard-data";
import { AreaChart } from "@/components/charts";
import { StageHeader } from "@/components/StageShell";
import { EmptyState } from "@/components/EmptyState";
import { getPostingTimeZone } from "@/lib/social/slots";
import { RangePicker } from "@/components/RangePicker";
import { measureRange, type RangeInput } from "@/lib/measure-range";
import { CsvButton } from "@/components/CsvButton";
import { Banner } from "@/components/SocialPostCard";
import { SubmitButton } from "@/components/SubmitButton";
import { DECAY_DROP, DECAY_MIN_PRIOR_CLICKS, decayingPosts } from "@/lib/content-decay";
import { makeDecayRefreshIdeaAction } from "@/app/actions/content-decay";
import { formatDay } from "@/lib/zoned-dates";
import { marksFor } from "@/lib/chart-annotations";
import { ChartMarkList, ChartNoteForm } from "@/components/ChartMarks";

// Measure stage: the measured numbers only, never invented curves — the same
// Results block Home showed, promoted to a stage with Reports, Insights and
// the two analytics pages as tabs.

export default async function MeasureStage({ searchParams }: { searchParams: Promise<RangeInput & { ok?: string; err?: string }> }) {
  const { workspace, membership } = await requireMembership();
  const sp = await searchParams;
  // One range for all of Measure (E-MEA-01): the curve shows that many whole
  // weeks, ending at the latest day with data (Search Console lags ~2 days).
  const tz = await getPostingTimeZone(workspace.id).catch(() => "UTC");
  const range = await measureRange(sp, tz);
  const weeks = Math.min(52, Math.max(4, Math.round(range.days / 7)));
  const admin = canAdmin(membership.role);
  const editor = canEdit(membership.role);
  const [series, perf, withData, decaying] = await Promise.all([
    weeklySeries(workspace.id, weeks),
    postPerformance(workspace.id, 12, { status: "published" }),
    // Published posts with at least one snapshot — not every row in the table (MEA-09).
    db.blogPost.count({ where: { workspaceId: workspace.id, status: "published", snapshots: { some: {} } } }),
    // E-MEA-15: articles losing clicks — fixed 28-day windows, not the picker's range.
    decayingPosts(workspace.id).catch(() => []),
  ]);
  const hasAnalytics = hasSeriesData(series);
  // E-MEA-04: what happened in each week — publishes, sends, automation changes, notes.
  const marks = hasAnalytics ? await marksFor(workspace.id, series) : [];
  const gaps = unmeasuredWeeks(series, "impressions");
  const latest = series[series.length - 1];

  return (
    <div>
      <StageHeader
        title="Measure"
        sentence={hasAnalytics ? "Search impressions and clicks from Search Console; engagement from the networks." : `No search numbers in the last ${weeks} weeks. Connect Search Console and GA4 under Settings → Analytics, or record them by hand, and the curve fills in as snapshots accrue.`}
        counts={[
          { label: "impressions, latest week", n: hasAnalytics ? latest.impressions : null, href: "/blog/analytics", hue: "blue" },
          { label: "clicks, latest week", n: hasAnalytics ? latest.clicks : null, href: "/blog/analytics", hue: "green" },
          { label: withData === 1 ? "published post with search data" : "published posts with search data", n: withData, href: "/blog/analytics" },
        ]}
      />

      {sp.ok && <Banner kind="ok" text={sp.ok} />}
      {sp.err && <Banner kind="err" text={sp.err} />}

      <RangePicker range={range} path="/measure" note={`The curve is ${weeks} whole weeks to the latest data; the table is each post's own last 28 days.`} />

      <section className="card mb-4">
        {hasAnalytics ? (
          <>
            <AreaChart points={series.map((p) => ({ label: p.label, value: p.impressions }))} color="var(--blue)" title={`Blog impressions — last ${weeks} weeks`} marks={marks} />
            {gaps > 0 && (
              <p className="text-[10px] text-[var(--mute)] mt-1 mb-0">
                {gaps} of the {series.length} weeks recorded nothing — those points sit at zero because there is no measurement, not because the number was zero.
              </p>
            )}
            <ChartMarkList marks={marks} timeZone={tz} canDelete={editor} returnTo="/measure" />
            {editor && <ChartNoteForm timeZone={tz} />}
          </>
        ) : (
          <EmptyState
            variant="inline"
            // ⚠ hasSeriesData looks at the last 8 WEEKS only, so this is not an
            // all-time claim — a workspace whose sync lapsed two months ago has
            // plenty of recorded numbers and still lands here. And /admin/*
            // needs ADMIN, so this button bounced everyone else to /forbidden.
            line={`No search numbers in the last ${weeks} weeks, so there is no curve to draw.`}
            note="A dash here means not measured, never zero — this app does not invent a number it has not been given."
            action={admin
              ? { label: "Connect analytics", href: "/admin/analytics" }
              : editor
                ? { label: "Enter this week's numbers", href: "/blog/analytics" }
                : null}
          />
        )}
        {/* A table where every position is a dash reads as "nothing happened".
            Say which it is before the reader guesses (audit B6). */}
        {perf.length > 0 && perf.every((p) => p.position == null) && (
          <p className="text-[11px] text-[var(--mute)] mt-3 mb-0">
            None of these posts has a recorded position yet — the dashes below are unmeasured, not zero.
          </p>
        )}
        {perf.length > 0 && (
          <div className="overflow-x-auto mt-3">
            <div className="flex justify-end mb-1"><CsvButton table="measure-articles" filename="articles-last-28-days" /></div>
            <table data-csv="measure-articles" className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-[var(--mute)]">
                  <th className="py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)]">Post</th>
                  <th className="py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)] text-right">Pos</th>
                  <th className="py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)] text-right">Δ</th>
                  <th className="py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)] text-right">Clicks</th>
                </tr>
              </thead>
              <tbody>
                {perf.map((p) => {
                  const delta = p.position != null && p.prevPosition != null ? p.prevPosition - p.position : null;
                  return (
                    <tr key={p.id} className="odd:bg-[var(--zebra)]">
                      <td className="py-1.5 px-2 border-b border-[var(--line)]"><Link href={`/blog/${p.id}`} className="font-semibold hover:underline">{p.title}</Link></td>
                      <td className="py-1.5 px-2 border-b border-[var(--line)] text-right font-mono tabular-nums">{p.position?.toFixed(1) ?? "—"}</td>
                      <td className="py-1.5 px-2 border-b border-[var(--line)] text-right font-mono tabular-nums font-bold" style={{ color: delta == null ? "var(--mute)" : delta >= 0 ? "var(--green-on)" : "var(--rose-on)" }}>
                        {delta == null ? "—" : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(1)}`}
                      </td>
                      <td className="py-1.5 px-2 border-b border-[var(--line)] text-right font-mono tabular-nums">{p.clicks ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {decaying.length > 0 && (
        <section className="card mb-4" id="losing-clicks" data-losing-clicks>
          <h2 className="text-sm font-semibold mb-0.5">Losing clicks</h2>
          <p className="text-xs text-[var(--mute)] mt-0 mb-3">
            Articles whose clicks over the 28 days to their latest reading are down {Math.round(DECAY_DROP * 100)}% or more on the 28 days before —
            only where both windows have readings on most days and the earlier one had at least {DECAY_MIN_PRIOR_CLICKS} clicks.
            A refresh idea carries these numbers as its angle; with ideation on, the engine makes them itself.
          </p>
          <ul className="m-0 p-0 list-none flex flex-col gap-2">
            {decaying.map((d) => (
              <li key={d.postId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs border-t border-[var(--line)] pt-2" data-decaying={d.postId}>
                <Link href={`/blog/${d.postId}`} className="font-semibold hover:underline min-w-40 flex-1">{d.title}</Link>
                <span className="font-mono tabular-nums" title={`28 days to ${formatDay(d.windowEnd)} against the 28 before`}>
                  {d.priorClicks} → {d.recentClicks} clicks <b style={{ color: "var(--rose-on)" }}>▼ {Math.round(d.drop * 100)}%</b>
                </span>
                {d.position != null && d.prevPosition != null && (
                  <span className="font-mono tabular-nums text-[var(--mute)]">pos {d.prevPosition.toFixed(1)} → {d.position.toFixed(1)}</span>
                )}
                {d.refreshIdea ? (
                  <Link href={`/ideas?format=article&q=${encodeURIComponent(d.title)}`} className="underline text-[var(--mute)]" data-decay-idea={d.refreshIdea.id}>
                    Refresh idea {d.refreshIdea.status} →
                  </Link>
                ) : !d.refreshable ? (
                  <span className="text-[var(--mute)]">{d.protectedFromRewrite ? "Protected from rewrites" : "No live link to refresh"}</span>
                ) : editor ? (
                  <form action={makeDecayRefreshIdeaAction}>
                    <input type="hidden" name="postId" value={d.postId} />
                    <SubmitButton className="btn text-[11px]" pendingText="Making…">Make a refresh idea</SubmitButton>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
