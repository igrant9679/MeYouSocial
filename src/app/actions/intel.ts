"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { youtubeFor } from "@/lib/youtube";
import { indexIntelChannel } from "@/lib/intel-index";

// Find Similar Channels: searches for channels sharing the same category
// (with the youtube provider, since IntelChannel doesn't have semantic tags).
// ⚠ Everything here spends YouTube quota, which several tenants may share on
// one key — so it is an editor's, not a viewer's (audit IDE-13).
export async function findSimilarChannelsAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
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
      // The API supplies the avatar on every fetch, but the sync dropped it
      // for months — every row was null (owner's ask, 2026-08-26). Heal on
      // update; `?? undefined` so a missing thumb never nulls a stored one.
      // The counts were just read, so they replace the stored ones (IDE-11).
      update: { thumbnailUrl: c.thumbnailUrl ?? undefined, subscribers: c.subscribers, totalViews: BigInt(c.totalViews), videoCount: c.videoCount, lastIndexedAt: new Date() },
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
        thumbnailUrl: c.thumbnailUrl ?? null,
        lastIndexedAt: new Date(),
      },
    });
  }
  revalidatePath(`/intel/channels/${intelChannelId}`);
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
  const { workspace } = await requireRole("EDITOR");
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
  const { workspace } = await requireRole("EDITOR");
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

// "Chat with channel / video" (chatWithEntityAction) retired 2026-09-09 — the
// Intel pages link to the assistant with the entity in the opening message.

/**
 * Re-read one channel and its latest uploads from YouTube (IDE-11): figures
 * were read once at first index and never again. About 4 quota units.
 */
export async function reindexIntelChannelAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const id = String(formData.get("intelChannelId") ?? "");
  const row = await db.intelChannel.findFirst({ where: { id, workspaceId: workspace.id }, select: { id: true, youtubeId: true } });
  if (!row) return;
  const source = await youtubeFor(workspace.id).findChannel(row.youtubeId);
  if (!source) {
    redirect(`/intel/channels/${row.id}?flashErr=${encodeURIComponent("YouTube didn't answer for this channel — check the YouTube key under Settings → Keys, or try again later.")}`);
  }
  await indexIntelChannel(workspace.id, source!);
  revalidatePath(`/intel/channels/${row.id}`);
  redirect(`/intel/channels/${row.id}?flash=${encodeURIComponent("Re-read from YouTube just now.")}`);
}
