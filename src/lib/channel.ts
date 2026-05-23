import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/acl";

export const CHANNEL_COOKIE = "createup_channel";

/** Resolve the active channel for the current request, defaulting to the cookie-selected one. */
export async function getActiveChannel() {
  const { workspace, membership, user } = await requireMembership();
  const channels = await db.channel.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "asc" },
  });

  if (channels.length === 0) return { workspace, membership, user, channels, active: null };

  const jar = await cookies();
  const fromCookie = jar.get(CHANNEL_COOKIE)?.value;
  const active = channels.find((c) => c.id === fromCookie) ?? channels[0];
  return { workspace, membership, user, channels, active };
}

/** Loader for a specific channel; 404s if it's not in the caller's workspace. */
export async function requireChannel(channelId: string) {
  const { workspace, user, membership } = await requireMembership();
  const channel = await db.channel.findFirst({
    where: { id: channelId, workspaceId: workspace.id },
  });
  if (!channel) notFound();
  return { channel, workspace, user, membership };
}
