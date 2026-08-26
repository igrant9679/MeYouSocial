"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { youtubeFor } from "@/lib/youtube";
import { writeJson } from "@/lib/db/json";

/**
 * Track a competitor.
 *
 * Accepts either a handle/URL to resolve, or an already-resolved `youtubeId`
 * from the search results — the latter avoids a second lookup and, more
 * importantly, avoids re-resolving a name through `search`, which returns a
 * best guess and can land on a different channel than the one clicked.
 */
export async function addCompetitorAction(formData: FormData) {
  const channelId = String(formData.get("channelId"));
  const handle = String(formData.get("handle") ?? "").trim();
  const youtubeId = String(formData.get("youtubeId") ?? "").trim();
  const back = (msg: string, ok = false) =>
    redirect(`/channels/${channelId}/competitors?${ok ? "flash" : "flashErr"}=${encodeURIComponent(msg)}`);

  if (!handle && !youtubeId) return;
  const { workspace } = await requireRole("EDITOR");
  const channel = await db.channel.findFirst({ where: { id: channelId, workspaceId: workspace.id } });
  if (!channel) return;

  // ⚠ Was `if (!found) return;` — a typo'd handle did nothing at all, with no
  // message and no change on screen. Silence is the worst answer to "why didn't
  // that work"; every branch below says something.
  const found = await youtubeFor(workspace.id).findChannel(youtubeId || handle);
  if (!found) {
    back(`YouTube has no channel matching “${youtubeId || handle}”. Try the @handle exactly as YouTube shows it, or search by name above.`);
  }

  // Tracking the same channel twice used to be possible — `create`, no guard —
  // and duplicates then double-count in every competitor aggregate.
  const existing = await db.competitor.findFirst({ where: { channelId, youtubeId: found!.id } });
  if (existing) {
    back(`${found!.name} is already tracked.`);
  }

  await db.competitor.create({
    data: {
      channelId,
      youtubeHandle: found!.handle ?? (handle || null),
      youtubeId: found!.id,
      metricsSnapshot: writeJson({ subs: found!.subscribers, views: found!.totalViews, name: found!.name, thumb: found!.thumbnailUrl ?? undefined }),
    },
  });
  revalidatePath(`/channels/${channelId}/competitors`);
  back(`Now tracking ${found!.name}${found!.handle ? ` (${found!.handle})` : ""}.`, true);
}

export async function removeCompetitorAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  await db.competitor.deleteMany({
    where: { id, channel: { workspaceId: workspace.id } },
  });
  const channelId = String(formData.get("channelId"));
  revalidatePath(`/channels/${channelId}/competitors`);
}
