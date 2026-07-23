"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { saveSmtpConfig, clearSmtpConfig, getSmtpConfig, type SmtpConfig } from "@/lib/email/config";
import { sendTestEmail } from "@/lib/email";

function parseForm(formData: FormData): SmtpConfig {
  return {
    host: String(formData.get("host") ?? "").trim(),
    port: Number(formData.get("port") ?? 587),
    secure: formData.get("secure") === "on",
    user: String(formData.get("user") ?? "").trim(),
    pass: String(formData.get("pass") ?? ""),
    fromName: String(formData.get("fromName") ?? "").trim(),
    fromEmail: String(formData.get("fromEmail") ?? "").trim(),
  };
}

export async function saveSmtpAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const cfg = parseForm(formData);
  if (!cfg.host || !cfg.port || !cfg.fromEmail) {
    redirect("/admin/email?error=missing");
  }
  // If admin left the password field blank, keep the existing one.
  if (!cfg.pass) {
    const existing = await getSmtpConfig(workspace.id);
    if (existing) cfg.pass = existing.pass;
  }
  // Multi-tenant: saved for THIS workspace only (its mail goes out through it).
  await saveSmtpConfig(cfg, workspace.id);
  revalidatePath("/admin/email");
  redirect("/admin/email?ok=saved");
}

export async function clearSmtpAction() {
  const { workspace } = await requireRole("ADMIN");
  await clearSmtpConfig(workspace.id);
  revalidatePath("/admin/email");
  redirect("/admin/email?ok=cleared");
}

export async function testSmtpAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const cfg = parseForm(formData);
  const to = String(formData.get("testTo") ?? "").trim();
  if (!to) redirect("/admin/email?error=notest");
  if (!cfg.pass) {
    // Use saved password if the form's password field is empty.
    const existing = await getSmtpConfig(workspace.id);
    if (existing) cfg.pass = existing.pass;
  }
  const result = await sendTestEmail({ ...cfg, to });
  if (result.ok) {
    redirect(`/admin/email?ok=sent&to=${encodeURIComponent(to)}`);
  } else {
    redirect(`/admin/email?error=send&msg=${encodeURIComponent(result.error)}`);
  }
}
