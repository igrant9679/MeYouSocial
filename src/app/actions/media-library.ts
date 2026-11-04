"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { probeVideo, VIDEO_BYTES, VIDEO_TYPES, videoKind } from "@/lib/media-probe";

// The media library (Socialmonials parity, phase 4, 2026-10-17): images kept
// for reuse, each with the description Caption Studio writes from. Videos too
// since E-SOC-08, each with its length and frame size read from the file.

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MEDIA_BYTES = 15 * 1024 * 1024;

function back(msg: { ok?: string; err?: string }): never {
  redirect(`/social/media?${msg.ok ? `ok=${encodeURIComponent(msg.ok)}` : `err=${encodeURIComponent(msg.err ?? "")}`}`);
}

export async function uploadMediaAction(formData: FormData) {
  const { workspace, user } = await requireRole("EDITOR");
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0).slice(0, 20);
  if (files.length === 0) back({ err: "Choose at least one image or video." });
  const description = String(formData.get("description") ?? "").trim().slice(0, 600) || null;
  let n = 0;
  for (const f of files) {
    const isVideo = VIDEO_TYPES.has(f.type);
    if (!isVideo && !IMAGE_TYPES.has(f.type)) back({ err: `${f.name} isn't a PNG, JPEG, GIF or WebP image, or an MP4, MOV or WebM video.` });
    if (!isVideo && f.size > MEDIA_BYTES) back({ err: `${f.name} is over 15 MB.` });
    if (isVideo && f.size > VIDEO_BYTES) back({ err: `${f.name} is over ${VIDEO_BYTES / 1024 / 1024} MB.` });
    const bytes = Buffer.from(await f.arrayBuffer());
    if (isVideo && !videoKind(bytes)) back({ err: `${f.name} doesn't read as an MP4, MOV or WebM video.` });
    const facts = isVideo ? await probeVideo(bytes) : null;
    const stored = await storage.put(f.name, bytes, f.type, workspace.id);
    await db.mediaItem.create({
      data: { workspaceId: workspace.id, key: stored.key, name: f.name.slice(0, 200), description, contentType: f.type, durationSec: facts?.durationSec ?? null, width: facts?.width ?? null, height: facts?.height ?? null, createdById: user.id },
    });
    n++;
  }
  revalidatePath("/social/media");
  back({ ok: `Added ${n} file${n === 1 ? "" : "s"} to the library.` });
}

export async function updateMediaAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim().slice(0, 200);
  const description = String(formData.get("description") ?? "").trim().slice(0, 600) || null;
  const r = await db.mediaItem.updateMany({ where: { id, workspaceId: workspace.id }, data: { ...(name ? { name } : {}), description } });
  revalidatePath("/social/media");
  back(r.count ? { ok: "Saved." } : { err: "That image isn't in this library." });
}
