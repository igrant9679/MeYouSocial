"use server";

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/acl";
import { CHANNEL_COOKIE } from "@/lib/channel";

/** Persist the active-channel cookie. Called from the channel switcher form. */
export async function setActiveChannelAction(formData: FormData) {
  const channelId = String(formData.get("channelId") ?? "");
  const { workspace } = await requireMembership();
  const channel = await db.channel.findFirst({
    where: { id: channelId, workspaceId: workspace.id },
  });
  if (!channel) return;
  const jar = await cookies();
  jar.set(CHANNEL_COOKIE, channel.id, { httpOnly: true, sameSite: "lax", path: "/" });
}
