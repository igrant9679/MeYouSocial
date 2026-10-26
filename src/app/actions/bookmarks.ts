"use server";

import { revalidatePath } from "next/cache";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeJson } from "@/lib/db/json";

/** Bookmark a channel or video with optional tags + notes. */
export async function toggleBookmarkAction(formData: FormData) {
  const { workspace } = await requireMembership();
  const intelChannelId = formData.get("intelChannelId") ? String(formData.get("intelChannelId")) : null;
  const intelVideoId = formData.get("intelVideoId") ? String(formData.get("intelVideoId")) : null;
  if (!intelChannelId && !intelVideoId) return;
  // Only this workspace's Intel rows (audit SEC-18): a foreign id was saved and
  // then DISPLAYED, which read another company's research.
  if (intelChannelId && !(await db.intelChannel.findFirst({ where: { id: intelChannelId, workspaceId: workspace.id }, select: { id: true } }))) return;
  if (intelVideoId && !(await db.intelVideo.findFirst({ where: { id: intelVideoId, intelChannel: { workspaceId: workspace.id } }, select: { id: true } }))) return;

  const existing = await db.bookmark.findFirst({
    where: {
      workspaceId: workspace.id,
      intelChannelId,
      intelVideoId,
    },
  });
  if (existing) {
    await db.bookmark.delete({ where: { id: existing.id } });
  } else {
    await db.bookmark.create({
      data: {
        workspaceId: workspace.id,
        intelChannelId,
        intelVideoId,
        tags: writeJson([]),
      },
    });
  }
  revalidatePath("/intel");
  revalidatePath("/intel/bookmarks");
  if (intelChannelId) revalidatePath(`/intel/channels/${intelChannelId}`);
  if (intelVideoId) revalidatePath(`/intel/videos/${intelVideoId}`);
}

export async function updateBookmarkAction(formData: FormData) {
  const id = String(formData.get("id"));
  const notes = String(formData.get("notes") ?? "");
  const tags = String(formData.get("tags") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const { workspace } = await requireMembership();
  await db.bookmark.updateMany({
    where: { id, workspaceId: workspace.id },
    data: { notes, tags: writeJson(tags) },
  });
  revalidatePath("/intel/bookmarks");
}
