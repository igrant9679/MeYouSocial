import Link from "next/link";
import { ArrowLeft, FileBarChart, ShieldCheck, TriangleAlert } from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { hasSeriesData, postPerformance, weeklySeries } from "@/lib/dashboard-data";
import { AreaChart, HBars } from "@/components/charts";
import { MOTIF_SEED_BY_KEY, parseMotifs } from "@/lib/motifs";

// The client-facing content report (Spark's agency deliverable, reborn).
// Impressions and clicks are separate panels on purpose — their scales differ
// by an order of magnitude, and a shared axis (or a dual axis) would flatten
// clicks into a floor line. Everything on this page is a real row; where data
// doesn't exist yet the page says so instead of drawing a curve.

export default async function BlogReportPage() {
  const { workspace } = await requireMembership();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthName = now.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const [series, perf, publishedThisMonth, citationsTotal, citationsVerified, reviewPosts, publishedPosts] =
    await Promise.all([
      weeklySeries(workspace.id, 8),
      postPerformance(workspace.id, 40),
      db.blogPost.count({ where: { workspaceId: workspace.id, status: "published", publishedAt: { gte: monthStart } } }),
      db.blogCitation.count({ where: { post: { workspaceId: workspace.id } } }),
      db.blogCitation.count({ where: { verified: true, post: { workspaceId: workspace.id } } }),
      db.blogPost.findMany({
        where: { workspaceId: workspace.id, status: { in: ["draft_review", "final_approval"] } },
        select: { images: { select: { role: true, status: true } } },
      }),
      db.blogPost.findMany({
        where: { workspaceId: workspace.id, status: "published" },
        select: { motifs: true, contentTier: true, audience: true },
      }),
    ]);

  const hasAnalytics = hasSeriesData(series);
  const awaitingAssets = reviewPosts.filter((p) => {
    const ok = (role: string) => p.images.some((i) => i.role === role && i.status === "approved");
    return !ok("featured") || !ok("og");
  }).length;

  // Keyword position buckets from each published post's latest snapshot.
  const positions = perf.filter((p) => p.status === "published" && p.position != null).map((p) => p.position!);
  const buckets = [
    { label: "Top 3", value: positions.filter((x) => x <= 3).length, color: "#1D4ED8" },
    { label: "4 – 10", value: positions.filter((x) => x > 3 && x <= 10).length, color: "#3B82F6" },
    { label: "11 – 20", value: positions.filter((x) => x > 10 && x <= 20).length, color: "#93C5FD" },
    { label: "21 +", value: positions.filter((x) => x > 20).length, color: "#DBEAFE" },
  ];

  // Voice mix: dominant motif per published post (workspace default not re-resolved
  // here — an unset blend is reported as unset, not guessed).
  const motifCounts = new Map<string, number>();
  let motifUnset = 0;
  for (const p of publishedPosts) {
    const dominant = parseMotifs(p.motifs)[0]?.key;
    if (dominant) motifCounts.set(dominant, (motifCounts.get(dominant) ?? 0) + 1);
    else motifUnset++;
  }
  const motifRows = [...motifCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => ({
      label: MOTIF_SEED_BY_KEY.get(key as never)?.label ?? key,
      value,
      color: "var(--violet)",
    }));

  const topContent = perf
    .filter((p) => p.status === "published")
    .sort((a, b) => (b.clicks ?? -1) - (a.clicks ?? -1))
    .slice(0, 8);

  return (
    <main className="p-6 w-full">
      <Link href="/blog" className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Blog
      </Link>
      <div className="flex flex-wrap items-center gap-3 mb-1">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--blue-soft)", color: "var(--blue-on)" }}>
          <FileBarChart className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div className="min-w-40 flex-1">
          <h1 className="font-mono font-bold text-2xl leading-tight">Content report — {monthName}</h1>
          <p className="text-xs text-[var(--mute)]">
            {workspace.name} · generated {now.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} ·
            {" "}data: app analytics{hasAnalytics ? "" : " (no snapshots yet)"} — Search Console not connected
          </p>
        </div>
      </div>
      <p className="text-sm text-[var(--mute)] mb-5">
        {publishedThisMonth} post{publishedThisMonth === 1 ? "" : "s"} published this month ·{" "}
        {citationsVerified}/{citationsTotal} citations verified · every published post passed the WCAG + SEO gates at publish
      </p>

      {/* Traffic — small multiples, one measure per panel */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <section className="card anim-rise ad-1">
          <h2 className="font-mono text-[13px] font-bold mb-2">Impressions / week</h2>
          {hasAnalytics ? (
            <AreaChart points={series.map((p) => ({ label: p.label, value: p.impressions }))} color="var(--blue)" title="Impressions per week" height={130} />
          ) : (
            <EmptyChart />
          )}
        </section>
        <section className="card anim-rise ad-2">
          <h2 className="font-mono text-[13px] font-bold mb-2">Clicks / week</h2>
          {hasAnalytics ? (
            <AreaChart points={series.map((p) => ({ label: p.label, value: p.clicks }))} color="var(--teal)" title="Clicks per week" height={130} />
          ) : (
            <EmptyChart />
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-3 mb-3">
        {/* Top content */}
        <section className="card anim-rise ad-3">
          <h2 className="font-mono text-[13px] font-bold mb-2">Top content</h2>
          {topContent.length === 0 ? (
            <p className="text-xs text-[var(--mute)] py-6 text-center">Nothing published yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-left text-[var(--mute)]">
                    <th className="py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)]">Post</th>
                    <th className="py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)]">Keyword</th>
                    <th className="py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)] text-right">Pos</th>
                    <th className="py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)] text-right">Δ</th>
                    <th className="py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)] text-right">Clicks</th>
                  </tr>
                </thead>
                <tbody>
                  {topContent.map((p) => {
                    const delta = p.position != null && p.prevPosition != null ? p.prevPosition - p.position : null;
                    return (
                      <tr key={p.id} className="odd:bg-[var(--zebra)]">
                        <td className="py-1.5 px-2 border-b border-[var(--line)]">
                          <Link href={`/blog/${p.id}`} className="font-semibold hover:underline">{p.title}</Link>
                        </td>
                        <td className="py-1.5 px-2 border-b border-[var(--line)] text-[var(--mute)]">{p.focusKeyword ?? "—"}</td>
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

        <div className="flex flex-col gap-3">
          {/* Position buckets — ordered magnitude, one blue light→dark */}
          <section className="card anim-rise ad-4">
            <h2 className="font-mono text-[13px] font-bold mb-2">Keyword positions</h2>
            {positions.length === 0 ? (
              <p className="text-xs text-[var(--mute)]">No position data yet — record snapshots under Analytics.</p>
            ) : (
              <HBars rows={buckets} />
            )}
          </section>

          {/* Compliance — icon + words, never color alone */}
          <section className="card anim-rise ad-5">
            <h2 className="font-mono text-[13px] font-bold mb-2">Editorial compliance</h2>
            <ul className="m-0 p-0 text-xs flex flex-col gap-2">
              <li className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 shrink-0" style={{ color: "var(--green-on)" }} />
                <span className="font-mono font-bold tabular-nums" style={{ color: "var(--green-on)" }}>100%</span>
                <span className="text-[var(--mute)]">of published posts passed WCAG + SEO gates (enforced at publish)</span>
              </li>
              <li className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 shrink-0" style={{ color: "var(--green-on)" }} />
                <span className="font-mono font-bold tabular-nums" style={{ color: "var(--green-on)" }}>{citationsVerified}/{citationsTotal}</span>
                <span className="text-[var(--mute)]">citations verified against sources</span>
              </li>
              <li className="flex items-center gap-2">
                <TriangleAlert className="w-4 h-4 shrink-0" style={{ color: awaitingAssets > 0 ? "var(--amber-on)" : "var(--green-on)" }} />
                <span className="font-mono font-bold tabular-nums" style={{ color: awaitingAssets > 0 ? "var(--amber-on)" : "var(--green-on)" }}>{awaitingAssets}</span>
                <span className="text-[var(--mute)]">post{awaitingAssets === 1 ? "" : "s"} in review awaiting images</span>
              </li>
            </ul>
          </section>
        </div>
      </div>

      {/* Voice mix */}
      <section className="card anim-rise ad-6 mb-4">
        <h2 className="font-mono text-[13px] font-bold mb-2">Voice mix — published posts by dominant motif</h2>
        {motifRows.length === 0 ? (
          <p className="text-xs text-[var(--mute)]">
            No published posts carry a motif blend yet{motifUnset > 0 ? ` (${motifUnset} published without one)` : ""}.
            Set blends per post or defaults under Brand &amp; motifs.
          </p>
        ) : (
          <div className="max-w-lg">
            <HBars rows={motifRows} />
            {motifUnset > 0 && <p className="text-[11px] text-[var(--mute)] mt-2">{motifUnset} post{motifUnset === 1 ? "" : "s"} published without an explicit blend.</p>}
          </div>
        )}
      </section>

      <p className="text-[11px] text-[var(--mute)]">
        Honest-data note: position and click figures come from snapshots recorded in this app and only cover posts
        published through it. Connect Google Search Console for site-wide coverage — until then, this report never
        estimates what it can&apos;t measure.
      </p>
    </main>
  );
}

function EmptyChart() {
  return (
    <p className="text-xs text-[var(--mute)] py-8 text-center">
      No snapshots yet — add weekly numbers under <Link href="/blog/analytics" className="underline">Analytics</Link>.
    </p>
  );
}
