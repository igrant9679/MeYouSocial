"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";

// The media library (Socialmonials parity, phase 4, 2026-10-17): images kept
// for reuse, each with the description Caption Studio writes from.

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MEDIA_BYTES = 15 * 1024 * 1024;

function back(msg: { ok?: string; err?: string }): never {
  redirect(`/social/media?${msg.ok ? `ok=${encodeURIComponent(msg.ok)}` : `err=${encodeURIComponent(msg.err ?? "")}`}`);
}

export async function uploadMediaAction(formData: FormData) {
  const { workspace, user } = await requireRole("EDITOR");
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0).slice(0, 20);
  if (files.length === 0) back({ err: "Choose at least one image." });
  const description = String(formData.get("description") ?? "").trim().slice(0, 600) || null;
  let n = 0;
  for (const f of files) {
    if (!IMAGE_TYPES.has(f.type)) back({ err: `${f.name} isn't a PNG, JPEG, GIF or WebP image.` });
    if (f.size > MEDIA_BYTES) back({ err: `${f.name} is over 15 MB.` });
    const stored = await storage.put(f.name, Buffer.from(await f.arrayBuffer()), f.type, workspace.id);
    await db.mediaItem.create({ data: { workspaceId: workspace.id, key: stored.key, name: f.name.slice(0, 200), description, contentType: f.type, createdById: user.id } });
    n++;
  }
  revalidatePath("/social/media");
  back({ ok: `Added ${n} image${n === 1 ? "" : "s"} to the library.` });
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
