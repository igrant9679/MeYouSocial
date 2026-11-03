import { requireMembership } from "@/lib/acl";
import { getActiveChannel } from "@/lib/channel";
import { studioState } from "@/lib/studio";
import { globalSearch } from "@/lib/global-search";

/**
 * Ctrl+K's search (E-SHL-06): pages this person can open, and this
 * workspace's articles, ideas, posts, Topics and Help answers matching `q`.
 * Any member — a viewer finds what they can read; the pages are filtered by
 * the same gate as the rail.
 */
export async function GET(req: Request) {
  const { workspace, membership } = await requireMembership();
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const [{ active }, studio] = await Promise.all([getActiveChannel(), studioState(workspace.id)]);
  const hits = await globalSearch({ workspaceId: workspace.id, role: membership.role, q, studio: studio.show, channelId: active?.id ?? null });
  return Response.json({ hits }, { headers: { "cache-control": "no-store" } });
}
