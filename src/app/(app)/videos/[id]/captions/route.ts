import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { srtToVtt } from "@/lib/captions";

/**
 * GET /videos/<renderId>/captions?format=srt|vtt — a render's captions as a
 * file (E-VID-08): SRT for most editors and YouTube, WebVTT for the web. Any
 * member may download them; another workspace's render is a 404.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { workspace } = await requireMembership();
  const render = await db.videoRender.findFirst({ where: { id, workspaceId: workspace.id }, select: { title: true, srt: true } });
  if (!render?.srt) return new Response("Not found", { status: 404 });
  const vtt = new URL(req.url).searchParams.get("format") === "vtt";
  const slug = render.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "captions";
  return new Response(vtt ? srtToVtt(render.srt) : render.srt, {
    headers: {
      "Content-Type": vtt ? "text/vtt; charset=utf-8" : "application/x-subrip; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}.${vtt ? "vtt" : "srt"}"`,
      "Cache-Control": "no-store",
    },
  });
}
