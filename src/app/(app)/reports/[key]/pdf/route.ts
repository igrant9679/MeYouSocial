import { requireMembership } from "@/lib/acl";
import { reportContent, renderReportPdf } from "@/lib/report-pdf";
import { brandingFor } from "@/lib/share-links";

/**
 * PDF export — the client-deliverable version of a report. Text and tables
 * only (charts stay in the app); every number is the same real row the screen
 * shows, and blocks with no data are stated as such rather than omitted.
 *
 * What it says is read by `reportContent` (lib/report-pdf.ts), the same reader
 * the scheduled email uses (E-MEA-03), so the two can't drift apart.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const { workspace } = await requireMembership();
  // The range on screen when Download was pressed (MEA-11).
  const w = parseInt(new URL(req.url).searchParams.get("w") ?? "", 10);
  const content = await reportContent(workspace.id, workspace.name, key, { weeks: [4, 8, 12].includes(w) ? w : undefined });
  if (!content) return new Response("Not found", { status: 404 });
  // White-labelled (E-MEA-14): the workspace's own logo and colour, a cover, page numbers.
  const buf = await renderReportPdf(content, await brandingFor(workspace.id, workspace.name));
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${content.key}-report.pdf"`,
    },
  });
}
