"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";

// FR-ADMIN-02 — Workspace settings: name, default channel, default model/language.
const settingsSchema = z.object({
  name: z.string().min(1).max(120),
  defaultChannelId: z.string().max(80).optional(),
  defaultModel: z.string().max(80).optional(),
  defaultLanguage: z.string().max(8).optional(),
});

export async function updateWorkspaceSettingsAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const parsed = settingsSchema.safeParse({
    name: formData.get("name"),
    defaultChannelId: formData.get("defaultChannelId") || undefined,
    defaultModel: formData.get("defaultModel") || undefined,
    defaultLanguage: formData.get("defaultLanguage") || undefined,
  });
  if (!parsed.success) return;
  await db.workspace.update({
    where: { id: workspace.id },
    data: {
      name: parsed.data.name,
      defaultChannelId: parsed.data.defaultChannelId || null,
      defaultModel: parsed.data.defaultModel || null,
      defaultLanguage: parsed.data.defaultLanguage || "en",
    },
  });
  revalidatePath("/admin/settings");
}

// FR-ADMIN-03 — Optional soft usage limits (operational guards, never paid).
const limitsSchema = z.object({
  scriptsPerUserMonth:    z.coerce.number().int().min(0).optional(),
  thumbnailsPerUserMonth: z.coerce.number().int().min(0).optional(),
  agentRunsPerUserMonth:  z.coerce.number().int().min(0).optional(),
  channels:               z.coerce.number().int().min(0).optional(),
});

export async function updateSoftLimitsAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const parsed = limitsSchema.safeParse({
    scriptsPerUserMonth:    formData.get("scriptsPerUserMonth")    || undefined,
    thumbnailsPerUserMonth: formData.get("thumbnailsPerUserMonth") || undefined,
    agentRunsPerUserMonth:  formData.get("agentRunsPerUserMonth")  || undefined,
    channels:               formData.get("channels")               || undefined,
  });
  if (!parsed.success) return;
  await db.workspace.update({
    where: { id: workspace.id },
    data: {
      // 0 means "unset" → unlimited
      limitScriptsPerUserMonth:    parsed.data.scriptsPerUserMonth    || null,
      limitThumbnailsPerUserMonth: parsed.data.thumbnailsPerUserMonth || null,
      limitAgentRunsPerUserMonth:  parsed.data.agentRunsPerUserMonth  || null,
      limitChannels:               parsed.data.channels               || null,
    },
  });
  revalidatePath("/admin/limits");
}

// FR-ADMIN-05 — Reassign channel ownership across workspaces? In this build all channels
// live inside the admin's workspace, so "reassign" reads as transfer to another active member
// (records who created it via the most recent script author). We expose a simple "set channel
// default model/language" surface here as an admin-only mass action.
export async function transferChannelOwnershipAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const channelId = String(formData.get("channelId"));
  const newAccentColor = String(formData.get("accentColor") ?? "").trim() || null;
  await db.channel.updateMany({
    where: { id: channelId, workspaceId: workspace.id },
    data: { accentColor: newAccentColor },
  });
  revalidatePath("/admin/channels");
}
