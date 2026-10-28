"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";

// Snooze and assign on the Inbox (E-SHL-03). An item key names a card —
// post:<id> · article:<postId> · image:<id> · citation:<id> · invite:<id>
// (lib/inbox.ts `inboxKey`). Keys are only ever matched against this
// workspace's own items, so a made-up one stores nothing anyone sees.

const KEY = /^(post|article|image|citation|invite):[A-Za-z0-9_-]{6,64}$/;
const SNOOZE_DAYS: Record<string, number> = { "1d": 1, "3d": 3, "1w": 7 };

/** Set an item aside for a day, three days or a week — this person's Inbox only. `for=wake` brings it back. */
export async function snoozeInboxItemAction(formData: FormData) {
  const { workspace, user } = await requireRole("EDITOR");
  const itemKey = String(formData.get("key") ?? "");
  const length = String(formData.get("for") ?? "");
  if (!KEY.test(itemKey)) return;
  const where = { workspaceId_userId_itemKey: { workspaceId: workspace.id, userId: user.id, itemKey } };
  if (length === "wake") {
    await db.inboxSnooze.deleteMany({ where: { workspaceId: workspace.id, userId: user.id, itemKey } });
  } else {
    const days = SNOOZE_DAYS[length];
    if (!days) return;
    const until = new Date(Date.now() + days * 86_400_000);
    await db.inboxSnooze.upsert({ where, create: { workspaceId: workspace.id, userId: user.id, itemKey, until }, update: { until } });
  }
  revalidatePath("/inbox");
}

/** Take an item (`intent=take`, from whoever had it) or let it go (`intent=release`, your own only). */
export async function assignInboxItemAction(formData: FormData) {
  const { workspace, user } = await requireRole("EDITOR");
  const itemKey = String(formData.get("key") ?? "");
  const intent = String(formData.get("intent") ?? "");
  if (!KEY.test(itemKey)) return;
  if (intent === "take") {
    await db.inboxAssignment.upsert({
      where: { workspaceId_itemKey: { workspaceId: workspace.id, itemKey } },
      create: { workspaceId: workspace.id, itemKey, userId: user.id },
      update: { userId: user.id },
    });
  } else if (intent === "release") {
    await db.inboxAssignment.deleteMany({ where: { workspaceId: workspace.id, itemKey, userId: user.id } });
  } else return;
  revalidatePath("/inbox");
}
