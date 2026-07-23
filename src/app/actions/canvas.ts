"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { readJson, writeJson } from "@/lib/db/json";
import { llm } from "@/lib/llm";
import { countWords, durationSeconds, MAX_WORDS } from "@/lib/canvas/duration";
import { systemForOutline, systemForScript, systemForImprove, HUMANIZE_SYSTEM } from "@/lib/canvas/prompts";

// Helper — load + authorize a script.
async function load(scriptId: string) {
  const { workspace, user } = await requireRole("EDITOR");
  const script = await db.script.findFirst({
    where: { id: scriptId, channel: { workspaceId: workspace.id } },
    include: {
      channel: { include: { voiceProfiles: true, audience: true, memory: { orderBy: { createdAt: "asc" } } } },
      template: true,
    },
  });
  if (!script) throw new Error("not found");
  return { script, workspace, user };
}

/** Resolve the active voice profile for a script: explicit override → channel default. */
function voiceText(script: { voiceProfileId: string | null; channel: { voiceProfiles: { id: string; isDefault: boolean; data: string }[] } }): string {
  const chosen = script.voiceProfileId
    ? script.channel.voiceProfiles.find((v) => v.id === script.voiceProfileId)
    : script.channel.voiceProfiles.find((v) => v.isDefault) ?? script.channel.voiceProfiles[0];
  if (!chosen) return "Default warm-curious voice; spoken-style YouTube long-form.";
  try { return JSON.stringify(JSON.parse(chosen.data)); } catch { return chosen.data; }
}

function templateName(script: { template: { name: string; structure: string } | null }): string {
  if (!script.template) return "Flexible";
  return script.template.name;
}

// ── Plan Q&A ──────────────────────────────────────────────────────────────
const planSchema = z.object({
  scriptId: z.string(),
  takeaway: z.string().max(2000).optional(),
  concerns: z.string().max(2000).optional(),
  points: z.string().max(4000).optional(),
  action: z.string().max(1000).optional(),
});

/** Save the planning answers (one-takeaway, concerns, points, action). */
export async function savePlanQuestionsAction(formData: FormData) {
  const parsed = planSchema.safeParse({
    scriptId: formData.get("scriptId"),
    takeaway: formData.get("takeaway") ?? undefined,
    concerns: formData.get("concerns") ?? undefined,
    points: formData.get("points") ?? undefined,
    action: formData.get("action") ?? undefined,
  });
  if (!parsed.success) return;
  const { script } = await load(parsed.data.scriptId);

  const outline = readJson<{ questions?: Record<string, string>; sections?: unknown }>(script.outline ?? null, {});
  outline.questions = {
    takeaway: parsed.data.takeaway ?? "",
    concerns: parsed.data.concerns ?? "",
    points: parsed.data.points ?? "",
    action: parsed.data.action ?? "",
  };
  await db.script.update({ where: { id: script.id }, data: { outline: writeJson(outline) } });
  revalidatePath(`/scripts/${script.id}`);
}

/** Generate (or regenerate) the outline using planning answers. */
export async function generateOutlineAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId"));
  const { script } = await load(scriptId);

  const outline = readJson<{ questions?: Record<string, string>; markdown?: string }>(script.outline ?? null, {});
  const audienceKQ = readJson<string[]>(script.channel.audience?.keyQuestions ?? null, []);

  const result = await llm.complete({
    model: script.model ?? script.channel.defaultModel ?? "claude-sonnet",
    system: systemForOutline({
      channelName: script.channel.name,
      niche: script.channel.nicheDescription ?? "",
      differentiation: script.channel.differentiation ?? "",
      audienceKQ,
      voice: voiceText(script),
      template: templateName(script),
      memory: script.channel.memory.map((m) => m.body),
    }),
    messages: [
      { role: "user", content: [
        `Title: ${script.title}`,
        outline.questions?.takeaway ? `Main takeaway: ${outline.questions.takeaway}` : "",
        outline.questions?.concerns ? `Audience concerns: ${outline.questions.concerns}` : "",
        outline.questions?.points ? `Points to cover: ${outline.questions.points}` : "",
        outline.questions?.action ? `Desired viewer action: ${outline.questions.action}` : "",
      ].filter(Boolean).join("\n") },
    ],
    workspaceId: script.channel.workspaceId,
  });

  // Snapshot to versions
  await db.scriptVersion.create({
    data: { scriptId: script.id, label: "outline", outline: result.content },
  });

  await db.script.update({
    where: { id: script.id },
    data: {
      outline: writeJson({ ...outline, markdown: result.content }),
      status: "planning",
    },
  });
  revalidatePath(`/scripts/${script.id}`);
}

/** Save manual edits to the outline markdown. */
export async function saveOutlineAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId"));
  const markdown = String(formData.get("markdown") ?? "");
  const { script } = await load(scriptId);
  const outline = readJson<{ markdown?: string; questions?: unknown }>(script.outline ?? null, {});
  outline.markdown = markdown;
  await db.script.update({ where: { id: script.id }, data: { outline: writeJson(outline) } });
  revalidatePath(`/scripts/${script.id}`);
}

// ── Script body ───────────────────────────────────────────────────────────

/** Expand the approved outline into full prose. */
export async function generateScriptAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId"));
  const { script } = await load(scriptId);
  const outline = readJson<{ markdown?: string }>(script.outline ?? null, {});

  if (!outline.markdown) {
    // No outline yet — short-circuit; the UI shouldn't allow this.
    return;
  }

  const result = await llm.complete({
    model: script.model ?? script.channel.defaultModel ?? "claude-sonnet",
    system: systemForScript({
      channelName: script.channel.name,
      niche: script.channel.nicheDescription ?? "",
      voice: voiceText(script),
      template: templateName(script),
      lengthGuide: "8-12 minutes (~1500-2400 words)",
      memory: script.channel.memory.map((m) => m.body),
    }),
    messages: [{ role: "user", content: `Outline:\n\n${outline.markdown}\n\nExpand into a full script.` }],
    workspaceId: script.channel.workspaceId,
  });

  const words = countWords(result.content);
  await db.scriptVersion.create({
    data: { scriptId: script.id, label: "script-generated", body: result.content, wordCount: words },
  });

  await db.script.update({
    where: { id: script.id },
    data: {
      body: result.content,
      wordCount: Math.min(words, MAX_WORDS),
      durationSeconds: durationSeconds(words),
      status: "draft",
    },
  });
  revalidatePath(`/scripts/${script.id}`);
}

/** Autosave the body. Called from the client editor on debounce. */
export async function saveBodyAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId"));
  const body = String(formData.get("body") ?? "");
  const { script } = await load(scriptId);
  const words = countWords(body);
  await db.script.update({
    where: { id: script.id },
    data: {
      body,
      wordCount: Math.min(words, MAX_WORDS),
      durationSeconds: durationSeconds(words),
    },
  });
  // No revalidate — autosave shouldn't bounce the UI.
}

// ── Humanize / Improve ────────────────────────────────────────────────────

/** Humanize: rewrite to strip AI patterns, ~6-7th grade, AI-VO friendly. */
export async function humanizeAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId"));
  const { script } = await load(scriptId);
  if (!script.body) return;

  const result = await llm.complete({
    model: script.model ?? script.channel.defaultModel ?? "claude-sonnet",
    system: HUMANIZE_SYSTEM,
    messages: [
      { role: "user", content: `Voice profile: ${voiceText(script)}\n\nScript to humanize:\n\n${script.body}` },
    ],
    workspaceId: script.channel.workspaceId,
  });

  await db.scriptVersion.create({
    data: { scriptId: script.id, label: "pre-humanize", body: script.body, wordCount: script.wordCount },
  });

  const words = countWords(result.content);
  await db.script.update({
    where: { id: script.id },
    data: {
      body: result.content,
      wordCount: Math.min(words, MAX_WORDS),
      durationSeconds: durationSeconds(words),
    },
  });
  revalidatePath(`/scripts/${script.id}`);
}

/** Highlight-and-Improve. Replaces the supplied selection range in the body. */
export async function improveSelectionAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId"));
  const start = Number(formData.get("start"));
  const end = Number(formData.get("end"));
  const instruction = String(formData.get("instruction") ?? "");
  const { script } = await load(scriptId);
  if (!script.body) return;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return;

  const selection = script.body.slice(start, end);
  if (!selection.trim()) return;

  const result = await llm.complete({
    model: script.model ?? script.channel.defaultModel ?? "claude-sonnet",
    system: systemForImprove(instruction),
    messages: [{ role: "user", content: selection }],
    workspaceId: script.channel.workspaceId,
  });

  const newBody = script.body.slice(0, start) + result.content.trim() + script.body.slice(end);
  const words = countWords(newBody);

  await db.scriptVersion.create({
    data: { scriptId: script.id, label: `improve: ${instruction.slice(0, 40)}`, body: script.body, wordCount: script.wordCount },
  });
  await db.script.update({
    where: { id: script.id },
    data: { body: newBody, wordCount: Math.min(words, MAX_WORDS), durationSeconds: durationSeconds(words) },
  });
  revalidatePath(`/scripts/${script.id}`);
}

// ── Misc ──────────────────────────────────────────────────────────────────

/** Start over (same topic). Wipes outline + body but keeps title/channel. */
export async function startOverAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId"));
  const { script } = await load(scriptId);
  if (script.body) {
    await db.scriptVersion.create({
      data: { scriptId: script.id, label: "start-over-snapshot", body: script.body, outline: script.outline, wordCount: script.wordCount },
    });
  }
  await db.script.update({
    where: { id: script.id },
    data: { outline: null, body: null, wordCount: 0, durationSeconds: 0, status: "draft" },
  });
  revalidatePath(`/scripts/${script.id}`);
}

const settingsSchema = z.object({
  scriptId: z.string(),
  title: z.string().min(1).max(200),
  model: z.string().max(80).optional(),
  templateId: z.string().max(80).optional(),
  voiceProfileId: z.string().max(80).optional(),
});

/** + — Title + model + template + voice (switchable mid-script). */
export async function updateScriptSettingsAction(formData: FormData) {
  const parsed = settingsSchema.safeParse({
    scriptId: formData.get("scriptId"),
    title: formData.get("title"),
    model: formData.get("model") || undefined,
    templateId: formData.get("templateId") || undefined,
    voiceProfileId: formData.get("voiceProfileId") || undefined,
  });
  if (!parsed.success) return;
  const { script } = await load(parsed.data.scriptId);
  await db.script.update({
    where: { id: script.id },
    data: {
      title: parsed.data.title,
      model: parsed.data.model || null,
      templateId: parsed.data.templateId || null,
      voiceProfileId: parsed.data.voiceProfileId || null,
    },
  });
  revalidatePath(`/scripts/${script.id}`);
}
