"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { getReport } from "@/lib/report-defs";
import { APPROVAL_DAYS, SHARE_DAYS } from "@/lib/share-links";

/**
 * E-MEA-14: read-only report links for people without an account. ADMIN —
 * a link hands the report to anyone who has it, so it's the same bar as
 * inviting someone. Each is for one report, expires, and can be turned off.
 */

function back(key: string, msg: string, ok: boolean): never {
  redirect(`/reports/${encodeURIComponent(key)}?${ok ? "flash" : "flashErr"}=${encodeURIComponent(msg)}`);
}

export async function createReportShareLinkAction(formData: FormData) {
  const key = String(formData.get("reportKey") ?? "");
  const { workspace, user } = await requireRole("ADMIN");
  if (!(await getReport(workspace.id, key))) back(key, "That report doesn't exist.", false);
  const days = Number(formData.get("days"));
  if (!(SHARE_DAYS as readonly number[]).includes(days)) back(key, "Choose how long the link stays open.", false);
  const label = String(formData.get("label") ?? "").trim().slice(0, 80) || null;
  if ((await db.shareLink.count({ where: { workspaceId: workspace.id, revokedAt: null, expiresAt: { gt: new Date() } } })) >= 50) back(key, "This workspace has 50 open links — turn some off first.", false);
  const link = await db.shareLink.create({ data: { workspaceId: workspace.id, kind: "report", targetKey: key, label, expiresAt: new Date(Date.now() + days * 86_400_000), createdById: user.id } });
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "report.share_link_created", entityType: "share_link", entityId: link.id, meta: { report: key, days, label } });
  revalidatePath(`/reports/${key}`);
  back(key, `Link made${label ? ` for ${label}` : ""} — open for ${days} days. Copy it from the list.`, true);
}

export async function revokeShareLinkAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const { workspace, user } = await requireRole("ADMIN");
  const link = await db.shareLink.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!link) redirect("/reports");
  await db.shareLink.updateMany({ where: { id, workspaceId: workspace.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (link.kind === "post-approval") {
    await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "social.approval_link_revoked", entityType: "social_post", entityId: link.targetKey, meta: { linkId: id } });
    revalidatePath("/social/approvals");
    redirect(`/social/approvals?ok=${encodeURIComponent("Link turned off — it no longer opens.")}`);
  }
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "report.share_link_revoked", entityType: "share_link", entityId: id, meta: { report: link.targetKey } });
  revalidatePath(`/reports/${link.targetKey}`);
  back(link.targetKey, "Link turned off — it no longer opens.", true);
}

/**
 * E-SOC-03: send one held post to a client for approval. ADMIN — the client's
 * answer acts in the sender's name. Only a post waiting for approval; a new
 * link for the same post turns the older one off, so one answer counts.
 */
export async function createPostApprovalLinkAction(formData: FormData) {
  const postId = String(formData.get("postId") ?? "");
  const { workspace, user } = await requireRole("ADMIN");
  const backTo = (msg: string, ok: boolean): never => redirect(`/social/approvals?${ok ? "ok" : "err"}=${encodeURIComponent(msg)}`);
  const post = await db.socialPost.findFirst({ where: { id: postId, workspaceId: workspace.id }, select: { id: true, approval: true } });
  if (!post || post.approval !== "pending") backTo("Only a post waiting for approval can be sent to a client.", false);
  const days = Number(formData.get("days"));
  if (!(APPROVAL_DAYS as readonly number[]).includes(days)) backTo("Choose how long the link stays open.", false);
  const label = String(formData.get("label") ?? "").trim().slice(0, 80) || null;
  await db.shareLink.updateMany({ where: { workspaceId: workspace.id, kind: "post-approval", targetKey: postId, revokedAt: null }, data: { revokedAt: new Date() } });
  const link = await db.shareLink.create({ data: { workspaceId: workspace.id, kind: "post-approval", targetKey: postId, label, expiresAt: new Date(Date.now() + days * 86_400_000), createdById: user.id } });
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "social.approval_link_created", entityType: "social_post", entityId: postId, meta: { days, label, linkId: link.id } });
  revalidatePath("/social/approvals");
  backTo(`Link made${label ? ` for ${label}` : ""} — copy it from "Ask a client to approve" and send it.`, true);
}
