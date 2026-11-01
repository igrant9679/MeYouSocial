"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";

// Saved hashtag sets and snippets (E-SOC-10), kept on Distribute → Compose
// where they're used. Editors manage them; everyone composing sees them.

const back = (q: string): never => redirect(`/social/compose?${q}#snippets`);

export async function saveSnippetAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const name = String(formData.get("name") ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const body = String(formData.get("body") ?? "").trim().slice(0, 2000);
  const category = String(formData.get("category") ?? "").trim().slice(0, 40) || null;
  if (!name || !body) back("err=" + encodeURIComponent("A snippet needs a name and its text."));
  const count = await db.socialSnippet.count({ where: { workspaceId: workspace.id } });
  if (count >= 100) back("err=" + encodeURIComponent("Up to 100 snippets — delete one you no longer use."));
  await db.socialSnippet.create({ data: { workspaceId: workspace.id, name, body, category } });
  revalidatePath("/social/compose");
  back("ok=" + encodeURIComponent(`Saved “${name}” — it's under the post text as you compose.`));
}

export async function deleteSnippetAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  const r = await db.socialSnippet.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/social/compose");
  back(r.count ? "ok=" + encodeURIComponent("Snippet deleted.") : "err=" + encodeURIComponent("That snippet is already gone."));
}
