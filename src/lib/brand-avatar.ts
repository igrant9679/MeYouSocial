import { db } from "@/lib/db";
import { storage } from "@/lib/storage";

/**
 * The picture a workspace's social accounts show beside their posts, for "Preview as posted" — the workspace's own
 * logo (Workspace.logoKey), then the brand kit's logo (a stored file or an https address), the same order the lockup
 * and the watermark use (lib/images/lockup.ts loadBrandLogo). Null when neither is on file: the preview then draws
 * the account's initial. The networks show the account's own profile picture, which Zernio doesn't hand over — for a
 * brand's accounts that is almost always this logo.
 */
export async function brandAvatarUrl(workspaceId: string): Promise<string | null> {
  const [ws, kit] = await Promise.all([
    db.workspace.findUnique({ where: { id: workspaceId }, select: { logoKey: true } }),
    db.brandKit.findUnique({ where: { workspaceId }, select: { logoUrl: true } }),
  ]);
  if (ws?.logoKey) return storage.url(ws.logoKey);
  const u = kit?.logoUrl?.trim();
  if (!u) return null;
  if (/^\/(?:uploads|api\/files)\//.test(u) || /^https:\/\//i.test(u)) return u;
  return null;
}
