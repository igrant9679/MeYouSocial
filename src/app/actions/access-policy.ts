"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { writeAudit } from "@/lib/governance";
import { setWorkspaceSetting } from "@/lib/settings";
import { DOMAINS_SETTING, GOOGLE_ONLY_SETTING, EXPIRE_SETTING, EXPIRE_CHOICES, parseDomains, googleSsoAvailable } from "@/lib/access-policy";

// People → Access (E-SEC-08, E-SEC-18): which email domains may join, whether
// members sign in with Google, and when idle editors and viewers lose access.
// Admins only; each change is audited, which tells the other admins.

function back(formData: FormData, q: string): never {
  const raw = String(formData.get("returnTo") ?? "");
  const to = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/setup/people";
  redirect(`${to}${to.includes("?") ? "&" : "?"}${q}#access`);
}

export async function saveAccessPolicyAction(formData: FormData) {
  const { workspace, user } = await requireRole("ADMIN");
  const raw = String(formData.get("domains") ?? "");
  const domains = parseDomains(raw);
  if (raw.trim() && !domains.length) back(formData, "flashErr=" + encodeURIComponent("Those don't look like email domains — e.g. acme.com, acme.co.uk."));
  // An admin can't fence themselves out by mistake.
  const mine = user.email.toLowerCase().split("@").pop() ?? "";
  if (domains.length && !domains.includes(mine)) back(formData, "flashErr=" + encodeURIComponent(`Include your own domain (@${mine}) — otherwise you couldn't invite anyone like you.`));

  const days = Number(formData.get("expire") ?? 0);
  const expire = (EXPIRE_CHOICES as readonly number[]).includes(days) ? days : 0;
  const google = formData.get("google") === "on";
  if (google && !googleSsoAvailable()) back(formData, "flashErr=" + encodeURIComponent("Google sign-in isn't switched on for this install — the platform operator enables it."));

  await setWorkspaceSetting(workspace.id, DOMAINS_SETTING, domains.join(","));
  await setWorkspaceSetting(workspace.id, EXPIRE_SETTING, expire ? String(expire) : "");
  await setWorkspaceSetting(workspace.id, GOOGLE_ONLY_SETTING, google ? "true" : "");
  await writeAudit({
    workspaceId: workspace.id, actorId: user.id, action: "security.access_policy_changed", entityType: "workspace", entityId: workspace.id,
    meta: { domains, expireDays: expire, googleOnly: google },
  });
  revalidatePath("/setup/people");
  back(formData, "flash=" + encodeURIComponent("Access rules saved."));
}
