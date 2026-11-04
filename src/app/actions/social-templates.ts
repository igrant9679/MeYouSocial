"use server";

import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { writeAudit } from "@/lib/governance";
import { storage } from "@/lib/storage";
import { resolveApprovalForCreate } from "@/lib/social/approval-for-create";

// Post templates and copying a post to another workspace (E-SOC-23). A
// template keeps a post's content — words, first comment, images, category —
// and Compose starts from it; the networks are chosen each time. A copy lands
// in another workspace the person also edits, as a draft with no accounts
// (accounts belong to a workspace), its images stored again under that
// workspace so its members can open them.

const back = (to: string, key: "ok" | "err", text: string): never => redirect(`${to}${to.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(text)}`);
const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".mp4": "video/mp4", ".mov": "video/quicktime" };

export async function saveTemplateFromPostAction(formData: FormData) {
  const { workspace, user } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  const here = `/social/${id}`;
  const post = await db.socialPost.findFirst({ where: { id, workspaceId: workspace.id }, select: { text: true, firstComment: true, category: true, mediaKeys: true } });
  if (!post) back("/social/sent", "err", "That post isn't in this workspace.");
  if (await db.socialTemplate.count({ where: { workspaceId: workspace.id } }) >= 100) back(here, "err", "This workspace has 100 templates — delete one under Compose first.");
  const name = String(formData.get("name") ?? "").trim().slice(0, 60) || post!.text.replace(/\s+/g, " ").trim().slice(0, 40) || "Untitled template";
  await db.socialTemplate.create({ data: { workspaceId: workspace.id, name, text: post!.text, firstComment: post!.firstComment, category: post!.category, mediaKeys: post!.mediaKeys || "[]", createdById: user.id } });
  revalidatePath("/social/compose");
  back(here, "ok", `Saved as the template “${name}” — start a post from it under Compose.`);
}

export async function copyPostToWorkspaceAction(formData: FormData) {
  const { workspace, user } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  const here = `/social/${id}`;
  const targetId = String(formData.get("workspaceId") ?? "");
  const post = await db.socialPost.findFirst({ where: { id, workspaceId: workspace.id }, select: { id: true, text: true, firstComment: true, linkToFirstComment: true, category: true, mediaKeys: true } });
  if (!post) back("/social/sent", "err", "That post isn't in this workspace.");
  // The person must edit the target too — an active editor or admin there, and the workspace not deleted.
  const target = await db.membership.findFirst({ where: { userId: user.id, workspaceId: targetId, status: "active", role: { in: ["EDITOR", "ADMIN"] }, workspace: { deletedAt: null } }, select: { role: true, workspace: { select: { id: true, name: true } } } });
  if (!target || target.workspace.id === workspace.id) back(here, "err", "You can only copy to another workspace you edit.");

  // Images and videos: read each and store it again, owned by the target
  // workspace — a video with the length Media measured (E-SOC-08).
  const keys = readJson<string[]>(post!.mediaKeys, []);
  const copied: string[] = [];
  let lost = 0;
  for (const key of keys) {
    const bytes = await storage.get(key).catch(() => null);
    if (!bytes) { lost++; continue; }
    const item = await db.mediaItem.findFirst({ where: { workspaceId: workspace.id, key }, select: { name: true, contentType: true, description: true, durationSec: true, width: true, height: true } });
    const name = item?.name ?? key.split("/").pop() ?? "image";
    const type = item?.contentType ?? TYPES[path.extname(name).toLowerCase()] ?? "application/octet-stream";
    const stored = await storage.put(name, bytes, type, target!.workspace.id);
    copied.push(stored.key);
    await db.mediaItem.create({ data: { workspaceId: target!.workspace.id, key: stored.key, name: name.slice(0, 200), description: item?.description ?? null, contentType: type, durationSec: item?.durationSec ?? null, width: item?.width ?? null, height: item?.height ?? null, createdById: user.id } }).catch(() => undefined);
  }
  // The target's own categories decide whether this one carries over.
  const { listCategories } = await import("@/lib/social/categories");
  const category = post!.category && (await listCategories(target!.workspace.id)).includes(post!.category) ? post!.category : null;
  const gate = await resolveApprovalForCreate(target!.workspace.id, target!.role);
  const copy = await db.socialPost.create({
    data: { workspaceId: target!.workspace.id, createdById: user.id, text: post!.text, firstComment: post!.firstComment, linkToFirstComment: post!.linkToFirstComment, category, mediaKeys: JSON.stringify(copied), source: "manual", status: "draft", approval: gate.approval },
  });
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "social.copied_out", entityType: "social_post", entityId: post!.id, meta: { to: target!.workspace.id, copy: copy.id } });
  await writeAudit({ workspaceId: target!.workspace.id, actorId: user.id, action: "social.copied_in", entityType: "social_post", entityId: copy.id, meta: { from: workspace.id, source: post!.id } });
  back(here, "ok", `Copied to ${target!.workspace.name} as a draft${gate.held ? " (it waits for an admin's approval there)" : ""} — switch to ${target!.workspace.name} to choose its accounts.${lost ? ` ${lost} image${lost === 1 ? "" : "s"} couldn't be read and stayed behind.` : ""}`);
}
