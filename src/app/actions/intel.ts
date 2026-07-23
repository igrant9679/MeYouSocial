"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMembership, requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { youtubeFor } from "@/lib/youtube";

// Find Similar Channels: searches for channels sharing the same category
// (with the youtube provider, since IntelChannel doesn't have semantic tags).
export async function findSimilarChannelsAction(formData: FormData) {
  const { workspace } = await requireMembership();
  const intelChannelId = String(formData.get("intelChannelId"));
  const source = await db.intelChannel.findUnique({ where: { id: intelChannelId } });
  if (!source) return;
  // Try to find more channels via the youtube provider — this auto-indexes new ones.
  const candidates = await youtubeFor(workspace.id).searchChannels(source.category ?? source.name ?? "creator", 6);
  for (const c of candidates) {
    await db.intelChannel.upsert({
      where: { youtubeId: c.id },
      update: {},
      create: {
        youtubeId: c.id,
        handle: c.handle ?? null,
        name: c.name,
        subscribers: c.subscribers,
        totalViews: BigInt(c.totalViews),
        videoCount: c.videoCount,
        language: c.language ?? null,
        category: c.category ?? source.category ?? null,
        lastIndexedAt: new Date(),
      },
    });
  }
  revalidatePath(`/intel/channels/${intelChannelId}`);
}

// Auto-index unindexed @handles. Called from the Intel search box when a
// query looks like a handle and yields no matches.
export async function autoIndexHandleAction(formData: FormData) {
  const { workspace } = await requireMembership();
  const handle = String(formData.get("handle") ?? "").trim();
  if (!handle) return;
  const source = await youtubeFor(workspace.id).findChannel(handle);
  if (!source) return;
  const upserted = await db.intelChannel.upsert({
    where: { youtubeId: source.id },
    update: { lastIndexedAt: new Date() },
    create: {
      youtubeId: source.id,
      handle: source.handle ?? handle,
      name: source.name,
      subscribers: source.subscribers,
      totalViews: BigInt(source.totalViews),
      videoCount: source.videoCount,
      language: source.language ?? null,
      category: source.category ?? null,
      lastIndexedAt: new Date(),
    },
  });
  // Also fetch a handful of videos so the detail page has content.
  const videos = await youtubeFor(workspace.id).listVideos(source.id, 8);
  const avg = videos.reduce((a, v) => a + v.views, 0) / Math.max(1, videos.length);
  for (const v of videos) {
    await db.intelVideo.upsert({
      where: { youtubeId: v.id },
      update: {},
      create: {
        intelChannelId: upserted.id,
        youtubeId: v.id,
        title: v.title,
        publishedAt: new Date(v.publishedAt),
        durationSeconds: v.durationSeconds,
        views: BigInt(v.views),
        likes: v.likes ?? null,
        format: v.format,
        outlierScore: Math.round((v.views / Math.max(1, avg)) * 10) / 10,
        viewsPerSub: Math.round((v.views / Math.max(1, source.subscribers)) * 100) / 100,
      },
    });
  }
  redirect(`/intel/channels/${upserted.id}`);
}

// Chat with channel / video: open a new chat with the entity pre-loaded
// as context. Requires an active channel (the user's own — chat is channel-scoped).
export async function chatWithEntityAction(formData: FormData) {
  const { user } = await requireRole("EDITOR");
  const kind = String(formData.get("kind"));           // "channel" | "video"
  const entityId = String(formData.get("entityId"));
  const { getActiveChannel } = await import("@/lib/channel");
  const { active } = await getActiveChannel();
  if (!active) redirect("/onboarding/channel/new");

  let title = "Chat";
  let ref = entityId;
  let url = "";
  if (kind === "channel") {
    const e = await db.intelChannel.findUnique({ where: { id: entityId } });
    if (!e) return;
    title = `Chat about ${e.name ?? e.handle}`;
    ref = e.youtubeId;
    url = `intel://channel/${e.id}`;
  } else if (kind === "video") {
    const e = await db.intelVideo.findUnique({ where: { id: entityId }, include: { intelChannel: true } });
    if (!e) return;
    title = `Chat about "${e.title}"`;
    ref = e.youtubeId;
    url = `intel://video/${e.id}`;
  }

  const chat = await db.chat.create({
    data: {
      channelId: active!.id,
      userId: user.id,
      type: "ideation",
      title,
      contextItems: { create: { kind: kind === "channel" ? "youtube_channel" : "youtube_url", ref, metadata: JSON.stringify({ url }) } },
      messages: { create: { role: "assistant", content: `Loaded ${kind}: **${title.replace(/^Chat about /, "")}**. Ask me anything about its content strategy, outliers, posting patterns, or how to remix it for your channel.` } },
    },
  });
  redirect(`/chat/${chat.id}`);
}
