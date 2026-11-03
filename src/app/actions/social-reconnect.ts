"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { networkFor } from "@/lib/social/networks";
import { retryAfterReconnect } from "@/lib/social/reconnect-retry";

// "Reconnect and retry" on a post's page (E-SOC-07): one button on a leg that
// failed for lost access. The rules live in lib/social/reconnect-retry.ts.

function toPost(postId: string, msg: string, kind: "ok" | "err" = "err"): never {
  redirect(`/social/${postId}?${kind}=${encodeURIComponent(msg)}`);
}

/** The failed leg named by the form, in this workspace, with its post. */
async function legFrom(formData: FormData, workspaceId: string) {
  const id = String(formData.get("target") ?? "");
  const leg = await db.socialPostTarget.findFirst({
    where: { id, post: { workspaceId } },
    select: { id: true, postId: true, provider: true, status: true, post: { select: { approval: true, status: true } } },
  });
  if (!leg) redirect("/social/sent?err=" + encodeURIComponent("That post isn't in this workspace."));
  return leg;
}

/**
 * Ask for this leg to go again once its account is reconnected. An admin is
 * sent straight to the network's connect page; an editor can't connect
 * accounts, so it waits for an admin to — for a day.
 */
export async function reconnectAndRetryAction(formData: FormData) {
  const { workspace, membership, user } = await requireRole("EDITOR");
  const leg = await legFrom(formData, workspace.id);
  const net = networkFor(leg.provider)?.label ?? leg.provider;
  if (leg.status !== "failed") toPost(leg.postId, `${net} isn't a failed send any more.`);
  // The same gate as Retry failed: a post under review can't be sent.
  if (leg.post.approval === "pending" || leg.post.approval === "changes") {
    toPost(leg.postId, "That post is waiting on approval, so it can't be sent again yet.");
  }
  if (leg.post.approval === null && membership.role !== "ADMIN") {
    const { getSetting } = await import("@/lib/settings");
    if ((await getSetting("social:require_approval", workspace.id).catch(() => "")) === "true") {
      toPost(leg.postId, "This workspace requires approval before posts go out — submit it for approval first.");
    }
  }
  await db.socialPostTarget.update({
    where: { id: leg.id },
    data: { retryOnReconnectAt: new Date(), retryOnReconnectBy: user.id },
  });
  revalidatePath(`/social/${leg.postId}`);

  if (membership.role !== "ADMIN") {
    toPost(leg.postId, `Saved — it goes again by itself once an admin reconnects ${net} (within a day).`, "ok");
  }
  const { zernioConfigured } = await import("@/lib/zernio");
  if (!(await zernioConfigured(workspace.id))) toPost(leg.postId, "Zernio isn't configured, so there's nothing to reconnect through.");
  let url: string;
  try {
    const { connectLinkFor } = await import("@/lib/zernio/accounts");
    url = await connectLinkFor(workspace.id, leg.provider.toLowerCase(), `/social/${leg.postId}?reconnected=1`);
  } catch (e) {
    toPost(leg.postId, `Couldn't open ${net}'s connect page: ${e instanceof Error ? e.message : "unknown error"}. The retry still waits for a reconnect from Connections.`);
  }
  redirect(url);
}

/** "I've reconnected" — re-read the accounts and send what's waiting on this post, now. */
export async function checkReconnectAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const postId = String(formData.get("id") ?? "");
  const post = await db.socialPost.findFirst({ where: { id: postId, workspaceId: workspace.id }, select: { id: true } });
  if (!post) redirect("/social/sent?err=" + encodeURIComponent("That post isn't in this workspace."));
  // Re-read the accounts first — only for a workspace already bound to a
  // Zernio profile, so this can never adopt one (see account-health.ts).
  const ws = await db.workspace.findUnique({ where: { id: workspace.id }, select: { zernioProfileId: true } });
  if (ws?.zernioProfileId) {
    const { syncZernioAccounts } = await import("@/lib/zernio/accounts");
    await syncZernioAccounts(workspace.id).catch(() => null);
  }
  const out = await retryAfterReconnect(workspace.id, { postId });
  revalidatePath(`/social/${postId}`);
  revalidatePath("/social", "layout");
  const mine = out.find((o) => o.postId === postId);
  if (!mine) toPost(postId, "The account still isn't connected — reconnect it, then check again.");
  if (mine.held) toPost(postId, `Not sent: ${mine.held}. It still waits, and goes when you check again after resuming.`);
  if (mine.sent) toPost(postId, "Sent — the waiting networks went out.", "ok");
  toPost(postId, "Tried again — see each network's status below.");
}

/** Stop waiting: the leg stays failed, and Retry failed still works. */
export async function cancelReconnectRetryAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const leg = await legFrom(formData, workspace.id);
  await db.socialPostTarget.update({ where: { id: leg.id }, data: { retryOnReconnectAt: null, retryOnReconnectBy: null } });
  revalidatePath(`/social/${leg.postId}`);
  toPost(leg.postId, "It won't go again by itself.", "ok");
}
