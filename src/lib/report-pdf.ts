import PDFDocument from "pdfkit";
import { getReport } from "@/lib/report-defs";
import { homeStats, postPerformance, weeklySeries, hasSeriesData } from "@/lib/dashboard-data";
import { db } from "@/lib/db";
import { PRODUCT } from "@/lib/product";
import { complianceFacts, overrideSentence, searchConsoleLine } from "@/lib/report-facts";

/**
 * A report as text — the client-deliverable version. Text and tables only
 * (charts stay in the app); every number is the same real row the screen
 * shows, and blocks with no data are stated as such rather than omitted.
 *
 * One reading, two renderings: the PDF download (`renderReportPdf`) and the
 * scheduled email (`renderReportEmail`, E-MEA-03) say exactly the same
 * things, because both are built from `reportContent`.
 */

export type ReportLine = { text: string; muted?: boolean };
export type ReportSection = { title: string; lines: ReportLine[] };
export type ReportContent = {
  key: string;
  name: string;
  workspaceName: string;
  weeks: number;
  generated: string; // YYYY-MM-DD
  sections: ReportSection[];
  dataNote: string;
};

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Read a report's blocks into sections of lines. Null when the report doesn't exist in this workspace. */
export async function reportContent(workspaceId: string, workspaceName: string, key: string): Promise<ReportContent | null> {
  const report = await getReport(workspaceId, key);
  if (!report) return null;
  const weeks = Math.max(1, Math.round(report.dateRangeDays / 7));
  const [stats, series, perf] = await Promise.all([
    homeStats(workspaceId),
    weeklySeries(workspaceId, weeks),
    postPerformance(workspaceId, 40, { status: "published" }),
  ]);
  const sections: ReportSection[] = [];
  const section = (title: string) => {
    const s: ReportSection = { title, lines: [] };
    sections.push(s);
    return (text: string, muted = false) => s.lines.push(muted ? { text, muted } : { text });
  };

  for (const block of report.blocks) {
    switch (block) {
      case "kpis": {
        const line = section("Key numbers");
        line(`Published this month: ${stats.publishedThisMonth} (${stats.publishedThisMonth - stats.publishedLastMonth >= 0 ? "+" : ""}${stats.publishedThisMonth - stats.publishedLastMonth} vs the same days last month)`);
        line(`Clicks this week: ${stats.clicksThisWeek ?? "not measured"}`);
        line(`Average position, last 28 days (weighted by impressions): ${stats.avgPosition != null ? stats.avgPosition.toFixed(1) : "not measured"} (lower is better)`);
        line(`Open blockers: ${stats.unverifiedCitations} unverified citations, ${stats.postsMissingAssets} posts awaiting images`);
        break;
      }
      case "impressions_chart":
      case "clicks_chart": {
        const isImp = block === "impressions_chart";
        const line = section(isImp ? "Impressions by week" : "Clicks by week");
        if (!hasSeriesData(series)) {
          line("No analytics snapshots recorded yet.", true);
        } else {
          // A week nobody measured says so; it isn't a zero (MEA-04).
          for (const p of series) line(`Week of ${p.label}:  ${(isImp ? p.impressionsMeasured : p.clicksMeasured) ? (isImp ? p.impressions : p.clicks) : "not measured"}`);
        }
        break;
      }
      case "movers": {
        const line = section("Biggest movers — last 28 days vs the 28 before");
        const movers = perf
          .filter((p) => p.position != null && p.prevPosition != null)
          .map((p) => ({ t: p.title, d: p.prevPosition! - p.position!, pos: p.position! }))
          .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
          .slice(0, 6);
        if (!movers.length) line("Needs two snapshots per post to compute movement.", true);
        for (const m of movers) line(`${m.d >= 0 ? "▲" : "▼"} ${Math.abs(m.d).toFixed(1)}  ${m.t} (now ${m.pos.toFixed(1)})`);
        break;
      }
      case "posts_table": {
        const line = section("Published content");
        if (!perf.length) line("Nothing published yet.", true);
        for (const p of perf.slice(0, 12)) {
          line(`${p.title} — ${p.focusKeyword ?? "no keyword"} — pos ${p.position?.toFixed(1) ?? "—"} — ${p.clicks ?? "—"} clicks`);
        }
        break;
      }
      case "compliance": {
        const facts = await complianceFacts(workspaceId);
        const line = section("Editorial compliance");
        line(overrideSentence(facts));
        line(`Citations verified: ${facts.citationsVerified}/${facts.citationsTotal}.`);
        break;
      }
      case "video_table": {
        const renders = await db.videoRender.findMany({ where: { workspaceId }, take: 12, orderBy: { createdAt: "desc" } });
        const line = section("Video renders");
        if (!renders.length) line("No renders yet.", true);
        const spend = renders.filter((r) => r.status === "done").reduce((a, r) => a + (r.costEstimate ?? 0), 0);
        if (renders.length) line(`Estimated spend on completed renders: ${money(spend)} (provider estimates).`);
        for (const r of renders) line(`[${r.status}] ${r.title} — ${r.seconds}s`);
        break;
      }
      default: {
        // Chart-heavy / interactive blocks summarize to a pointer.
        section(block.replace(/_/g, " "))("See this block in the app — it renders live data views that don't reduce to print.", true);
      }
    }
  }

  return {
    key: report.key,
    name: report.name,
    workspaceName,
    weeks,
    generated: new Date().toISOString().slice(0, 10),
    sections,
    dataNote: `Data note: figures come from snapshots recorded in ${PRODUCT} and cover posts published through it (${await searchConsoleLine(workspaceId)}). Nothing in this report is estimated; "not measured" is not zero.`,
  };
}

/** The PDF. */
export async function renderReportPdf(c: ReportContent): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 48 });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
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
  doc.fillColor(ink).font("Helvetica-Bold").fontSize(18).text(c.name, 84, 50);
  doc.fillColor(mute).font("Helvetica").fontSize(9)
    .text(`${c.workspaceName} · last ${c.weeks} weeks · generated ${c.generated} · ${PRODUCT}`, 84, 72);
  doc.moveTo(48, 90).lineTo(547, 90).strokeColor("#E7E9EE").stroke();
  doc.y = 104;
  doc.x = 48;

  for (const s of c.sections) {
    doc.moveDown(0.8);
    doc.fillColor(ink).font("Helvetica-Bold").fontSize(12).text(s.title);
    doc.moveDown(0.3);
    for (const l of s.lines) doc.fillColor(l.muted ? mute : ink).font("Helvetica").fontSize(10).text(l.text);
  }

  doc.moveDown(1.2);
  doc.fillColor(mute).fontSize(8).text(c.dataNote);
  doc.end();
  return done;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The email: the same sections as the PDF, with links to the report and its
 * PDF in the app (recipients are members, so they can open both). Inline
 * styles only — mail clients drop <style>.
 */
export function renderReportEmail(c: ReportContent, opts: { origin: string; cadence: string }): { subject: string; html: string; text: string } {
  const reportUrl = `${opts.origin}/reports/${encodeURIComponent(c.key)}`;
  const pdfUrl = `${reportUrl}/pdf`;
  const subject = `${c.name} — ${c.workspaceName}, ${c.generated}`;
  const sections = c.sections
    .map(
      (s) =>
        `<h2 style="font-size:15px;margin:22px 0 6px;color:#15181D">${esc(s.title)}</h2>` +
        s.lines.map((l) => `<p style="margin:2px 0;font-size:13px;line-height:1.5;color:${l.muted ? "#6B7280" : "#15181D"}">${esc(l.text)}</p>`).join(""),
    )
    .join("");
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:640px;margin:0 auto;color:#15181D">
<h1 style="font-size:20px;margin:0 0 4px">${esc(c.name)}</h1>
<p style="margin:0 0 12px;font-size:12px;color:#6B7280">${esc(c.workspaceName)} · last ${c.weeks} weeks · ${esc(c.generated)} · your ${esc(opts.cadence)} report</p>
<p style="margin:0 0 4px;font-size:13px"><a href="${esc(reportUrl)}" style="color:#E5482F">Open the report</a> · <a href="${esc(pdfUrl)}" style="color:#E5482F">Download the PDF</a> (sign in to open)</p>
${sections}
<p style="margin:24px 0 0;font-size:11px;color:#6B7280">${esc(c.dataNote)}</p>
</div>`;
  const text = [
    c.name,
    `${c.workspaceName} · last ${c.weeks} weeks · ${c.generated} · your ${opts.cadence} report`,
    `Open the report: ${reportUrl}`,
    `Download the PDF: ${pdfUrl}`,
    ...c.sections.flatMap((s) => ["", s.title, ...s.lines.map((l) => `  ${l.text}`)]),
    "",
    c.dataNote,
  ].join("\n");
  return { subject, html, text };
}
