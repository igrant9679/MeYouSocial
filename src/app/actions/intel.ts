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
  // Tenancy in the lookup: Intel is workspace-scoped, so another company's row
  // id must behave exactly like a nonexistent one.
  const source = await db.intelChannel.findFirst({ where: { id: intelChannelId, workspaceId: workspace.id } });
  if (!source) return;
  // Try to find more channels via the youtube provider — this auto-indexes new ones.
  const candidates = await youtubeFor(workspace.id).searchChannels(source.category ?? source.name ?? "creator", 6);
  for (const c of candidates) {
    await db.intelChannel.upsert({
      where: { workspaceId_youtubeId: { workspaceId: workspace.id, youtubeId: c.id } },
      update: {},
      create: {
        workspaceId: workspace.id,
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


/**
 * Index one channel (and a handful of its videos) into the Intel corpus.
 *
 * Shared by the handle path and the keyword path so they can't drift — the
 * outlier maths in particular has to stay identical, since a video's score is
 * only comparable to others computed the same way.
 */
async function indexIntelChannel(
  workspaceId: string,
  source: { id: string; handle?: string; name: string; subscribers: number; videoCount: number; totalViews: number; language?: string; category?: string },
  videoLimit = 8,
) {
  const upserted = await db.intelChannel.upsert({
    where: { workspaceId_youtubeId: { workspaceId, youtubeId: source.id } },
    update: { lastIndexedAt: new Date() },
    create: {
      workspaceId,
      youtubeId: source.id,
      handle: source.handle ?? null,
      name: source.name,
      subscribers: source.subscribers,
      totalViews: BigInt(source.totalViews),
      videoCount: source.videoCount,
      language: source.language ?? null,
      category: source.category ?? null,
      lastIndexedAt: new Date(),
    },
  });
  // ⚠ A channel with zero (or hidden) uploads 404s its uploads playlist —
  // YouTube's way of saying "no videos", not an error worth dying for. One
  // such channel in a keyword batch used to kill the WHOLE indexing loop
  // (guard per item over external resources; the channel row above is still
  // worth keeping — it's real, it just has nothing to score).
  const videos = await youtubeFor(workspaceId).listVideos(source.id, videoLimit).catch((e) => {
    console.warn(`[intel] listVideos failed for ${source.name} (${source.id}) — indexing channel without videos:`, e instanceof Error ? e.message : e);
    return [];
  });
  // Outlier score is views over THIS channel's own average — the same
  // definition used for idea seeds. Never a fabricated figure.
  const avg = videos.reduce((a, v) => a + v.views, 0) / Math.max(1, videos.length);
  for (const v of videos) {
    await db.intelVideo.upsert({
      where: { intelChannelId_youtubeId: { intelChannelId: upserted.id, youtubeId: v.id } },
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
  return upserted;
}

/**
 * Index whatever YouTube returns for a free-text query.
 *
 * ⚠ WHY THIS EXISTS: the Intel search box queries a LOCAL index, and the only
 * way to add to it was to type a query starting with "@". Any other keyword
 * produced "No matches" and no way forward — on an empty index (a fresh
 * install, or one whose fabricated demo corpus was cleared) that made the whole
 * page a dead end, even though `searchChannels` already existed and worked.
 */
export async function indexSearchResultsAction(formData: FormData) {
  const { workspace } = await requireMembership();
  const q = String(formData.get("q") ?? "").trim();
  if (!q) return;
  const back = (msg: string, ok = false) =>
    redirect(`/intel?q=${encodeURIComponent(q)}&${ok ? "flash" : "flashErr"}=${encodeURIComponent(msg)}`);

  // A comma-separated query is N searches, not one: YouTube treats the whole
  // string as a single phrase and returns much weaker results than each term
  // alone. People naturally type topic lists ("grants management, nonprofit
  // grants, …") — honor that. Dedupe by channel id across terms.
  const terms = q.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 8);
  const perTerm = Math.max(3, Math.ceil(6 / terms.length) + 2);
  const seen = new Map<string, Awaited<ReturnType<ReturnType<typeof youtubeFor>["searchChannels"]>>[number]>();
  for (const term of terms) {
    const found = await youtubeFor(workspace.id).searchChannels(term, perTerm).catch(() => []);
    for (const c of found) if (!seen.has(c.id)) seen.set(c.id, c);
  }
  const found = [...seen.values()];
  if (found.length === 0) {
    back(`YouTube returned no channels for “${q}”. Try a broader term, or an @handle for an exact match.`);
  }
  for (const c of found) await indexIntelChannel(workspace.id, c);
  revalidatePath("/intel");
  back(
    `Indexed ${found.length} channel${found.length === 1 ? "" : "s"}${terms.length > 1 ? ` across ${terms.length} searches` : ""} — ${found.map((c) => c.name).slice(0, 3).join(", ")}${found.length > 3 ? "…" : ""}.`,
    true,
  );
}

// Auto-index unindexed @handles. Called from the Intel search box when a
// query looks like a handle and yields no matches.
export async function autoIndexHandleAction(formData: FormData) {
  const { workspace } = await requireMembership();
  const handle = String(formData.get("handle") ?? "").trim();
  if (!handle) return;
  // findChannel resolves a handle EXACTLY; searchChannels returns best guesses.
  // Keep them separate — an exact handle deserves the exact lookup.
  const source = await youtubeFor(workspace.id).findChannel(handle);
  if (!source) {
    redirect(`/intel?q=${encodeURIComponent(handle)}&flashErr=${encodeURIComponent(`YouTube has no channel matching ${handle}.`)}`);
  }
  const upserted = await indexIntelChannel(workspace.id, source!);
  revalidatePath("/intel");
  redirect(`/intel/channels/${upserted.id}`);
}

// Chat with channel / video: open a new chat with the entity pre-loaded
// as context. Requires an active channel (the user's own — chat is channel-scoped).
export async function chatWithEntityAction(formData: FormData) {
  const { user, workspace } = await requireRole("EDITOR");
  const kind = String(formData.get("kind"));           // "channel" | "video"
  const entityId = String(formData.get("entityId"));
  const { getActiveChannel } = await import("@/lib/channel");
  const { active } = await getActiveChannel();
  if (!active) redirect("/onboarding/channel/new");

  let title = "Chat";
  let ref = entityId;
  let url = "";
  if (kind === "channel") {
    const e = await db.intelChannel.findFirst({ where: { id: entityId, workspaceId: workspace.id } });
    if (!e) return;
    title = `Chat about ${e.name ?? e.handle}`;
    ref = e.youtubeId;
    url = `intel://channel/${e.id}`;
  } else if (kind === "video") {
    const e = await db.intelVideo.findFirst({
      where: { id: entityId, intelChannel: { workspaceId: workspace.id } },
      include: { intelChannel: true },
    });
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
