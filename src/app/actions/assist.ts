"use server";

import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { llm, resolveUsableModel } from "@/lib/llm";
import { motifPromptFor, brandGuardrailBlock } from "@/lib/motifs";
import { ASSIST_FIELDS, isAssistField, type AssistField } from "@/lib/assist/fields";

/**
 * Drafts prose for one registered field.
 *
 * ⚠ The client sends a field KEY, never a prompt. Accepting caller-supplied
 * instructions would turn every editor's browser into a way to spend the
 * workspace's LLM budget on anything at all.
 *
 * ⚠ Returns the resolved provider. The router falls back to the mock on a
 * missing key, a timeout or a 401, and mock prose reads perfectly fluently — so
 * the UI has to be able to say "this is placeholder text". That disclosure is
 * the reason LLMResponse.provider exists.
 */

export type AssistResult =
  | { ok: true; text: string; provider: string; mock: boolean }
  | { ok: false; error: string };

export async function draftFieldAction(input: {
  field: string;
  current?: string;
  channelId?: string;
  /**
   * Values the user has typed into OTHER fields of the same form, as
   * `{ label: value }`. Onboarding needs this: on step 2 the channel name is
   * sitting in a sibling input and has not been saved yet, so without it the
   * draft would be written with no idea what the channel is called.
   *
   * ⚠ These are FACTS, never instructions — they are interpolated into a
   * context block, and the system prompt treats everything outside the field
   * spec as material to describe rather than commands to follow.
   */
  siblings?: Record<string, string>;
}): Promise<AssistResult> {
  const { workspace } = await requireRole("EDITOR");

  if (!isAssistField(input.field)) {
    return { ok: false, error: "Unknown field." };
  }
  // Widened to AssistField: `as const satisfies` in the registry narrows each
  // `context` to a literal tuple, so `.includes("workspace")` would otherwise be
  // checked against that one entry's members and reject every other key.
  const spec: AssistField = ASSIST_FIELDS[input.field];
  const current = (input.current ?? "").trim().slice(0, 4000);

  // Channel context is optional — most fields are workspace-level.
  const channel = input.channelId
    ? await db.channel.findFirst({
        where: { id: input.channelId, workspaceId: workspace.id },
        select: {
          name: true, nicheDescription: true, presentationStyle: true,
          differentiation: true, defaultModel: true,
        },
      })
    : null;

  const facts: string[] = [];
  if (spec.context.includes("workspace")) {
    const org = await db.orgProfile.findUnique({
      where: { workspaceId: workspace.id },
      select: { description: true, industry: true, audience: true },
    });
    facts.push(`Company: ${workspace.name}`);
    if (org?.industry) facts.push(`Industry: ${org.industry}`);
    if (org?.description) facts.push(`What it does: ${org.description}`);
    if (org?.audience) facts.push(`Who it serves: ${org.audience}`);
  }
  if (spec.context.includes("channel") && channel) {
    facts.push(`Channel: ${channel.name}`);
    if (channel.nicheDescription) facts.push(`Niche: ${channel.nicheDescription}`);
    if (channel.presentationStyle) facts.push(`Presentation style: ${channel.presentationStyle}`);
    if (channel.differentiation) facts.push(`Differentiator: ${channel.differentiation}`);
  }

  // What the user has typed elsewhere on this form but not yet saved. Bounded
  // in both count and length so a crafted form post can't inflate the prompt.
  for (const [k, v] of Object.entries(input.siblings ?? {}).slice(0, 8)) {
    const value = String(v ?? "").trim().slice(0, 500);
    if (value) facts.push(`${k.slice(0, 60)}: ${value}`);
  }

  const [motifs, guardrails] = await Promise.all([
    spec.context.includes("motifs") ? motifPromptFor(workspace.id, {}, "short") : null,
    spec.context.includes("brand") || spec.context.includes("motifs")
      ? brandGuardrailBlock(workspace.id)
      : null,
  ]);

  // Draft vs improve is decided HERE, from whether the field has content —
  // rather than making the user choose between two buttons for what is, to
  // them, one intention: "help me with this box".
  const mode = current
    ? `The field currently reads:\n"""\n${current}\n"""\nImprove it: keep the author's meaning and any specifics they gave, and make it sharper.`
    : "The field is empty. Write it from scratch using the facts above.";

  const system =
    "You draft a single form field for a content platform. " +
    "Return ONLY the field's text — no preamble, no explanation, no quotation marks around it, no markdown headings. " +
    "⚠ Never invent facts. If a specific (a number, a date, a credential, a customer name) is not given above, leave it out rather than inventing a plausible one — " +
    "this text goes into a real company's brand configuration and a fabricated detail will be believed.";

  const prompt = [
    facts.length ? `Context:\n${facts.join("\n")}` : "Context: none supplied.",
    motifs ? `Tone:\n${motifs}` : "",
    guardrails ?? "",
    `Field: ${spec.label}`,
    `What it needs to say: ${spec.instruction}`,
    `Length: at most about ${spec.maxWords} words.`,
    mode,
  ].filter(Boolean).join("\n\n");

  try {
    // ⚠ Resolve the channel's model, never pin one. Three onboarding jobs once
    // hard-coded claude-sonnet, so pointing a channel at Gemini silently did
    // nothing and the fallback-to-mock hid it.
    //
    // ⚠ The WORKSPACE default sits between the channel and env, and skipping it
    // was a real bug: most assist fields are workspace-level and so have no
    // channel, which sent a fully-configured workspace to env's claude-sonnet —
    // a provider it has no key for — and silently to the mock.
    const model = await resolveUsableModel(
      channel?.defaultModel ?? workspace.defaultModel ?? llm.defaultModel,
      workspace.id,
    );
    const res = await llm.complete({
      model,
      system,
      messages: [{ role: "user", content: prompt }],
      workspaceId: workspace.id,
      temperature: 0.7,
    });

    const text = cleanDraft(res.content);
    if (!text) return { ok: false, error: "The model returned nothing. Try again." };

    const provider = res.provider ?? "unknown";
    return { ok: true, text, provider, mock: provider === "mock" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "Generation failed." };
  }
}

/**
 * Models wrap single-field answers in scaffolding no matter how firmly the
 * system prompt forbids it. Strip the common shapes rather than pasting
 * `Here's a description:` into the user's field.
 */
function cleanDraft(raw: string): string {
  let t = (raw ?? "").trim();
  t = t.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "").trim();
  t = t.replace(/^(sure|certainly|here(\s|')?s|here is)\b[^\n:]{0,60}:\s*/i, "").trim();
  // Only unwrap quotes that enclose the WHOLE draft — a quoted phrase inside
  // the text is the author's, not scaffolding.
  if (t.length > 1 && /^["“']/.test(t) && /["”']$/.test(t) && !/["“”']/.test(t.slice(1, -1))) {
    t = t.slice(1, -1).trim();
  }
  return t;
}
