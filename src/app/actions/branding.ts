"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { writeAudit } from "@/lib/governance";

// Per-company app-chrome branding (multi-tenant): accent color + logo, stored
// on the Workspace row and applied by the app shell as CSS-token overrides.

const HEX = /^#[0-9a-fA-F]{6}$/;

export async function saveWorkspaceAccentAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const raw = String(formData.get("accentColor") ?? "").trim();
  if (raw && !HEX.test(raw)) {
    redirect("/admin/settings?err=accent");
  }
  await db.workspace.update({
    where: { id: workspace.id },
    data: { accentColor: raw || null },
  });
  revalidatePath("/", "layout");
  redirect("/admin/settings?ok=accent");
}

// ⚠ No SVG. An SVG is a document that can carry script; served from the
// app's own origin, a tenant admin could send the operator a link to one and
// run it with the operator's session (audit SEC-14). Raster formats only.
const LOGO_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export async function uploadWorkspaceLogoAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) redirect("/admin/settings?err=logo-missing");
  if (file.size > LOGO_MAX_BYTES) redirect("/admin/settings?err=logo-size");
  const ext = LOGO_TYPES[file.type];
  if (!ext) redirect("/admin/settings?err=logo-type");

  const bytes = Buffer.from(await file.arrayBuffer());
  const stored = await storage.put(`workspace-logo${ext}`, bytes, file.type, workspace.id);
  await db.workspace.update({
    where: { id: workspace.id },
    data: { logoKey: stored.key },
  });
  revalidatePath("/", "layout");
  redirect("/admin/settings?ok=logo");
}

const LOGO_EXT_TYPE: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

/**
 * "Copy branding from another of your workspaces" (2026-11-22, the owner's order that Demo
 * Workspace look like LSI Media; their choice: "Copy once").
 *
 * Replaces this workspace's accent colour and logo with the other's, as a ONE-TIME copy: later
 * changes on either side don't travel. The logo becomes this workspace's OWN file (a new stored
 * object owned here, E-SEC-11), never a pointer into the other workspace's storage. A source with
 * no logo clears this one's: the copy is the other workspace's look, exactly.
 *
 * Only an active ADMIN of BOTH workspaces (the other one must not be deleted). Both audit logs
 * record it. Branding only: keys go through Settings → Keys sharing, and a workspace's
 * connections (social accounts, website, YouTube, mailbox, storage, analytics) are never copied.
 */
export async function copyBrandingFromAction(formData: FormData) {
  const { workspace, user } = await requireRole("ADMIN");
  const fromId = String(formData.get("from") ?? "");
  if (!fromId || fromId === workspace.id) redirect("/admin/settings?err=copy-from");
  const theirs = await db.membership.findFirst({
    where: { userId: user.id, workspaceId: fromId, role: "ADMIN", status: "active" },
    select: { workspace: { select: { id: true, name: true, accentColor: true, logoKey: true, deletedAt: true } } },
  });
  if (!theirs || theirs.workspace.deletedAt) redirect("/admin/settings?err=copy-from");
  const from = theirs.workspace;

  let logoKey: string | null = null;
  if (from.logoKey) {
    const ext = (from.logoKey.match(/\.(png|jpe?g|webp)$/i)?.[0] ?? "").toLowerCase();
    const type = LOGO_EXT_TYPE[ext];
    const bytes = type ? await storage.get(from.logoKey) : null;
    if (!type || !bytes) redirect("/admin/settings?err=copy-logo");
    logoKey = (await storage.put(`workspace-logo${ext === ".jpeg" ? ".jpg" : ext}`, bytes, type, workspace.id)).key;
  }
  await db.workspace.update({ where: { id: workspace.id }, data: { accentColor: from.accentColor, logoKey } });
  const meta = { accentColor: from.accentColor, logo: logoKey ? "copied" : "none" };
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "branding.copied_from", entityType: "workspace", entityId: workspace.id, meta: { ...meta, fromWorkspace: from.name, fromWorkspaceId: from.id } });
  await writeAudit({ workspaceId: from.id, actorId: user.id, action: "branding.copied_to", entityType: "workspace", entityId: from.id, meta: { ...meta, toWorkspace: workspace.name, toWorkspaceId: workspace.id } });
  revalidatePath("/", "layout");
  redirect("/admin/settings?ok=copied");
}

export async function clearWorkspaceLogoAction() {
  const { workspace } = await requireRole("ADMIN");
  await db.workspace.update({ where: { id: workspace.id }, data: { logoKey: null } });
  revalidatePath("/", "layout");
  redirect("/admin/settings?ok=logo-cleared");
}
