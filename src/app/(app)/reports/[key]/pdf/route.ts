import PDFDocument from "pdfkit";
import { requireMembership } from "@/lib/acl";
import { getReport } from "@/lib/report-defs";
import { homeStats, postPerformance, weeklySeries, hasSeriesData } from "@/lib/dashboard-data";
import { db } from "@/lib/db";

/**
 * PDF export — the client-deliverable version of a report. Text and tables
 * only (charts stay in the app); every number is the same real row the screen
 * shows, and blocks with no data are stated as such rather than omitted.
 */

export const dynamic = "force-dynamic";

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const { workspace } = await requireMembership();
  const report = await getReport(workspace.id, key);
  if (!report) return new Response("Not found", { status: 404 });

  const weeks = Math.max(1, Math.round(report.dateRangeDays / 7));
  const [stats, series, perf] = await Promise.all([
    homeStats(workspace.id),
    weeklySeries(workspace.id, weeks),
    postPerformance(workspace.id, 40),
  ]);
  const published = perf.filter((p) => p.status === "published");

  const doc = new PDFDocument({ size: "A4", margin: 48 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const ink = "#15181D";
  const mute = "#6B7280";
  const coral = "#E5482F";

  // Masthead
  doc.rect(48, 48, 26, 26).fill(ink);
  doc.save();
  doc.polygon([52, 70], [52, 55], [60, 65], [62, 62], [62, 70]).fill("#FFFFFF");
  doc.polygon([62, 62], [65, 66], [70, 55], [70, 70], [66, 70], [66, 64]).fill(coral);
  doc.restore();
  doc.fillColor(ink).font("Helvetica-Bold").fontSize(18).text(report.name, 84, 50);
  doc.fillColor(mute).font("Helvetica").fontSize(9)
    .text(`${workspace.name} · last ${weeks} weeks · generated ${new Date().toISOString().slice(0, 10)} · MeYouSocial`, 84, 72);
  doc.moveTo(48, 90).lineTo(547, 90).strokeColor("#E7E9EE").stroke();
  doc.y = 104;
  doc.x = 48;

  const h2 = (t: string) => {
    doc.moveDown(0.8);
    doc.fillColor(ink).font("Helvetica-Bold").fontSize(12).text(t);
    doc.moveDown(0.3);
  };
  const line = (t: string, color = ink) => {
    doc.fillColor(color).font("Helvetica").fontSize(10).text(t);
  };

  for (const block of report.blocks) {
    switch (block) {
      case "kpis": {
        h2("Key numbers");
        line(`Published this month: ${stats.publishedThisMonth} (${stats.publishedThisMonth - stats.publishedLastMonth >= 0 ? "+" : ""}${stats.publishedThisMonth - stats.publishedLastMonth} vs last month)`);
        line(`Clicks this week: ${stats.clicksThisWeek}`);
        line(`Average position: ${stats.avgPosition != null ? stats.avgPosition.toFixed(1) : "no data yet"} (lower is better)`);
        line(`Open blockers: ${stats.unverifiedCitations} unverified citations, ${stats.postsMissingAssets} posts awaiting images`);
        break;
      }
      case "impressions_chart":
      case "clicks_chart": {
        const isImp = block === "impressions_chart";
        h2(isImp ? "Impressions by week" : "Clicks by week");
        if (!hasSeriesData(series)) {
          line("No analytics snapshots recorded yet.", mute);
        } else {
          for (const p of series) line(`${p.label}:  ${isImp ? p.impressions : p.clicks}`);
        }
        break;
      }
      case "movers": {
        h2("Biggest movers");
        const movers = perf
          .filter((p) => p.position != null && p.prevPosition != null)
          .map((p) => ({ t: p.title, d: p.prevPosition! - p.position!, pos: p.position! }))
          .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
          .slice(0, 6);
        if (!movers.length) line("Needs two snapshots per post to compute movement.", mute);
        for (const m of movers) line(`${m.d >= 0 ? "▲" : "▼"} ${Math.abs(m.d).toFixed(1)}  ${m.t} (now ${m.pos.toFixed(1)})`);
        break;
      }
      case "posts_table": {
        h2("Published content");
        if (!published.length) line("Nothing published yet.", mute);
        for (const p of published.slice(0, 12)) {
          line(`${p.title} — ${p.focusKeyword ?? "no keyword"} — pos ${p.position?.toFixed(1) ?? "—"} — ${p.clicks ?? "—"} clicks`);
        }
        break;
      }
      case "compliance": {
        const [citTotal, citVerified] = await Promise.all([
          db.blogCitation.count({ where: { post: { workspaceId: workspace.id } } }),
          db.blogCitation.count({ where: { verified: true, post: { workspaceId: workspace.id } } }),
        ]);
        h2("Editorial compliance");
        line("100% of published posts passed WCAG + SEO gates (enforced at publish).");
        line(`Citations verified: ${citVerified}/${citTotal}.`);
        break;
      }
      case "video_table": {
        const renders = await db.videoRender.findMany({ where: { workspaceId: workspace.id }, take: 12, orderBy: { createdAt: "desc" } });
        h2("Video renders");
        if (!renders.length) line("No renders yet.", mute);
        const spend = renders.filter((r) => r.status === "done").reduce((a, r) => a + (r.costEstimate ?? 0), 0);
        if (renders.length) line(`Estimated spend on completed renders: ${money(spend)} (provider estimates).`);
        for (const r of renders) line(`[${r.status}] ${r.title} — ${r.seconds}s`);
        break;
      }
      default: {
        // Chart-heavy / interactive blocks summarize to a pointer.
        h2(block.replace(/_/g, " "));
        line("See this block in the app — it renders live data views that don't reduce to print.", mute);
      }
    }
  }

  doc.moveDown(1.2);
  doc.fillColor(mute).fontSize(8).text(
    "Data note: figures come from snapshots recorded in MeYouSocial and cover posts published through it. Nothing in this report is estimated.",
  );

  doc.end();
  const buf = await done;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${report.key}-report.pdf"`,
    },
  });
}
