"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { writeAudit } from "@/lib/governance";
import { sendInboxMessage, replyOnPost } from "@/lib/zernio/inbox";

/**
 * Answering from Engage: a direct-message reply, and a comment on our own post.
 *
 * ⚠ Both of these PUBLISH TO A REAL AUDIENCE the moment they succeed. There is
 * no draft, no queue and no undo — unlike a scheduled post, which passes the
 * approval gate and can be cancelled up to its slot. That shapes every rule
 * below: the account is re-checked against the workspace, the text is bounded,
 * an empty send is refused rather than silently no-oped, and every attempt is
 * audited whether it worked or not.
 */

type Flash = (msg: string, kind?: "err" | "ok") => never;

function flashTo(to: string, msg: string, kind: "err" | "ok"): never {
  redirect(`${to}?${kind === "err" ? "err" : "ok"}=${encodeURIComponent(msg)}`);
}

const MAX_LEN = 2000;

/**
 * Resolve the sending account, scoped to the caller's workspace.
 *
 * ⚠ THE TENANCY GUARD. `accountId` arrives from a form field, and Zernio would
 * happily accept any account id the API key can see — which, on a key shared
 * across profiles, includes another tenant's accounts. Without this check a
 * crafted request from one workspace could post as another company. Same
 * reasoning as the `find`-AND-`remove` scoping in the deletion registry.
 */
async function requireOwnAccount(workspaceId: string, accountId: string, back: Flash) {
  const account = await db.zernioAccount.findFirst({
    where: { workspaceId, accountId, status: "connected" },
    select: { accountId: true, platform: true, displayName: true, username: true },
  });
  if (!account) back("That account isn't connected to this workspace.");
  return account!;
}

function requireMessage(raw: FormDataEntryValue | null, back: Flash): string {
  const text = String(raw ?? "").trim();
  if (!text) back("Write something first — an empty reply isn't sent.");
  if (text.length > MAX_LEN) back(`That's ${text.length} characters; keep a reply under ${MAX_LEN}.`);
  return text;
}

/** Reply inside a direct-message thread. */
export async function sendInboxReplyAction(formData: FormData) {
  const { workspace, membership } = await requireRole("EDITOR");
  const conversationId = String(formData.get("conversationId") ?? "");
  const accountId = String(formData.get("accountId") ?? "");
  // Land back on the thread we replied in, not on the inbox root.
  const back: Flash = (msg, kind = "err") =>
    flashTo(
      `/social/engage?dm=${encodeURIComponent(conversationId)}&acct=${encodeURIComponent(accountId)}`,
      msg, kind,
    );

  if (!conversationId || !accountId) back("Couldn't tell which conversation that was.");
  const account = await requireOwnAccount(workspace.id, accountId, back);
  const message = requireMessage(formData.get("message"), back);

  try {
    await sendInboxMessage({ workspaceId: workspace.id, conversationId, accountId, message });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await writeAudit({
      workspaceId: workspace.id, actorId: membership.userId,
      action: "social.dm_reply_failed", entityType: "zernio_conversation", entityId: conversationId,
      meta: { platform: account.platform, chars: message.length, error: detail.slice(0, 300) },
    });
    // Say what the network said. "Something went wrong" on a message you
    // believed you'd sent is the worst possible answer here.
    back(`Couldn't send that: ${detail}`);
  }

  await writeAudit({
    workspaceId: workspace.id, actorId: membership.userId,
    action: "social.dm_replied", entityType: "zernio_conversation", entityId: conversationId,
    meta: { platform: account.platform, account: account.displayName ?? account.username, chars: message.length },
  });
  revalidatePath("/social", "layout");
  back(`Sent on ${account.platform}.`, "ok");
}

/** Answer a comment by commenting on the post it sits under. */
export async function replyOnPostAction(formData: FormData) {
  const { workspace, membership } = await requireRole("EDITOR");
  const postId = String(formData.get("postId") ?? "");
  const accountId = String(formData.get("accountId") ?? "");
  const back: Flash = (msg, kind = "err") =>
    flashTo(
      `/social/engage?post=${encodeURIComponent(postId)}&acct=${encodeURIComponent(accountId)}`,
      msg, kind,
    );

  if (!postId || !accountId) back("Couldn't tell which post that was.");
  const account = await requireOwnAccount(workspace.id, accountId, back);

  // ⚠ A public comment IS publishing. A workspace that holds non-admins'
  // scheduled posts for review would otherwise let the same person say
  // anything it likes under those posts, immediately and to the same audience
  // — the governance gate with an open side door. Direct messages are exempt:
  // they're private correspondence, not broadcast.
  if (!canAdmin(membership.role)) {
    const requireApproval =
      (await getSetting("social:require_approval", workspace.id).catch(() => "")) === "true";
    if (requireApproval) {
      back("This workspace reviews posts before they go out, so public comments are admin-only. Direct-message replies are still yours to send.");
    }
  }

  const message = requireMessage(formData.get("message"), back);

  try {
    await replyOnPost({ workspaceId: workspace.id, postId, accountId, message });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await writeAudit({
      workspaceId: workspace.id, actorId: membership.userId,
      action: "social.comment_reply_failed", entityType: "zernio_post", entityId: postId,
      meta: { platform: account.platform, chars: message.length, error: detail.slice(0, 300) },
    });
    back(`Couldn't post that comment: ${detail}`);
  }

  await writeAudit({
    workspaceId: workspace.id, actorId: membership.userId,
    action: "social.comment_replied", entityType: "zernio_post", entityId: postId,
    meta: { platform: account.platform, account: account.displayName ?? account.username, chars: message.length },
  });
  revalidatePath("/social", "layout");
  back(`Comment posted on ${account.platform}.`, "ok");
}
