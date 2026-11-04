import { requireMembership } from "@/lib/acl";
import { reportContent, renderReportPdf } from "@/lib/report-pdf";

/**
 * PDF export — the client-deliverable version of a report. Text and tables
 * only (charts stay in the app); every number is the same real row the screen
 * shows, and blocks with no data are stated as such rather than omitted.
 *
 * What it says is read by `reportContent` (lib/report-pdf.ts), the same reader
 * the scheduled email uses (E-MEA-03), so the two can't drift apart.
 */

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const { workspace } = await requireMembership();
  const content = await reportContent(workspace.id, workspace.name, key);
  if (!content) return new Response("Not found", { status: 404 });
  const buf = await renderReportPdf(content);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${content.key}-report.pdf"`,
    },
  });
}
