"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { writeJson, readJson } from "@/lib/db/json";
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

  // Optional workspace Topic — validated against this workspace so a stale or
  // foreign id can never be attached.
  const topicRaw = String(formData.get("topicId") ?? "").trim();
  let topicId: string | null = null;
  if (topicRaw) {
    const topic = await db.topic.findFirst({ where: { id: topicRaw, workspaceId: workspace.id }, select: { id: true } });
    topicId = topic?.id ?? null;
  }

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
      topicId,
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
      topicId: src.topicId,
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

// ---- Editing -------------------------------------------------------------------
// The original scheduler shipped without edit: fixing a typo meant delete +
// recreate, which lost the schedule, the per-network variants and the media.
// Editing is allowed ONLY while nothing has been sent (draft | scheduled) —
// once a target has posted, the record is history and must stay truthful.

const EDITABLE = new Set(["draft", "scheduled"]);

/** Load a post that is still safe to change, scoped to the workspace. */
async function loadEditablePost(workspaceId: string, id: string) {
  const post = await db.socialPost.findFirst({ where: { id, workspaceId }, include: { targets: true } });
  if (!post) return null;
  if (!EDITABLE.has(post.status)) return null;
  return post;
}

export async function updateSocialPostAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const { workspace } = await requireRole("EDITOR");
  const post = await loadEditablePost(workspace.id, id);
  if (!post) backTo("That post can't be edited — it has already been sent or doesn't exist.");

  const text = String(formData.get("text") ?? "").trim();
  const accountIds = formData.getAll("accountIds").map(String).filter(Boolean);
  if (accountIds.length === 0) backTo("Pick at least one account to post to.");

  const accounts = await db.unipileAccount.findMany({
    where: { id: { in: accountIds }, workspaceId: workspace.id, kind: "social", status: "connected" },
  });
  if (accounts.length === 0) backTo("Those accounts aren't connected. Connect one under Admin → Connections.");

  // Media: keep what's there unless explicitly cleared or replaced.
  let mediaKeys = readJson<string[]>(post!.mediaKeys, []);
  if (String(formData.get("clearMedia") ?? "") === "on") mediaKeys = [];
  const added = await storeMedia(formData.getAll("media"));
  if (added.length) mediaKeys = added;
  if (!text && mediaKeys.length === 0) backTo("Write something or attach an image.");

  const topicRaw = String(formData.get("topicId") ?? "").trim();
  let topicId: string | null = null;
  if (topicRaw) {
    const topic = await db.topic.findFirst({ where: { id: topicRaw, workspaceId: workspace.id }, select: { id: true } });
    topicId = topic?.id ?? null;
  }

  // Schedule: keep as draft, or (re)schedule to a future time.
  const when = String(formData.get("when") ?? "draft");
  let scheduledAt: Date | null = null;
  let status = "draft";
  if (when === "schedule") {
    const raw = String(formData.get("scheduledAt") ?? "");
    const t = raw ? new Date(raw) : null;
    if (!t || Number.isNaN(t.getTime())) backTo("Enter a valid date and time to schedule.");
    if (t.getTime() < Date.now() - 60_000) backTo("Scheduled time must be in the future.");
    scheduledAt = t;
    status = "scheduled";
  }

  const variantFor = (provider: string): string | null => {
    const v = String(formData.get(`variant_${provider.toUpperCase()}`) ?? "").trim();
    return v && v !== text ? v : null;
  };

  // Per-provider media overrides — only replaced when new files are supplied,
  // so an edit that doesn't touch images keeps the ones already chosen.
  const mediaByProvider = new Map<string, string | null | undefined>();
  for (const provider of new Set(accounts.map((a) => a.provider.toUpperCase()))) {
    const keys = await storeMedia(formData.getAll(`media_${provider}`));
    mediaByProvider.set(provider, keys.length ? writeJson(keys) : undefined);
  }

  const keepIds = new Set(accounts.map((a) => a.accountId));
  await db.$transaction(async (tx) => {
    // Drop targets whose account was deselected.
    await tx.socialPostTarget.deleteMany({
      where: { postId: post!.id, unipileAccountId: { notIn: [...keepIds] } },
    });
    for (const a of accounts) {
      const existing = post!.targets.find((t) => t.unipileAccountId === a.accountId);
      const providerKey = a.provider.toUpperCase();
      const overrideMedia = mediaByProvider.get(providerKey);
      if (existing) {
        await tx.socialPostTarget.update({
          where: { id: existing.id },
          data: {
            provider: a.provider,
            accountName: a.name,
            text: variantFor(a.provider),
            // undefined = leave as-is; a fresh upload replaces it.
            ...(overrideMedia === undefined ? {} : { mediaKeys: overrideMedia }),
            status: "pending",
            error: null,
          },
        });
      } else {
        await tx.socialPostTarget.create({
          data: {
            postId: post!.id,
            provider: a.provider,
            unipileAccountId: a.accountId,
            accountName: a.name,
            text: variantFor(a.provider),
            mediaKeys: overrideMedia ?? null,
          },
        });
      }
    }
    await tx.socialPost.update({
      where: { id: post!.id },
      data: { text, mediaKeys: writeJson(mediaKeys), topicId, scheduledAt, status },
    });
  });

  revalidatePath("/social");
  backTo(status === "scheduled" ? "Saved and scheduled." : "Saved as a draft.", "ok");
}

/** Scheduled → draft, without losing the content. */
export async function unscheduleSocialPostAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const { workspace } = await requireRole("EDITOR");
  const updated = await db.socialPost.updateMany({
    where: { id, workspaceId: workspace.id, status: "scheduled" },
    data: { status: "draft", scheduledAt: null },
  });
  revalidatePath("/social");
  backTo(updated.count ? "Moved back to drafts." : "That post isn't scheduled.", updated.count ? "ok" : "err");
}

/** Save UTM link-tagging settings for this workspace. */
export async function saveUtmSettingsAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const { setWorkspaceSetting } = await import("@/lib/settings");
  const enabled = String(formData.get("enabled") ?? "") === "on";
  await setWorkspaceSetting(workspace.id, "social:utm_enabled", enabled ? "true" : "false");
  await setWorkspaceSetting(workspace.id, "social:utm_source", String(formData.get("source") ?? "").trim());
  await setWorkspaceSetting(workspace.id, "social:utm_medium", String(formData.get("medium") ?? "").trim());
  await setWorkspaceSetting(workspace.id, "social:utm_campaign", String(formData.get("campaign") ?? "").trim());
  revalidatePath("/social");
  backTo(enabled ? "Link tagging on — new posts will carry UTM parameters." : "Link tagging off.", "ok");
}

/**
 * Move a post to a new date/time — the calendar's drag-and-drop target.
 *
 * Typed args rather than FormData (same shape as the production board's
 * moveTaskAction) so the client can call it optimistically inside a transition.
 * Dropping a DRAFT onto a day schedules it, which is the whole point of being
 * able to drag from the drafts tray onto the grid.
 */
export async function rescheduleSocialPostAction(id: string, isoDateTime: string) {
  const { workspace } = await requireRole("EDITOR");
  const when = new Date(isoDateTime);
  if (Number.isNaN(when.getTime())) return { ok: false, message: "That isn't a valid date." };
  // A minute of slack absorbs the round-trip; anything genuinely past is refused
  // because the sweep would fire it immediately, which is never what a drag meant.
  if (when.getTime() < Date.now() - 60_000) return { ok: false, message: "That time has already passed." };

  const post = await db.socialPost.findFirst({
    where: { id, workspaceId: workspace.id },
    select: { id: true, status: true },
  });
  if (!post) return { ok: false, message: "Post not found." };
  if (post.status !== "draft" && post.status !== "scheduled") {
    return { ok: false, message: "Only unsent posts can be moved." };
  }

  await db.socialPost.update({
    where: { id: post.id },
    data: { scheduledAt: when, status: "scheduled" },
  });
  revalidatePath("/social");
  return { ok: true, message: "Moved." };
}
