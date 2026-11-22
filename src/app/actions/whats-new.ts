"use server";

import { revalidatePath } from "next/cache";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { WHATS_NEW, whatsNewKey } from "@/lib/whats-new";

// The Inbox's "What's new" card: "Got it" hides the entries it showed, for this
// person, in every workspace (lib/whats-new.ts). A dismissal is an `ElsieDismissal`
// row keyed "new:<id>", stored against the workspace it was pressed in and READ
// across all of the person's workspaces (components/WhatsNew.tsx). Only ids on the
// list are stored, so a made-up one writes nothing. Any role may dismiss: it is
// the person's own view, not the workspace's data.

const KNOWN = new Set(WHATS_NEW.map((e) => e.id));

export async function dismissWhatsNewAction(formData: FormData) {
  const { workspace, user } = await requireMembership();
  const ids = [...new Set(formData.getAll("id").map(String))].filter((id) => KNOWN.has(id)).slice(0, WHATS_NEW.length);
  if (!ids.length) return;
  await db.elsieDismissal.createMany({
    data: ids.map((id) => ({ workspaceId: workspace.id, userId: user.id, key: whatsNewKey(id) })),
    skipDuplicates: true,
  });
  revalidatePath("/inbox");
}
