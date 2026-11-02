import { db } from "@/lib/db";
import { getCurrentUser, activeWorkspaceIdFor } from "@/lib/acl";
import { toCsv } from "@/lib/csv";
import { COLUMNS } from "@/lib/social/csv-import";
import { getPostingTimeZone } from "@/lib/social/slots";

/**
 * Compose → Import from CSV → Template (E-SOC-16): every column the import
 * reads, with two example rows written for this workspace — its connected
 * networks, its posting zone, a campaign and a media item if it has them.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  const workspaceId = await activeWorkspaceIdFor(user.id);
  if (!workspaceId) return Response.json({ error: "You aren't a member of a workspace." }, { status: 403 });
  const [accounts, campaign, media, tz] = await Promise.all([
    db.zernioAccount.findMany({ where: { workspaceId, status: "connected" }, distinct: ["platform"], select: { platform: true } }),
    db.campaign.findFirst({ where: { workspaceId, status: "active" }, select: { name: true } }),
    db.mediaItem.findFirst({ where: { workspaceId }, orderBy: { createdAt: "desc" }, select: { name: true } }),
    getPostingTimeZone(workspaceId),
  ]);
  const nets = accounts.map((a) => a.platform).slice(0, 2).join("|");
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const csv = toCsv([...COLUMNS], [
    ["Our new guide is out — link in bio", `${day(7)} 09:00`, tz, nets, campaign?.name ?? "", "promo", "false", "", media?.name ?? ""],
    ["A tip worth repeating", "", "", "", "", "tips", "true", "30", ""],
  ]);
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="social-import-template.csv"', "cache-control": "no-store" },
  });
}
