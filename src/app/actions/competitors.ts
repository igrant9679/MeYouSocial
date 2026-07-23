"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { youtubeFor } from "@/lib/youtube";
import { writeJson } from "@/lib/db/json";

export async function addCompetitorAction(formData: FormData) {
  const channelId = String(formData.get("channelId"));
  const handle = String(formData.get("handle") ?? "").trim();
  if (!handle) return;
  const { workspace } = await requireRole("EDITOR");
  const channel = await db.channel.findFirst({ where: { id: channelId, workspaceId: workspace.id } });
  if (!channel) return;
  const found = await youtubeFor(workspace.id).findChannel(handle);
  if (!found) return;
  await db.competitor.create({
    data: {
      channelId,
      youtubeHandle: found.handle ?? handle,
      youtubeId: found.id,
      metricsSnapshot: writeJson({ subs: found.subscribers, views: found.totalViews }),
    },
  });
  revalidatePath(`/channels/${channelId}/competitors`);
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
