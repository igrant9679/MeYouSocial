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
    purpose: "voice",
    model: channel.defaultModel ?? "",
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
  await db.profileVersion.deleteMany({ where: { kind: "voice", profileId: profile.id } });
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

// ── Re-training makes a new version (E-SET-07) ─────────────────────────────

type Sample = { id: string; label: string; chars: number; body: string };

/** The newest writing samples, trimmed to a budget — training input for the model. */
function samplesBlock(samples: Sample[], budget = 12_000): string {
  const parts: string[] = [];
  let left = budget;
  for (const s of [...samples].reverse()) {
    if (left <= 200) break;
    const body = s.body.slice(0, left);
    parts.push(`--- ${s.label} ---\n${body}`);
    left -= body.length;
  }
  return parts.length ? `\n\nWriting samples by this creator — match how they actually write:\n${parts.join("\n\n")}` : "";
}

const voiceBack = (channelId: string, voiceId: string, msg: string, ok = false): never =>
  redirect(`/channels/${channelId}/voice?profile=${voiceId}&${ok ? "ok" : "err"}=${encodeURIComponent(msg)}`);

/**
 * Ask the model for the whole profile back, apply it, and keep it as a version.
 * The scratch keys ("_preview"…) stay as they were; a mock or non-JSON answer
 * changes nothing and says so (ENG-06 — fluent mock text must never stand in
 * for a trained voice).
 */
async function retrainVoice(opts: { channelId: string; voiceId: string; workspaceId: string; userId: string; ask: string; label: string; trainedFrom?: string }) {
  const profile = await db.voiceProfile.findFirst({ where: { id: opts.voiceId, channelId: opts.channelId, channel: { workspaceId: opts.workspaceId } } });
  if (!profile) return;
  const { jsonObjectFrom, saveVersion, voiceSnapshot } = await import("@/lib/profile-versions");
  const before = voiceSnapshot(profile.data);
  const samples = readJson<Sample[]>(profile.samples, []);
  const result = await llm.complete({
    purpose: "voice",
    model: "claude-sonnet",
    system: "You maintain a creator's voice profile. Return the COMPLETE updated profile as ONE JSON object with the same keys as the current one (archetype, delivery, rhetoric, diction, extras, summary, …). Respond with the JSON object only.",
    messages: [{ role: "user", content: `${opts.ask}\n\nCurrent profile JSON:\n${JSON.stringify(before, null, 2)}${samplesBlock(samples)}` }],
    workspaceId: opts.workspaceId,
  });
  if (result.provider === "mock") voiceBack(opts.channelId, profile.id, "No AI provider this workspace can use answered — nothing changed.");
  const next = jsonObjectFrom(result.content);
  if (!next) voiceBack(opts.channelId, profile.id, "The model's answer wasn't a voice profile — nothing changed.");
  const content = voiceSnapshot(JSON.stringify(next));
  if (opts.trainedFrom) content.source = { trained: true, basis: opts.trainedFrom };
  const scratch = Object.fromEntries(Object.entries(readJson<Record<string, unknown>>(profile.data, {})).filter(([k]) => k.startsWith("_")));
  await db.voiceProfile.update({ where: { id: profile.id }, data: { data: writeJson({ ...content, ...scratch }) } });
  await saveVersion({ kind: "voice", profileId: profile.id, channelId: opts.channelId, snapshot: content, label: opts.label, userId: opts.userId, before });
  revalidatePath(`/channels/${opts.channelId}/voice`);
  return profile.id;
}

/** Simple mode: tweak the voice with natural-language instructions — the writing samples inform it. */
export async function refineVoiceSimpleAction(formData: FormData) {
  const channelId = String(formData.get("channelId"));
  const voiceId = String(formData.get("voiceId"));
  const instruction = String(formData.get("instruction") ?? "").trim().slice(0, 500);
  if (!instruction) return;
  const { workspace, user } = await requireRole("EDITOR");
  const id = await retrainVoice({ channelId, voiceId, workspaceId: workspace.id, userId: user.id, ask: `Apply this instruction: ${instruction}`, label: `Refined: ${instruction}` });
  if (id) {
    const p = await db.voiceProfile.findUnique({ where: { id }, select: { data: true } });
    await db.voiceProfile.update({ where: { id }, data: { data: writeJson({ ...readJson<Record<string, unknown>>(p?.data ?? "{}", {}), _lastInstruction: instruction }) } });
    voiceBack(channelId, id, "Refined — kept as a new version.", true);
  }
}

/** Re-derive the voice from the writing samples alone. */
export async function retrainVoiceFromSamplesAction(formData: FormData) {
  const channelId = String(formData.get("channelId"));
  const voiceId = String(formData.get("voiceId"));
  const { workspace, user } = await requireRole("EDITOR");
  const profile = await db.voiceProfile.findFirst({ where: { id: voiceId, channelId, channel: { workspaceId: workspace.id } }, select: { samples: true } });
  if (!profile) return;
  const n = readJson<Sample[]>(profile.samples, []).length;
  if (!n) voiceBack(channelId, voiceId, "Add a writing sample first — retraining reads them.");
  const basis = `${n} writing sample${n === 1 ? "" : "s"}`;
  const id = await retrainVoice({
    channelId, voiceId, workspaceId: workspace.id, userId: user.id,
    ask: "Derive this creator's voice from their writing samples below: how they open, their sentence rhythm, word choice, humour, how they argue and sign off. Keep what the samples don't contradict.",
    label: `Retrained from ${basis}`,
    trainedFrom: basis,
  });
  if (id) voiceBack(channelId, id, `Retrained from ${basis} — kept as a new version.`, true);
}

/** Advanced mode: persist the full structured edit, as a version. */
export async function updateVoiceAdvancedAction(formData: FormData) {
  const channelId = String(formData.get("channelId"));
  const voiceId = String(formData.get("voiceId"));
  const raw = String(formData.get("data") ?? "{}");

  const { workspace, user } = await requireRole("EDITOR");
  const profile = await db.voiceProfile.findFirst({
    where: { id: voiceId, channel: { workspaceId: workspace.id } },
  });
  if (!profile) return;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) voiceBack(channelId, profile.id, "That isn't a JSON object — nothing was saved.");

  const { saveVersion, voiceSnapshot } = await import("@/lib/profile-versions");
  const before = voiceSnapshot(profile.data);
  await db.voiceProfile.update({
    where: { id: profile.id },
    data: { data: writeJson(parsed) },
  });
  await saveVersion({ kind: "voice", profileId: profile.id, channelId: profile.channelId, snapshot: voiceSnapshot(JSON.stringify(parsed)), label: "Edited", userId: user.id, before });
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
    purpose: "voice",
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
