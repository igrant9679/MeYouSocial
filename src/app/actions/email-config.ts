"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { saveSmtpConfig, clearSmtpConfig, type SmtpConfig } from "@/lib/email/config";
import { sendTestEmail } from "@/lib/email";
import { getWorkspaceSettingRaw } from "@/lib/settings";
import { assertPublicHost } from "@/lib/net/public-host";

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

/**
 * The saved password, for a blank password field — but ONLY this workspace's
 * own saved config (never the platform's, which getSmtpConfig falls back to),
 * and only when the host and user are unchanged. Before, a blank field was
 * filled from whatever resolved, so pointing the form at a server you control
 * and pressing "Send test" handed it the platform's SMTP password.
 */
async function storedPassFor(workspaceId: string, cfg: SmtpConfig): Promise<string> {
  const raw = await getWorkspaceSettingRaw(workspaceId, "email:smtp");
  if (!raw) return "";
  try {
    const saved = JSON.parse(raw) as Partial<SmtpConfig>;
    const same = (saved.host ?? "").toLowerCase() === cfg.host.toLowerCase() && (saved.user ?? "") === cfg.user;
    return same ? saved.pass ?? "" : "";
  } catch {
    return "";
  }
}

/** Mail servers are on the public internet; anything else is a probe. */
async function publicHostOrBack(host: string) {
  try {
    await assertPublicHost(host);
  } catch (e) {
    redirect(`/admin/email?error=send&msg=${encodeURIComponent(e instanceof Error ? e.message : "That server can't be used.")}`);
  }
}

export async function saveSmtpAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const cfg = parseForm(formData);
  if (!cfg.host || !cfg.port || !cfg.fromEmail) {
    redirect("/admin/email?error=missing");
  }
  await publicHostOrBack(cfg.host);
  // If admin left the password field blank, keep the existing one (same server only).
  if (!cfg.pass) cfg.pass = await storedPassFor(workspace.id, cfg);
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
  await publicHostOrBack(cfg.host);
  // Use the saved password if the form's field is empty — this workspace's, same server only.
  if (!cfg.pass) cfg.pass = await storedPassFor(workspace.id, cfg);
  const result = await sendTestEmail({ ...cfg, to });
  if (result.ok) {
    redirect(`/admin/email?ok=sent&to=${encodeURIComponent(to)}`);
  } else {
    redirect(`/admin/email?error=send&msg=${encodeURIComponent(result.error)}`);
  }
}
