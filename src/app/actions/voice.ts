"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { readJson, writeJson } from "@/lib/db/json";
import { llm } from "@/lib/llm";

/** FR-VOICE-03 — Simple mode: tweak the voice with natural-language instructions. */
export async function refineVoiceSimpleAction(formData: FormData) {
  const channelId = String(formData.get("channelId"));
  const voiceId = String(formData.get("voiceId"));
  const instruction = String(formData.get("instruction") ?? "").trim();
  if (!instruction) return;

  const { workspace } = await requireRole("EDITOR");
  const profile = await db.voiceProfile.findFirst({
    where: { id: voiceId, channel: { workspaceId: workspace.id } },
  });
  if (!profile) return;

  const current = readJson<Record<string, unknown>>(profile.data, {});
  // Ask the LLM to apply the instruction to the structured voice payload.
  const result = await llm.complete({
    model: "claude-sonnet",
    system: "You revise a creator voice profile. Apply the user's natural-language instruction and return the updated JSON.",
    messages: [
      { role: "user", content: `Instruction: ${instruction}\n\nCurrent profile JSON:\n${JSON.stringify(current, null, 2)}` },
    ],
  });

  await db.voiceProfile.update({
    where: { id: profile.id },
    data: {
      data: writeJson({ ...current, _lastInstruction: instruction, _refined: result.content.slice(0, 1500) }),
    },
  });
  revalidatePath(`/channels/${channelId}/voice`);
}

/** FR-VOICE-04 — Advanced mode: persist the full structured edit. */
export async function updateVoiceAdvancedAction(formData: FormData) {
  const channelId = String(formData.get("channelId"));
  const voiceId = String(formData.get("voiceId"));
  const raw = String(formData.get("data") ?? "{}");

  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return; }

  const { workspace } = await requireRole("EDITOR");
  const profile = await db.voiceProfile.findFirst({
    where: { id: voiceId, channel: { workspaceId: workspace.id } },
  });
  if (!profile) return;

  await db.voiceProfile.update({
    where: { id: profile.id },
    data: { data: writeJson(parsed) },
  });
  revalidatePath(`/channels/${channelId}/voice`);
}

/** FR-VOICE-08 — Instant, free voice preview. Stored on the profile so the page can show it. */
export async function generateVoicePreviewAction(formData: FormData) {
  const channelId = String(formData.get("channelId"));
  const voiceId = String(formData.get("voiceId"));
  const { workspace } = await requireRole("EDITOR");
  const profile = await db.voiceProfile.findFirst({
    where: { id: voiceId, channel: { workspaceId: workspace.id } },
    include: { channel: true },
  });
  if (!profile) return;

  const current = readJson<Record<string, unknown>>(profile.data, {});
  const sample = await llm.complete({
    model: "claude-sonnet",
    system: "You write a short (3-4 sentence) sample of YouTube spoken-style script that demonstrates the supplied voice profile.",
    messages: [
      { role: "user", content: `Niche: ${profile.channel.nicheDescription}\nVoice profile: ${JSON.stringify(current)}\n\nProduce a hook + first beat.` },
    ],
  });

  await db.voiceProfile.update({
    where: { id: profile.id },
    data: { data: writeJson({ ...current, _preview: sample.content.slice(0, 1500) }) },
  });
  revalidatePath(`/channels/${channelId}/voice`);
}
