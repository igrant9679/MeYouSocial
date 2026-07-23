"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";

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

const LOGO_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
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
  const stored = await storage.put(`workspace-logo${ext}`, bytes, file.type);
  await db.workspace.update({
    where: { id: workspace.id },
    data: { logoKey: stored.key },
  });
  revalidatePath("/", "layout");
  redirect("/admin/settings?ok=logo");
}

export async function clearWorkspaceLogoAction() {
  const { workspace } = await requireRole("ADMIN");
  await db.workspace.update({ where: { id: workspace.id }, data: { logoKey: null } });
  revalidatePath("/", "layout");
  redirect("/admin/settings?ok=logo-cleared");
}
