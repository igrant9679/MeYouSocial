"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { llm } from "@/lib/llm";
import { shareKey, stopShare } from "@/lib/key-shares";

// Admin-only: let another workspace use one of this workspace's keys, and end
// that. The rules live in lib/key-shares.ts and are checked there, on the
// server — requireRole("ADMIN") here is the giving (or taking) side's half.

// `flash` / `flashErr` are the app-wide banner (FlashBanner): seen wherever the page is scrolled to.
const back = (kind: "flash" | "flashErr", msg: string) => `/admin/api-keys?${kind}=${encodeURIComponent(msg)}#shared`;

export async function shareKeyAction(formData: FormData) {
  const { workspace, user } = await requireRole("ADMIN");
  const key = String(formData.get("key") ?? "");
  const toWorkspaceId = String(formData.get("to") ?? "");
  if (!key || !toWorkspaceId) redirect(back("flashErr", "Choose a key and a workspace to share it with."));
  const res = await shareKey({ fromWorkspaceId: workspace.id, toWorkspaceId, key, actorId: user.id });
  llm.invalidateKeyCache();
  revalidatePath("/admin/api-keys");
  if (!res.ok) redirect(back("flashErr", res.error));
  redirect(back("flash", `${res.other} can now use this workspace's ${res.label} key, within about 30 seconds. Its calls are billed to this key's account and count against the same limits. A key of its own there would be used instead.`));
}

export async function stopKeyShareAction(formData: FormData) {
  const { workspace, user } = await requireRole("ADMIN");
  const res = await stopShare({ shareId: String(formData.get("share") ?? ""), workspaceId: workspace.id, actorId: user.id });
  llm.invalidateKeyCache();
  revalidatePath("/admin/api-keys");
  if (!res.ok) redirect(back("flashErr", res.error));
  redirect(back("flash", res.side === "giver"
    ? `${res.other} no longer uses this workspace's ${res.label} key. It falls back to the platform's key if there is one, or stops until it has a key.`
    : `This workspace no longer uses ${res.other}'s ${res.label} key. It falls back to the platform's key if there is one, or stops until a key is added.`));
}
