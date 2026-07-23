"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { readJson, writeJson } from "@/lib/db/json";
import { llm } from "@/lib/llm";
import { youtubeFor } from "@/lib/youtube";

// ── — Writing samples ──────────────────────────────────────

const MAX_SAMPLE_CHARS = 50_000;

export async function addVoiceSampleAction(formData: FormData) {
  const voiceId = String(formData.get("voiceId"));
  const label = String(formData.get("label") ?? "").trim() || "Sample";
  const body = String(formData.get("body") ?? "").trim().slice(0, MAX_SAMPLE_CHARS);
  if (!body) return;

  const { workspace } = await requireRole("EDITOR");
  const profile = await db.voiceProfile.findFirst({
    where: { id: voiceId, channel: { workspaceId: workspace.id } },
  });
  if (!profile) return;

  const samples = readJson<{ id: string; label: string; chars: number; body: string }[]>(profile.samples, []);
  samples.push({ id: Math.random().toString(36).slice(2, 10), label, chars: body.length, body });
  await db.voiceProfile.update({ where: { id: profile.id }, data: { samples: writeJson(samples) } });
  revalidatePath(`/channels/${profile.channelId}/voice`);
}

export async function removeVoiceSampleAction(formData: FormData) {
  const voiceId = String(formData.get("voiceId"));
  const sampleId = String(formData.get("sampleId"));
  const { workspace } = await requireRole("EDITOR");
  const profile = await db.voiceProfile.findFirst({
    where: { id: voiceId, channel: { workspaceId: workspace.id } },
  });
  if (!profile) return;

  const samples = readJson<{ id: string; label: string; chars: number; body: string }[]>(profile.samples, []);
  const next = samples.filter((s) => s.id !== sampleId);
  await db.voiceProfile.update({ where: { id: profile.id }, data: { samples: writeJson(next) } });
  revalidatePath(`/channels/${profile.channelId}/voice`);
}

// ── — Borrow-a-voice from another channel ──────────────────

export async function borrowVoiceAction(formData: FormData) {
  const channelId = String(formData.get("channelId"));
  const handle = String(formData.get("handle") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim() || `Borrowed from ${handle}`;
  if (!handle) return;

  const { workspace } = await requireRole("EDITOR");
  const channel = await db.channel.findFirst({ where: { id: channelId, workspaceId: workspace.id } });
  if (!channel) return;

  // Look up the channel + grab its top-video transcripts.
  const source = await youtubeFor(workspace.id).findChannel(handle);
  if (!source) redirect(`/channels/${channelId}/voice?error=notfound`);

  const videos = await youtubeFor(workspace.id).listVideos(source!.id, 8);
  const usable = videos.filter((v) => v.durationSeconds >= 180).slice(0, 5);
  const transcripts = (await Promise.all(usable.map((v) => youtubeFor(workspace.id).getTranscript(v.id)))).filter(Boolean) as string[];

  const completion = await llm.complete({
    model: channel.defaultModel ?? "claude-sonnet",
    system: "You produce a structured voice profile from creator transcripts. Identify archetype, delivery, rhetoric, diction, and any signature phrases.",
    messages: [{
      role: "user",
      content: `Source channel: ${source!.handle ?? source!.name}\n\nTranscripts:\n${transcripts.join("\n\n---\n\n").slice(0, 12_000)}\n\nReturn a JSON-ish profile.`,
    }],
    workspaceId: workspace.id,
  });

  const data = {
    borrowedFrom: source!.handle ?? source!.name,
    summary: completion.content.slice(0, 2000),
    archetype: { age: "—", profession: "—" },
    delivery: { cadence: "matched-to-source" },
    rhetoric: { hooks: ["matched-to-source"] },
    diction: { vocabulary: "matched-to-source" },
  };

  const profile = await db.voiceProfile.create({
    data: {
      channelId,
      label,
      isDefault: false,
      data: writeJson(data),
      samples: writeJson(usable.map((v) => ({ id: v.id, label: v.title, chars: 0, body: "(transcript ref)" }))),
    },
  });
  revalidatePath(`/channels/${channelId}/voice`);
  redirect(`/channels/${channelId}/voice?profile=${profile.id}`);
}

// ── — Multiple voice profiles per channel ──────────────────

export async function createVoiceProfileAction(formData: FormData) {
  const channelId = String(formData.get("channelId"));
  const label = String(formData.get("label") ?? "").trim();
  if (!label) return;
  const { workspace } = await requireRole("EDITOR");
  const channel = await db.channel.findFirst({ where: { id: channelId, workspaceId: workspace.id } });
  if (!channel) return;

  const profile = await db.voiceProfile.create({
    data: {
      channelId,
      label,
      isDefault: false,
      data: writeJson({ note: "Edit in Advanced mode" }),
    },
  });
  revalidatePath(`/channels/${channelId}/voice`);
  redirect(`/channels/${channelId}/voice?profile=${profile.id}`);
}

export async function setDefaultVoiceAction(formData: FormData) {
  const voiceId = String(formData.get("voiceId"));
  const { workspace } = await requireRole("EDITOR");
  const profile = await db.voiceProfile.findFirst({
    where: { id: voiceId, channel: { workspaceId: workspace.id } },
  });
  if (!profile) return;
  await db.$transaction([
    db.voiceProfile.updateMany({ where: { channelId: profile.channelId }, data: { isDefault: false } }),
    db.voiceProfile.update({ where: { id: profile.id }, data: { isDefault: true } }),
  ]);
  revalidatePath(`/channels/${profile.channelId}/voice`);
}

export async function deleteVoiceProfileAction(formData: FormData) {
  const voiceId = String(formData.get("voiceId"));
  const { workspace } = await requireRole("EDITOR");
  const profile = await db.voiceProfile.findFirst({
    where: { id: voiceId, channel: { workspaceId: workspace.id } },
  });
  if (!profile || profile.isDefault) return; // Don't allow deleting the default
  await db.voiceProfile.delete({ where: { id: profile.id } });
  revalidatePath(`/channels/${profile.channelId}/voice`);
}

export async function setScriptVoiceAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId"));
  const voiceProfileId = formData.get("voiceProfileId") ? String(formData.get("voiceProfileId")) : null;
  const { workspace } = await requireRole("EDITOR");
  const script = await db.script.findFirst({
    where: { id: scriptId, channel: { workspaceId: workspace.id } },
  });
  if (!script) return;
  if (voiceProfileId) {
    const profile = await db.voiceProfile.findFirst({
      where: { id: voiceProfileId, channelId: script.channelId },
    });
    if (!profile) return;
  }
  await db.script.update({ where: { id: script.id }, data: { voiceProfileId } });
  revalidatePath(`/scripts/${scriptId}`);
}

/** Simple mode: tweak the voice with natural-language instructions. */
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
    workspaceId: workspace.id,
  });

  await db.voiceProfile.update({
    where: { id: profile.id },
    data: {
      data: writeJson({ ...current, _lastInstruction: instruction, _refined: result.content.slice(0, 1500) }),
    },
  });
  revalidatePath(`/channels/${channelId}/voice`);
}

/** Advanced mode: persist the full structured edit. */
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

/** Instant, free voice preview. Stored on the profile so the page can show it. */
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
    workspaceId: workspace.id,
  });

  await db.voiceProfile.update({
    where: { id: profile.id },
    data: { data: writeJson({ ...current, _preview: sample.content.slice(0, 1500) }) },
  });
  revalidatePath(`/channels/${channelId}/voice`);
}
