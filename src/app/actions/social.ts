"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { writeJson, readJson } from "@/lib/db/json";
import { publishSocialPost } from "@/lib/social/publish";
import { networkFor } from "@/lib/social/networks";
import { claimNextFreeSlot, formatInZone, getPostingTimeZone, queueFailureMessage } from "@/lib/social/slots";

// Social scheduler actions. A post fans out to one or more connected social
// accounts (Zernio), either now or at a scheduled time. Media is optional and
// stored via the storage layer; the scheduler/publisher reads it back at send.

/**
 * Resolve the composer's selected account rows, workspace-scoped.
 *
 * Returns a shape deliberately matching what the rest of this file already
 * used, so the Zernio migration didn't have to touch the per-network variant
 * and media logic below: `provider` carries the Zernio platform slug where the
 * Unipile provider used to sit.
 */
async function resolveSelectedAccounts(workspaceId: string, ids: string[]) {
  const rows = await db.zernioAccount.findMany({
    where: { id: { in: ids }, workspaceId, status: "connected" },
  });
  return rows.map((a) => ({
    id: a.id,
    accountId: a.accountId,
    provider: a.platform,
    name: a.displayName ?? a.username,
  }));
}

const MEDIA_MAX = 4;
const MEDIA_BYTES = 15 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function backTo(msg: string, kind: "err" | "ok" = "err"): never {
  redirect(`/social?${kind === "err" ? "err" : "ok"}=${encodeURIComponent(msg)}`);
}

/**
 * Refuse a send that a network will certainly reject for having no image.
 *
 * Instagram, Pinterest, YouTube, TikTok and Snapchat cannot accept a text-only
 * post at all. The composer shows an amber "needs an image" next to those rows
 * but does NOT block submit — and nothing checked server-side — so the post was
 * accepted, stored, and only failed later at Zernio, per-network, after it had
 * already gone out everywhere else. Refusing here is the same rule the queue
 * follows for a missing slot: say no with a reason rather than half-doing it.
 *
 * Drafts are exempt: an image can be attached before it ever goes out. This
 * only guards a post that is about to publish or is being scheduled to.
 *
 * `mediaFor` returns the keys that provider will actually send — its own
 * override when it has one, else the post's base media.
 */
function assertMediaWhereRequired(
  providers: string[],
  mediaFor: (provider: string) => string[],
): void {
  const missing = [...new Set(providers)]
    .filter((p) => networkFor(p)?.requiresMedia && mediaFor(p).length === 0)
    .map((p) => networkFor(p)?.label ?? p);
  if (missing.length === 0) return;
  const list =
    missing.length === 1
      ? missing[0]
      : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
  backTo(
    `${list} ${missing.length === 1 ? "needs" : "need"} an image — attach one, or deselect ${missing.length === 1 ? "it" : "them"}.`,
  );
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

/**
 * Approval workflow resolution for a post being created or resubmitted.
 *
 * When `social:require_approval` is on, a non-admin's post carries
 * approval="pending" and is HELD AS A DRAFT whatever send option they chose —
 * the requested time is kept on scheduledAt so approving can honor it. Admins'
 * own posts are stamped "approved" so the UI can say so. With the workflow
 * off, approval stays null and nothing changes.
 */
async function resolveApprovalForCreate(
  workspaceId: string, role: string,
): Promise<{ requireApproval: boolean; approval: string | null; held: boolean }> {
  const { getSetting } = await import("@/lib/settings");
  const requireApproval = (await getSetting("social:require_approval", workspaceId).catch(() => "")) === "true";
  if (!requireApproval) return { requireApproval, approval: null, held: false };
  const held = role !== "ADMIN";
  return { requireApproval, approval: held ? "pending" : "approved", held };
}

/** Campaign / category / evergreen fields shared by create and update. */
async function parseCompositionExtras(workspaceId: string, formData: FormData) {
  // Campaign — validated against this workspace, same rule as topics.
  const campaignRaw = String(formData.get("campaignId") ?? "").trim();
  let campaignId: string | null = null;
  if (campaignRaw) {
    const c = await db.campaign.findFirst({
      where: { id: campaignRaw, workspaceId, status: "active" },
      select: { id: true },
    });
    campaignId = c?.id ?? null;
  }
  // Slot category — bounded free text; empty = uncategorized.
  const category = String(formData.get("category") ?? "").trim().slice(0, 40) || null;
  const evergreen = String(formData.get("evergreen") ?? "") === "on";
  const recycleEveryDays = Math.min(
    365, Math.max(1, parseInt(String(formData.get("recycleEveryDays") ?? "30"), 10) || 30),
  );
  return { campaignId, category, evergreen, recycleEveryDays };
}

export async function createSocialPostAction(formData: FormData) {
  const { workspace, user, membership } = await requireRole("EDITOR");
  const text = String(formData.get("text") ?? "").trim();
  const accountIds = formData.getAll("accountIds").map(String).filter(Boolean);
  const when = String(formData.get("when") ?? "now"); // now | schedule | queue
  const scheduledRaw = String(formData.get("scheduledAt") ?? "");

  if (accountIds.length === 0) backTo("Pick at least one account to post to.");
  const mediaKeys = await storeMedia(formData.getAll("media"));
  if (!text && mediaKeys.length === 0) backTo("Write something or attach an image.");

  const accounts = await resolveSelectedAccounts(workspace.id, accountIds);
  if (accounts.length === 0) backTo("Those accounts aren't connected. Connect one under Admin → Connections.");

  // Optional workspace Topic — validated against this workspace so a stale or
  // foreign id can never be attached.
  const topicRaw = String(formData.get("topicId") ?? "").trim();
  let topicId: string | null = null;
  if (topicRaw) {
    const topic = await db.topic.findFirst({ where: { id: topicRaw, workspaceId: workspace.id }, select: { id: true } });
    topicId = topic?.id ?? null;
  }

  const { campaignId, category, evergreen, recycleEveryDays } = await parseCompositionExtras(workspace.id, formData);
  const gate = await resolveApprovalForCreate(workspace.id, membership.role);

  let scheduledAt: Date | null = null;
  let status = "draft";
  if (when === "schedule") {
    const t = scheduledRaw ? new Date(scheduledRaw) : null;
    if (!t || Number.isNaN(t.getTime())) backTo("Enter a valid date and time to schedule.");
    if (t.getTime() < Date.now() - 60_000) backTo("Scheduled time must be in the future.");
    scheduledAt = t;
    status = "scheduled";
  } else if (when === "queue") {
    // Next free slot on the workspace's posting schedule, respecting the
    // post's category. Refuses rather than inventing a time — a queue with no
    // schedule has nowhere to put this.
    const claim = await claimNextFreeSlot(workspace.id, undefined, category);
    if ("error" in claim) backTo(queueFailureMessage(claim.error));
    scheduledAt = claim.at;
    status = "scheduled";
  } else {
    status = "publishing"; // publish immediately below
  }
  // The approval hold beats every send option: the post lands as a draft with
  // approval="pending", keeping the requested time for the approver to honor.
  if (gate.held) status = "draft";

  // Per-network text overrides: variant_<PROVIDER> from the composer. Empty or
  // identical-to-base overrides are dropped so the target falls back to base.
  //
  // The field name uses the UPPERCASED slug on both sides — SocialComposer
  // builds its rows from `a.provider.toUpperCase()`, and the edit page keys
  // `initial.variants` the same way. The stored provider is lowercase, so this
  // must keep uppercasing; "fixing" it to match the stored casing silently
  // drops every override, which is exactly the bug this comment now prevents.
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

  // Every path here either publishes now or schedules, so check before storing.
  assertMediaWhereRequired(
    accounts.map((a) => a.provider),
    (p) => readJson<string[]>(mediaByProvider.get(p.toUpperCase()), mediaKeys),
  );

  const post = await db.socialPost.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      topicId,
      campaignId,
      category,
      evergreen,
      recycleEveryDays,
      approval: gate.approval,
      text,
      mediaKeys: writeJson(mediaKeys),
      scheduledAt,
      status,
      targets: {
        create: accounts.map((a) => ({
          provider: a.provider,
          accountId: a.accountId,
          accountName: a.name,
          text: variantFor(a.provider),
          mediaKeys: mediaByProvider.get(a.provider.toUpperCase()) ?? null,
        })),
      },
    },
  });

  if (gate.held) {
    const { notify } = await import("@/lib/notify");
    await notify({
      workspaceId: workspace.id,
      kind: "approval_needed",
      title: "A social post is waiting for approval",
      body: text.slice(0, 140),
      path: "/social",
      entityType: "social_post",
      entityId: post.id,
      excludeUserId: user.id,
    });
    revalidatePath("/social");
    backTo("Sent for approval — an admin will review it before it goes out.", "ok");
  }

  if (status === "publishing") {
    await publishSocialPost(post.id);
    revalidatePath("/social");
    backTo("Post sent — check the queue for per-network status.", "ok");
  }
  revalidatePath("/social");
  backTo(
    when === "queue"
      ? `Queued for ${formatInZone(scheduledAt!, await getPostingTimeZone(workspace.id))}.`
      : "Scheduled.",
    "ok",
  );
}

/**
 * Refuse to send or schedule content the approval workflow hasn't cleared.
 *
 * Two distinct refusals: a post explicitly held (pending/changes) is blocked
 * for EVERYONE — approving is the act that unlocks it, one path, no shortcuts.
 * A post with approval=null (predating the workflow, or a duplicate) is blocked
 * only for non-admins while the workflow is on — they submit it instead.
 */
async function assertApprovedForSend(
  workspaceId: string, role: string, post: { approval: string | null },
): Promise<void> {
  if (post.approval === "pending") backTo("That post is awaiting approval — an admin has to approve it first.");
  if (post.approval === "changes") backTo("Changes were requested on that post — edit it and resubmit for approval.");
  if (post.approval === null && role !== "ADMIN") {
    const { getSetting } = await import("@/lib/settings");
    if ((await getSetting("social:require_approval", workspaceId).catch(() => "")) === "true") {
      backTo("This workspace requires approval before posts go out — submit it for approval first.");
    }
  }
}

export async function publishNowAction(formData: FormData) {
  const { workspace, membership } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  const post = await db.socialPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post || post.status === "posted") backTo("Nothing to publish.");
  await assertApprovedForSend(workspace.id, membership.role, post!);
  await publishSocialPost(post!.id);
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
  const { workspace, user, membership } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  const src = await db.socialPost.findFirst({ where: { id, workspaceId: workspace.id }, include: { targets: true } });
  if (!src) backTo("Not found.");
  // A duplicate is NEW content as far as the approval workflow is concerned —
  // without this, duplicating a pending post would mint a sendable copy and
  // walk straight around the review.
  const gate = await resolveApprovalForCreate(workspace.id, membership.role);
  await db.socialPost.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      topicId: src.topicId,
      campaignId: src.campaignId,
      category: src.category,
      text: src.text,
      mediaKeys: src.mediaKeys,
      status: "draft",
      approval: gate.approval,
      targets: {
        create: src.targets.map((t) => ({ provider: t.provider, accountId: t.accountId, accountName: t.accountName, text: t.text, mediaKeys: t.mediaKeys })),
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
  const { workspace, user } = await requireRole("EDITOR");
  const post = await loadEditablePost(workspace.id, id);
  if (!post) backTo("That post can't be edited — it has already been sent or doesn't exist.");

  const text = String(formData.get("text") ?? "").trim();
  const accountIds = formData.getAll("accountIds").map(String).filter(Boolean);
  if (accountIds.length === 0) backTo("Pick at least one account to post to.");

  const accounts = await resolveSelectedAccounts(workspace.id, accountIds);
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

  const { campaignId, category, evergreen, recycleEveryDays } = await parseCompositionExtras(workspace.id, formData);

  // Schedule: keep as draft, (re)schedule to a future time, or take a slot.
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
  } else if (when === "queue") {
    // Excludes this post's own slot, so re-queueing an already-queued post can
    // keep the slot it's in rather than being pushed to the back of the line.
    const claim = await claimNextFreeSlot(workspace.id, post!.id, category);
    if ("error" in claim) backTo(queueFailureMessage(claim.error));
    scheduledAt = claim.at;
    status = "scheduled";
  }

  // A held post stays held through an edit: editing it is RESUBMISSION, not a
  // way to slip past review. changes → pending is the author's answer to the
  // reviewer; the note is cleared because it referred to the previous text.
  let approval = post!.approval;
  let reviewNote = post!.reviewNote;
  const resubmitted = post!.approval === "changes";
  if (post!.approval === "pending" || post!.approval === "changes") {
    approval = "pending";
    reviewNote = null;
    status = "draft";
  }

  // Uppercased slug on both sides — see the note on the create path above.
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

  // Only when it's actually going out — a draft may legitimately have no image
  // yet. `undefined` here means "no new upload", so fall back to whatever that
  // target already had, then to the post's base media.
  if (status !== "draft") {
    const existingFor = new Map(post!.targets.map((t) => [t.provider, t.mediaKeys]));
    assertMediaWhereRequired(
      accounts.map((a) => a.provider),
      (p) => readJson<string[]>(mediaByProvider.get(p.toUpperCase()) ?? existingFor.get(p), mediaKeys),
    );
  }

  const keepIds = new Set(accounts.map((a) => a.accountId));
  await db.$transaction(async (tx) => {
    // Drop targets whose account was deselected.
    await tx.socialPostTarget.deleteMany({
      where: { postId: post!.id, accountId: { notIn: [...keepIds] } },
    });
    for (const a of accounts) {
      const existing = post!.targets.find((t) => t.accountId === a.accountId);
      const overrideMedia = mediaByProvider.get(a.provider.toUpperCase());
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
            accountId: a.accountId,
            accountName: a.name,
            text: variantFor(a.provider),
            mediaKeys: overrideMedia ?? null,
          },
        });
      }
    }
    await tx.socialPost.update({
      where: { id: post!.id },
      data: {
        text, mediaKeys: writeJson(mediaKeys), topicId, scheduledAt, status,
        campaignId, category, evergreen, recycleEveryDays, approval, reviewNote,
      },
    });
  });

  if (resubmitted) {
    const { notify } = await import("@/lib/notify");
    await notify({
      workspaceId: workspace.id,
      kind: "approval_needed",
      title: "An edited post was resubmitted for approval",
      body: text.slice(0, 140),
      path: "/social",
      entityType: "social_post",
      entityId: post!.id,
      excludeUserId: user.id,
    });
  }

  revalidatePath("/social");
  backTo(
    approval === "pending"
      ? "Saved — it's waiting for approval before it can go out."
      : when === "queue"
        ? `Saved and queued for ${formatInZone(scheduledAt!, await getPostingTimeZone(workspace.id))}.`
        : status === "scheduled" ? "Saved and scheduled." : "Saved as a draft.",
    "ok",
  );
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
    select: { id: true, status: true, approval: true },
  });
  if (!post) return { ok: false, message: "Post not found." };
  if (post.status !== "draft" && post.status !== "scheduled") {
    return { ok: false, message: "Only unsent posts can be moved." };
  }
  // Dragging onto the calendar is scheduling — same approval gate as the queue.
  if (post.approval === "pending") return { ok: false, message: "Awaiting approval — it can't be scheduled yet." };
  if (post.approval === "changes") return { ok: false, message: "Changes were requested — edit and resubmit it first." };

  await db.socialPost.update({
    where: { id: post.id },
    data: { scheduledAt: when, status: "scheduled" },
  });
  revalidatePath("/social");
  return { ok: true, message: "Moved." };
}
