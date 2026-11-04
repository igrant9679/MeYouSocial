"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { notify } from "@/lib/notify";
import { openShare } from "@/lib/share-links";
import { approvePost, requestChanges } from "@/lib/social/review";

/**
 * A client's answer on an approval link (E-SOC-03). No session: the TOKEN is
 * the permission — checked here on every call (signature, not turned off, not
 * expired, a post-approval link), and it covers exactly one post. The answer
 * goes through the same review path as the in-app buttons, in the name of the
 * admin who sent the link (they delegated it) and recorded as the client's.
 * One answer per link: deciding turns the link off.
 */

async function linkFor(token: string) {
  const share = await openShare(token);
  if (!share || share.kind !== "post-approval") return null;
  const link = await db.shareLink.findUnique({ where: { id: share.id }, select: { createdById: true } });
  if (!link?.createdById) return null;
  const sender = await db.membership.findFirst({ where: { workspaceId: share.workspaceId, userId: link.createdById, status: "active", role: "ADMIN" }, select: { userId: true } });
  return sender ? { share, senderId: sender.userId } : null;
}

function done(token: string, msg: string): never {
  redirect(`/a/${encodeURIComponent(token)}?done=${encodeURIComponent(msg)}`);
}

export async function clientApproveAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const l = await linkFor(token);
  if (!l) done(token, "This link doesn't open any more — nothing was changed.");
  const { share, senderId } = l;
  const r = await approvePost(share.workspaceId, senderId, share.targetKey, null, ["pending"]);
  if (!r.ok) done(token, "This post isn't waiting for approval any more — nothing was changed.");
  await db.shareLink.updateMany({ where: { id: share.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await writeAudit({ workspaceId: share.workspaceId, actorId: null, action: "social.client_approved", entityType: "social_post", entityId: share.targetKey, meta: { client: share.label, linkId: share.id, sentBy: senderId, outcome: r.outcome ?? null } });
  await notify({ workspaceId: share.workspaceId, kind: "approval_decided", title: `${share.label ?? "The client"} approved a post through its approval link`, body: r.message, path: "/social/approvals", entityType: "social_post", entityId: share.targetKey });
  revalidatePath("/social", "layout");
  done(token, "Approved — thank you. The team has been told.");
}

export async function clientRequestChangesAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  const l = await linkFor(token);
  if (!l) done(token, "This link doesn't open any more — nothing was changed.");
  if (!note) redirect(`/a/${encodeURIComponent(token)}?err=${encodeURIComponent("Say what should change — the note goes to the team.")}`);
  const { share, senderId } = l;
  const r = await requestChanges(share.workspaceId, senderId, share.targetKey, `${share.label ?? "Client"}: ${note}`);
  if (!r.ok) done(token, "This post isn't waiting for approval any more — nothing was changed.");
  await db.shareLink.updateMany({ where: { id: share.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await writeAudit({ workspaceId: share.workspaceId, actorId: null, action: "social.client_changes_requested", entityType: "social_post", entityId: share.targetKey, meta: { client: share.label, linkId: share.id, sentBy: senderId, note } });
  await notify({ workspaceId: share.workspaceId, kind: "approval_decided", title: `${share.label ?? "The client"} asked for changes through its approval link`, body: note, path: "/social/approvals", entityType: "social_post", entityId: share.targetKey });
  revalidatePath("/social", "layout");
  done(token, "Sent — the team has your note. Thank you.");
}
