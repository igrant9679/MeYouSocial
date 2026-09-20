import Link from "next/link";
import { requireMembership } from "@/lib/acl";
import { hasSeriesData, postPerformance, weeklySeries } from "@/lib/dashboard-data";
import { AreaChart } from "@/components/charts";
import { StageHeader } from "@/components/StageShell";
import { EmptyState } from "@/components/EmptyState";

// Measure stage: the measured numbers only, never invented curves — the same
// Results block Home showed, promoted to a stage with Reports, Insights and
// the two analytics pages as tabs.

export default async function MeasureStage() {
  const { workspace } = await requireMembership();
  const [series, perf] = await Promise.all([weeklySeries(workspace.id, 8), postPerformance(workspace.id, 12)]);
  const hasAnalytics = hasSeriesData(series);
  const latest = series[series.length - 1];

  return (
    <div>
      <StageHeader
        title="Measure"
        sentence={hasAnalytics ? "Search impressions and clicks from Search Console; engagement from the networks." : "No search analytics yet — connect Search Console and GA4 under Settings → Analytics and the numbers appear as snapshots accrue."}
        counts={[
          { label: "impressions, latest week", n: hasAnalytics ? latest.impressions : null, href: "/blog/analytics", hue: "blue" },
          { label: "clicks, latest week", n: hasAnalytics ? latest.clicks : null, href: "/blog/analytics", hue: "green" },
          { label: "tracked posts", n: perf.length, href: "/blog/analytics" },
        ]}
      />

      <section className="card mb-4">
        {hasAnalytics ? (
          <AreaChart points={series.map((p) => ({ label: p.label, value: p.impressions }))} color="var(--blue)" title="Blog impressions — last 8 weeks" />
        ) : (
          <EmptyState
            variant="inline"
            line="No search numbers have been recorded for this workspace, so there is no curve to draw."
            note="A dash here means not measured, never zero — this app does not invent a number it has not been given."
            action={{ label: "Connect analytics", href: "/admin/analytics" }}
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
