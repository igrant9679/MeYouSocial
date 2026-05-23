"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";

// FR-CHAN-06 — Channel Memory: durable facts/preferences the AI auto-applies
// across every script in the channel.

export async function addMemoryEntryAction(formData: FormData) {
  const channelId = String(formData.get("channelId"));
  const body = String(formData.get("body") ?? "").trim().slice(0, 600);
  if (!body) return;
  const { workspace } = await requireRole("EDITOR");
  const channel = await db.channel.findFirst({ where: { id: channelId, workspaceId: workspace.id } });
  if (!channel) return;
  await db.channelMemoryEntry.create({ data: { channelId, body } });
  revalidatePath(`/channels/${channelId}/memory`);
}

export async function removeMemoryEntryAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  await db.channelMemoryEntry.deleteMany({
    where: { id, channel: { workspaceId: workspace.id } },
  });
  const channelId = String(formData.get("channelId"));
  revalidatePath(`/channels/${channelId}/memory`);
}
