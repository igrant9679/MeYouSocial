"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { writeJson } from "@/lib/db/json";
import { publishSocialPost } from "@/lib/social/publish";

// Social scheduler actions. A post fans out to one or more connected social
// accounts (Unipile), either now or at a scheduled time. Media is optional and
// stored via the storage layer; the scheduler/publisher reads it back at send.

const MEDIA_MAX = 4;
const MEDIA_BYTES = 15 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function backTo(msg: string, kind: "err" | "ok" = "err"): never {
  redirect(`/social?${kind === "err" ? "err" : "ok"}=${encodeURIComponent(msg)}`);
}

async function storeMedia(files: FormDataEntryValue[]): Promise<string[]> {
  const keys: string[] = [];
  for (const f of files) {
    if (!(f instanceof File) || f.size === 0) continue;
    if (!IMAGE_TYPES.has(f.type)) backTo("Only PNG, JPEG, GIF or WebP images are supported.");
    if (f.size > MEDIA_BYTES) backTo("Each image must be under 15 MB.");
    const bytes = Buffer.from(await f.arrayBuffer());
    const stored = await storage.put(f.name, bytes, f.type);
    keys.push(stored.key);
    if (keys.length >= MEDIA_MAX) break;
  }
  return keys;
}

export async function createSocialPostAction(formData: FormData) {
  const { workspace, user } = await requireRole("EDITOR");
  const text = String(formData.get("text") ?? "").trim();
  const accountIds = formData.getAll("accountIds").map(String).filter(Boolean);
  const when = String(formData.get("when") ?? "now"); // now | schedule
  const scheduledRaw = String(formData.get("scheduledAt") ?? "");

  if (accountIds.length === 0) backTo("Pick at least one account to post to.");
  const mediaKeys = await storeMedia(formData.getAll("media"));
  if (!text && mediaKeys.length === 0) backTo("Write something or attach an image.");

  // Resolve the selected accounts (workspace-scoped, connected, social).
  const accounts = await db.unipileAccount.findMany({
    where: { id: { in: accountIds }, workspaceId: workspace.id, kind: "social", status: "connected" },
  });
  if (accounts.length === 0) backTo("Those accounts aren't connected. Connect one under Admin → Connections.");

  let scheduledAt: Date | null = null;
  let status = "draft";
  if (when === "schedule") {
    const t = scheduledRaw ? new Date(scheduledRaw) : null;
    if (!t || Number.isNaN(t.getTime())) backTo("Enter a valid date and time to schedule.");
    if (t.getTime() < Date.now() - 60_000) backTo("Scheduled time must be in the future.");
    scheduledAt = t;
    status = "scheduled";
  } else {
    status = "publishing"; // publish immediately below
  }

  // Per-network text overrides: variant_<PROVIDER> from the composer. Empty or
  // identical-to-base overrides are dropped so the target falls back to base.
  const variantFor = (provider: string): string | null => {
    const v = String(formData.get(`variant_${provider.toUpperCase()}`) ?? "").trim();
    return v && v !== text ? v : null;
  };

  // Per-network image overrides: media_<PROVIDER>. Stored once per provider so
  // two accounts on the same network share the upload.
  const mediaByProvider = new Map<string, string | null>();
  for (const provider of new Set(accounts.map((a) => a.provider.toUpperCase()))) {
    const files = formData.getAll(`media_${provider}`);
    const keys = await storeMedia(files);
    mediaByProvider.set(provider, keys.length ? writeJson(keys) : null);
  }

  const post = await db.socialPost.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      text,
      mediaKeys: writeJson(mediaKeys),
      scheduledAt,
      status,
      targets: {
        create: accounts.map((a) => ({
          provider: a.provider,
          unipileAccountId: a.accountId,
          accountName: a.name,
          text: variantFor(a.provider),
          mediaKeys: mediaByProvider.get(a.provider.toUpperCase()) ?? null,
        })),
      },
    },
  });

  if (when !== "schedule") {
    await publishSocialPost(post.id);
    revalidatePath("/social");
    backTo("Post sent — check the queue for per-network status.", "ok");
  }
  revalidatePath("/social");
  backTo("Scheduled.", "ok");
}

export async function publishNowAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  const post = await db.socialPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post || post.status === "posted") backTo("Nothing to publish.");
  await publishSocialPost(post.id);
  revalidatePath("/social");
  backTo("Published — see per-network status below.", "ok");
}

/** Scheduled → draft, so it can be edited/rescheduled instead of firing. */
export async function cancelScheduledAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  await db.socialPost.updateMany({
    where: { id, workspaceId: workspace.id, status: "scheduled" },
    data: { status: "draft", scheduledAt: null },
  });
  revalidatePath("/social");
  backTo("Moved to drafts.", "ok");
}

export async function deleteSocialPostAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  await db.socialPost.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/social");
  backTo("Deleted.", "ok");
}

export async function duplicateSocialPostAction(formData: FormData) {
  const { workspace, user } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  const src = await db.socialPost.findFirst({ where: { id, workspaceId: workspace.id }, include: { targets: true } });
  if (!src) backTo("Not found.");
  await db.socialPost.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      text: src.text,
      mediaKeys: src.mediaKeys,
      status: "draft",
      targets: {
        create: src.targets.map((t) => ({ provider: t.provider, unipileAccountId: t.unipileAccountId, accountName: t.accountName, text: t.text, mediaKeys: t.mediaKeys })),
      },
    },
  });
  revalidatePath("/social");
  backTo("Duplicated to drafts.", "ok");
}
