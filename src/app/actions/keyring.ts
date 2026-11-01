"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole, isPlatformOperator } from "@/lib/acl";
import { writeAudit } from "@/lib/governance";
import { keyring } from "@/lib/keyring";
import { reencryptAll } from "@/lib/keyring-sweep";
import { invalidateSettingsCache } from "@/lib/settings";

const back = (q: string) => redirect(`/admin/keyring?${q}`);

/**
 * Re-encrypt every stored secret with the current key (E-SEC-04): plain-text
 * settings, ones under an older key and ones written before key ids. The
 * operator's button — it rewrites every tenant's secrets — behind a confirmation.
 * Each workspace whose secrets moved gets an audit row (no notice: no key changed).
 */
export async function reencryptAction(formData: FormData) {
  const { user } = await requireRole("ADMIN");
  if (!isPlatformOperator(user.email)) redirect("/forbidden?why=operator");
  if (formData.get("confirm") !== "yes") back("flashErr=" + encodeURIComponent("Tick the confirmation first."));
  const kid = keyring().current?.id;
  if (!kid) back("flashErr=" + encodeURIComponent("TOKEN_ENCRYPTION_KEY isn't set — there's no key to encrypt with."));

  const r = await reencryptAll();
  invalidateSettingsCache();
  for (const [workspaceId, n] of r.byWorkspace) {
    if (!workspaceId) continue;
    await writeAudit({ workspaceId, actorId: user.id, action: "security.keyring_reencrypted", entityType: "keyring", entityId: kid, meta: { secrets: n, key: kid } });
  }
  console.info(`[keyring] re-encrypted ${r.written} secret(s) with key ${kid}; ${r.skipped} changed meanwhile, ${r.unreadable} unreadable`);
  revalidatePath("/admin/keyring");
  const parts = [`Re-encrypted ${r.written} secret${r.written === 1 ? "" : "s"} with key ${kid}.`];
  if (r.skipped) parts.push(`${r.skipped} changed while this ran and kept their new value — run it again.`);
  if (r.unreadable) parts.push(`${r.unreadable} can't be read with any configured key and were left alone.`);
  back("flash=" + encodeURIComponent(parts.join(" ")));
}
