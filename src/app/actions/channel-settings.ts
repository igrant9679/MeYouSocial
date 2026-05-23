"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";

const schema = z.object({
  channelId: z.string(),
  name: z.string().min(2).max(120),
  nicheDescription: z.string().max(2000).optional(),
  differentiation: z.string().max(1000).optional(),
  linkedYoutubeHandle: z.string().max(200).optional(),
  defaultModel: z.string().max(80).optional(),
  defaultLanguage: z.string().max(8).optional(),
  defaultTemplateId: z.string().max(80).optional(),
});

export async function updateChannelSettingsAction(formData: FormData) {
  const parsed = schema.safeParse({
    channelId: formData.get("channelId"),
    name: formData.get("name"),
    nicheDescription: formData.get("nicheDescription") ?? undefined,
    differentiation: formData.get("differentiation") ?? undefined,
    linkedYoutubeHandle: formData.get("linkedYoutubeHandle") ?? undefined,
    defaultModel: formData.get("defaultModel") ?? undefined,
    defaultLanguage: formData.get("defaultLanguage") ?? undefined,
    defaultTemplateId: formData.get("defaultTemplateId") ?? undefined,
  });
  if (!parsed.success) return;

  const { workspace } = await requireRole("EDITOR");
  const exists = await db.channel.findFirst({ where: { id: parsed.data.channelId, workspaceId: workspace.id } });
  if (!exists) return;

  await db.channel.update({
    where: { id: parsed.data.channelId },
    data: {
      name: parsed.data.name,
      nicheDescription: parsed.data.nicheDescription || null,
      differentiation: parsed.data.differentiation || null,
      linkedYoutubeHandle: parsed.data.linkedYoutubeHandle || null,
      defaultModel: parsed.data.defaultModel || null,
      defaultLanguage: parsed.data.defaultLanguage || "en",
      defaultTemplateId: parsed.data.defaultTemplateId || null,
    },
  });
  revalidatePath(`/channels/${parsed.data.channelId}/settings`);
}
