"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getPublicUrl } from "@/lib/public-url";
import {
  hostedAuthLink,
  unipileConfigured,
  EMAIL_PROVIDERS,
} from "@/lib/unipile";

// Category → the Unipile provider set the wizard offers.
const CATEGORY_PROVIDERS: Record<string, readonly string[]> = {
  email: EMAIL_PROVIDERS,
  linkedin: ["LINKEDIN"],
  instagram: ["INSTAGRAM"],
  x: ["X"],
};

/**
 * Start connecting an account: build a Unipile hosted-auth wizard link and send
 * the admin to it. We pass name=<workspaceId> so the webhook can attach the
 * connected account to this company.
 */
export async function connectAccountAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const category = String(formData.get("category") ?? "");
  const providers = CATEGORY_PROVIDERS[category];
  if (!providers) redirect("/admin/connections?err=category");
  if (!(await unipileConfigured())) redirect("/admin/connections?err=unconfigured");

  const origin = await getPublicUrl();
  let url: string;
  try {
    url = await hostedAuthLink({
      providers,
      name: workspace.id,
      notifyUrl: `${origin}/api/unipile/webhook`,
      successUrl: `${origin}/admin/connections?connected=1`,
      failureUrl: `${origin}/admin/connections?failed=1`,
    });
  } catch (e) {
    redirect(`/admin/connections?err=${encodeURIComponent(e instanceof Error ? e.message : "link failed")}`);
  }
  redirect(url);
}

export async function disconnectAccountAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  await db.unipileAccount.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/admin/connections");
  redirect("/admin/connections?ok=disconnected");
}

/** Make an account the default sender/poster for its kind+provider. */
export async function setDefaultAccountAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const row = await db.unipileAccount.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!row) redirect("/admin/connections");
  await db.$transaction([
    db.unipileAccount.updateMany({
      where: { workspaceId: workspace.id, kind: row.kind, provider: row.provider },
      data: { isDefault: false },
    }),
    db.unipileAccount.update({ where: { id: row.id }, data: { isDefault: true } }),
  ]);
  revalidatePath("/admin/connections");
  redirect("/admin/connections?ok=default");
}

/**
 * Platform-operator only: save the Unipile DSN + API key (one account serves
 * every tenant). Gated to BOOTSTRAP_ADMIN_EMAIL like storage.
 */
export async function saveUnipileConfigAction(formData: FormData) {
  const { user } = await requireRole("ADMIN");
  if (!env.BOOTSTRAP_ADMIN_EMAIL || user.email !== env.BOOTSTRAP_ADMIN_EMAIL) {
    redirect("/admin/connections?err=" + encodeURIComponent("Unipile is configured by the platform operator."));
  }
  const setting = String(formData.get("setting") ?? "");
  const value = String(formData.get("value") ?? "").trim();
  if (setting !== "unipile:dsn" && setting !== "unipile:api_key") return;
  const { setPlatformSetting } = await import("@/lib/settings");
  await setPlatformSetting(setting, value);
  revalidatePath("/admin/connections");
  redirect("/admin/connections?ok=config");
}
