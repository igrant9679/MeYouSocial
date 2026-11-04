import { openShare, brandingFor } from "@/lib/share-links";
import { reportContent, renderReportPdf } from "@/lib/report-pdf";

/** GET /r/<token>/pdf — a shared report's white-labelled PDF (E-MEA-14). The same gate as the page. */

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const share = await openShare(token);
  if (!share || share.kind !== "report") return new Response("This link doesn't open — it may have expired or been turned off.", { status: 404 });
  const content = await reportContent(share.workspaceId, share.workspaceName, share.targetKey);
  if (!content) return new Response("This link doesn't open.", { status: 404 });
  const buf = await renderReportPdf(content, await brandingFor(share.workspaceId, share.workspaceName));
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${content.key}-report.pdf"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
