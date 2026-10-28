"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { llm } from "@/lib/llm";
import { readJson, writeJson } from "@/lib/db/json";
import { systemForScript } from "@/lib/canvas/prompts";
import { countWords, durationSeconds, MAX_WORDS } from "@/lib/canvas/duration";
import { RESEARCH_DEPTHS } from "@/lib/canvas/builder-const";
import { cleanTitle } from "@/lib/list-marker";
import { STUDIO_TIMEOUT_MS, placeholderProblem, templateBlock } from "@/lib/studio-ai";
import type { LLMResponse } from "@/lib/llm";

/** Stop before writing a placeholder (VID-05): back to the builder, saying why. */
async function refusePlaceholder(scriptId: string, res: LLMResponse, what: string): Promise<void> {
  const problem = placeholderProblem(res, what);
  if (problem) (await import("next/navigation")).redirect(`/scripts/${scriptId}/builder?flashErr=${encodeURIComponent(problem)}`);
}

//..12 — Script Builder Classic. 10-step alternative workflow:
//   1 Research · 2 Frame · 3 Title · 4 Thumbnail · 5 Hook · 6 Payoffs · 7 Draft · 8 Edit · 9 Export · 10 Publish.
// Each step's state lives in Script.builderSteps (JSON):
//   { step: number, research: {depth, items: []}, frame: {…}, title: "", titleVariants: [],
//     thumbnailId: "", hook: "", hookVariants: [], payoffs: [], sections: [{title, content}] }

type BuilderState = {
  step: number;
  research: { depth: keyof typeof RESEARCH_DEPTHS; items: { kind: string; ref: string; words: number; title?: string }[] };
  frame: { framework?: string; angle?: string; learningGoal?: string; emotionalGoal?: string };
  title: string;
  titleVariants: string[];
  thumbnailId?: string;
  hook: string;
  hookVariants: string[];
  payoffs: string[];
  sections: { title: string; content: string }[];
  publish?: { description?: string; tags?: string; metadata?: string };
};

const EMPTY: BuilderState = {
  step: 1,
  research: { depth: "intermediate", items: [] },
  frame: {},
  title: "",
  titleVariants: [],
  hook: "",
  hookVariants: [],
  payoffs: [],
  sections: [],
};

async function load(scriptId: string) {
  const { workspace, user } = await requireRole("EDITOR");
  const script = await db.script.findFirst({
    where: { id: scriptId, channel: { workspaceId: workspace.id } },
    include: { channel: { include: { voiceProfiles: { where: { isDefault: true } } } }, template: true },
  });
  if (!script) throw new Error("not found");
  const state: BuilderState = { ...EMPTY, ...readJson<Partial<BuilderState>>(script.builderSteps ?? null, EMPTY) };
  return { script, workspace, user, state };
}

async function save(scriptId: string, state: BuilderState) {
  await db.script.update({ where: { id: scriptId }, data: { builderSteps: writeJson(state), workflow: "builder" } });
  revalidatePath(`/scripts/${scriptId}/builder`);
}

function voiceText(script: { channel: { voiceProfiles: { data: string }[] } }): string {
  const v = script.channel.voiceProfiles[0];
  if (!v) return "Default warm-curious voice; spoken-style YouTube long-form.";
  try { return JSON.stringify(JSON.parse(v.data)); } catch { return v.data; }
}

// ── Step navigation ─────────────────────────────────────────────────────

export async function setBuilderStepAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId"));
  const step = Math.max(1, Math.min(10, Number(formData.get("step"))));
  const { state } = await load(scriptId);
  await save(scriptId, { ...state, step });
}

// ── Step 1 — Research ───────────────────────────────────────────────────

export async function setBuilderResearchDepthAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId"));
  const depth = String(formData.get("depth")) as keyof typeof RESEARCH_DEPTHS;
  if (!(depth in RESEARCH_DEPTHS)) return;
  const { state } = await load(scriptId);
  state.research.depth = depth;
  await save(scriptId, state);
}

export async function addBuilderResearchItemAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId"));
  const kind = String(formData.get("kind") ?? "text");
  const ref = String(formData.get("ref") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  if (!ref) return;
  const { state } = await load(scriptId);
  const words = ref.split(/\s+/).length;
  state.research.items.push({ kind, ref, title: title || ref.slice(0, 80), words });
  await save(scriptId, state);
}

// ── Step 2 — Frame ──────────────────────────────────────────────────────

export async function setBuilderFrameAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId"));
  const { state } = await load(scriptId);
  state.frame = {
    framework: String(formData.get("framework") ?? "").trim() || undefined,
    angle: String(formData.get("angle") ?? "").trim() || undefined,
    learningGoal: String(formData.get("learningGoal") ?? "").trim() || undefined,
    emotionalGoal: String(formData.get("emotionalGoal") ?? "").trim() || undefined,
  };
  state.step = Math.max(state.step, 2);
  await save(scriptId, state);
}

// ── Step 3 — Title ──────────────────────────────────────────────────────

export async function suggestBuilderTitlesAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId"));
  const { script, state } = await load(scriptId);
  const completion = await llm.complete({
    model: script.model ?? script.channel.defaultModel ?? "",
    system: "Produce 6 YouTube title candidates. Each <= 70 chars, distinct angle. One per line.",
    messages: [{ role: "user", content: `Niche: ${script.channel.nicheDescription}\nFraming: ${JSON.stringify(state.frame)}\nResearch summary: ${state.research.items.map((i) => i.title).join("; ")}\nCurrent working title: ${script.title}` }],
    workspaceId: script.channel.workspaceId,
  });
  await refusePlaceholder(scriptId, completion, "no titles were suggested");
  // cleanTitle, not /^[*\-\d.\s]+/: the greedy class also ate the sign off a
  // title that opens with one ("-40% in 30 days" → "40% in 30 days"), and left
  // wrapping quotes and ** alone (audit A3).
  state.titleVariants = completion.content.split("\n").map((s) => cleanTitle(s, 200)).filter(Boolean).slice(0, 6);
  await save(scriptId, state);
}

export async function pickBuilderTitleAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId"));
  const title = cleanTitle(String(formData.get("title") ?? ""), 200);
  if (!title) return;
  const { state } = await load(scriptId);
  state.title = title;
  await db.script.update({ where: { id: scriptId }, data: { title } });
  await save(scriptId, state);
}

// ── Step 5 — Hook ───────────────────────────────────────────────────────

export async function suggestBuilderHooksAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId"));
  const { script, state } = await load(scriptId);
  const completion = await llm.complete({
    model: script.model ?? script.channel.defaultModel ?? "",
    system: "Produce 5 distinct opening-hook variations (first 10-15s, spoken). 2-3 sentences each. No preamble. Separated by ---",
    messages: [{ role: "user", content: `Title: ${state.title || script.title}\nNiche: ${script.channel.nicheDescription}\nFraming: ${JSON.stringify(state.frame)}` }],
    workspaceId: script.channel.workspaceId,
  });
  await refusePlaceholder(scriptId, completion, "no hooks were suggested");
  state.hookVariants = completion.content.split(/---+/).map((s) => s.trim()).filter(Boolean).slice(0, 5);
  await save(scriptId, state);
}

export async function pickBuilderHookAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId"));
  const hook = String(formData.get("hook") ?? "").trim();
  if (!hook) return;
  const { state } = await load(scriptId);
  state.hook = hook;
  await save(scriptId, state);
}

// ── Step 6 — Payoffs ────────────────────────────────────────────────────

export async function setBuilderPayoffsAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId"));
  const raw = String(formData.get("payoffs") ?? "");
  const list = raw.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 12);
  const { state } = await load(scriptId);
  state.payoffs = list;
  await save(scriptId, state);
}

// ── Step 7 — Draft (section by section) ─────────────────────────────────

export async function generateBuilderDraftAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId"));
  const { script, state } = await load(scriptId);
  const templateName = templateBlock(script.template);

  // Build a planned outline from payoffs.
  const sectionPlan = [
    "Hook",
    ...state.payoffs.map((p, i) => `${i + 1}. ${p}`),
    "Conclusion + CTA",
  ];

  const sections: { title: string; content: string }[] = [];
  for (const heading of sectionPlan) {
    const completion = await llm.complete({
      model: script.model ?? script.channel.defaultModel ?? "",
      system: systemForScript({
        channelName: script.channel.name,
        niche: script.channel.nicheDescription ?? "",
        voice: voiceText(script),
        template: templateName,
        lengthGuide: heading === "Hook" || heading.startsWith("Conclusion") ? "60-90 seconds" : "2-3 minutes",
      }),
      messages: [
        { role: "user", content: `Generate ONLY the section titled "${heading}". \nTitle: ${state.title || script.title}\nHook (already chosen): ${state.hook}\nPayoffs: ${state.payoffs.join("; ")}` },
      ],
      workspaceId: script.channel.workspaceId,
      timeoutMs: STUDIO_TIMEOUT_MS.outline,
    });
    // Nothing is written until every section is real.
    await refusePlaceholder(scriptId, completion, "the draft was not written");
    sections.push({ title: heading, content: completion.content });
  }
  state.sections = sections;
  // Mirror the assembled body to script.body so the Canvas/Publish tools work on it too.
  const body = sections.map((s) => `**${s.title}**\n\n${s.content}`).join("\n\n");
  const words = countWords(body);
  const { snapshotScript } = await import("@/lib/script-versions");
  await snapshotScript(script, "before builder draft");
  await db.script.update({
    where: { id: scriptId },
    data: { body, wordCount: Math.min(words, MAX_WORDS), durationSeconds: durationSeconds(words) },
  });
  await save(scriptId, state);
}

export async function regenerateBuilderSectionAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId"));
  const sectionIndex = Number(formData.get("index"));
  const { script, state } = await load(scriptId);
  if (!state.sections[sectionIndex]) return;

  const section = state.sections[sectionIndex];
  // ⚠ VID-15: the body was rebuilt from the builder's stored sections, wiping
  // every edit made on the Canvas since, and the model got only the heading.
  // Now the section is found in the CURRENT body by its heading, its text is
  // what gets rewritten, and only that span is replaced.
  const current = script.body ?? "";
  const heading = `**${section.title}**`;
  const at = current.indexOf(heading);
  if (at < 0) {
    (await import("next/navigation")).redirect(`/scripts/${scriptId}/builder?flashErr=${encodeURIComponent(`“${section.title}” isn't a heading in the script any more (it was changed on the Canvas), so it can't be rewritten in place. Edit it on the Canvas instead.`)}`);
  }
  const from = at + heading.length;
  const nextAt = state.sections.map((s) => current.indexOf(`**${s.title}**`, from)).filter((i) => i > 0);
  const to = nextAt.length ? Math.min(...nextAt) : current.length;
  const text = current.slice(from, to).trim();
  const completion = await llm.complete({
    model: script.model ?? script.channel.defaultModel ?? "",
    system: systemForScript({
      channelName: script.channel.name,
      niche: script.channel.nicheDescription ?? "",
      voice: voiceText(script),
      template: templateBlock(script.template),
      lengthGuide: "2-3 minutes",
    }),
    messages: [{ role: "user", content: `Rewrite ONLY the section titled "${section.title}" of the video "${state.title || script.title}". Keep its point and its place in the script. Return only the new section text, without the heading.\n\nThe section as it stands:\n\n${text || "(empty)"}` }],
    workspaceId: script.channel.workspaceId,
    timeoutMs: STUDIO_TIMEOUT_MS.outline,
  });
  await refusePlaceholder(scriptId, completion, "the section is unchanged");
  const content = completion.content.trim();
  state.sections[sectionIndex] = { ...section, content };

  const rest = current.slice(to).replace(/^\s+/, "");
  const body = `${current.slice(0, from)}\n\n${content}${rest ? `\n\n${rest}` : ""}`;
  const words = countWords(body);
  const { snapshotScript } = await import("@/lib/script-versions");
  await snapshotScript(script, "before regenerating a section");
  await db.script.update({
    where: { id: scriptId },
    data: { body, wordCount: Math.min(words, MAX_WORDS), durationSeconds: durationSeconds(words) },
  });
  await save(scriptId, state);
}

// ── Step 10 — Publish metadata ──────────────────────────────────────────

export async function generateBuilderPublishAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId"));
  const { script, state } = await load(scriptId);

  const completion = await llm.complete({
    model: script.model ?? script.channel.defaultModel ?? "",
    system: "Return JSON with three fields: description (plain text, 200-300 words), tags (one comma-separated line), metadata (key:value list of 3-5 lines).",
    messages: [{ role: "user", content: `Title: ${state.title || script.title}\nScript:\n${(script.body ?? "").slice(0, 6000)}` }],
    workspaceId: script.channel.workspaceId,
  });
  await refusePlaceholder(scriptId, completion, "the publishing copy was not written");
  state.publish = { ...(state.publish ?? {}), description: completion.content };
  await save(scriptId, state);
}
