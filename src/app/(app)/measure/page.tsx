import Link from "next/link";
import { requireMembership, canAdmin, canEdit } from "@/lib/acl";
import { hasSeriesData, postPerformance, unmeasuredWeeks, weeklySeries } from "@/lib/dashboard-data";
import { AreaChart } from "@/components/charts";
import { StageHeader } from "@/components/StageShell";
import { EmptyState } from "@/components/EmptyState";

// Measure stage: the measured numbers only, never invented curves — the same
// Results block Home showed, promoted to a stage with Reports, Insights and
// the two analytics pages as tabs.

export default async function MeasureStage() {
  const { workspace, membership } = await requireMembership();
  const admin = canAdmin(membership.role);
  const editor = canEdit(membership.role);
  const [series, perf] = await Promise.all([weeklySeries(workspace.id, 8), postPerformance(workspace.id, 12)]);
  const hasAnalytics = hasSeriesData(series);
  const gaps = unmeasuredWeeks(series, "impressions");
  const latest = series[series.length - 1];

  return (
    <div>
      <StageHeader
        title="Measure"
        sentence={hasAnalytics ? "Search impressions and clicks from Search Console; engagement from the networks." : "No search numbers in the last 8 weeks. Connect Search Console and GA4 under Settings → Analytics, or record them by hand, and the curve fills in as snapshots accrue."}
        counts={[
          { label: "impressions, latest week", n: hasAnalytics ? latest.impressions : null, href: "/blog/analytics", hue: "blue" },
          { label: "clicks, latest week", n: hasAnalytics ? latest.clicks : null, href: "/blog/analytics", hue: "green" },
          { label: "tracked posts", n: perf.length, href: "/blog/analytics" },
        ]}
      />

      <section className="card mb-4">
        {hasAnalytics ? (
          <>
            <AreaChart points={series.map((p) => ({ label: p.label, value: p.impressions }))} color="var(--blue)" title="Blog impressions — last 8 weeks" />
            {gaps > 0 && (
              <p className="text-[10px] text-[var(--mute)] mt-1 mb-0">
                {gaps} of the {series.length} weeks recorded nothing — those points sit at zero because there is no measurement, not because the number was zero.
              </p>
            )}
          </>
        ) : (
          <EmptyState
            variant="inline"
            // ⚠ hasSeriesData looks at the last 8 WEEKS only, so this is not an
            // all-time claim — a workspace whose sync lapsed two months ago has
            // plenty of recorded numbers and still lands here. And /admin/*
            // needs ADMIN, so this button bounced everyone else to /forbidden.
            line="No search numbers in the last 8 weeks, so there is no curve to draw."
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
            <table className="w-full text-xs border-collapse">
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

    </div>
  );
}
