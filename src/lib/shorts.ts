/**
 * Cut a Short from a long script (E-VID-11): a 30–60 second vertical version,
 * written from the long script and nothing else, saved as its own script in
 * the same channel (marked as cut from the original) and packaged as a 9:16
 * storyboard in the video pipeline — where it renders like any other board
 * (by the autopilot's video step when that's on, or Render now).
 *
 * ⚠ A model's words, so the mock is refused: a mock storyboard would go on to
 *   spend real render money on nonsense (the same rule as packageVideoCore).
 * ⚠ Bounded: the spoken script must land at 60–170 words (≈ 25–65 s spoken),
 *   and the board at 24–64 seconds of 4/6/8-second scenes; anything else is
 *   refused with the reason, nothing half-saved.
 */

import { db } from "@/lib/db";
import { llm, resolveUsableModel } from "@/lib/llm";
import { parseScenes } from "@/lib/captions";
import { estimateCostUsd } from "@/lib/video";
import { passStamp } from "@/lib/provenance";
import { writeAudit } from "@/lib/governance";

export type CutShortResult = { ok: true; scriptId: string; renderId: string; words: number; seconds: number } | { ok: false; error: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The long script as plain spoken text for the prompt. Pure. */
export function scriptPlainText(body: string): string {
  return body.replace(/<\/(p|h[1-6]|li|div)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\n{3,}/g, "\n\n").trim();
}

/** Read the model's JSON answer into a short, or say what's wrong with it. Pure. */
export function readShortAnswer(content: string): { title: string; script: string; scenes: ReturnType<typeof parseScenes> } | { error: string } {
  let parsed: { title?: unknown; script?: unknown; scenes?: unknown } = {};
  try {
    const m = content.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : {};
  } catch {
    return { error: "The model's answer wasn't the expected shape — try again." };
  }
  const title = typeof parsed.title === "string" ? parsed.title.trim().slice(0, 120) : "";
  const script = typeof parsed.script === "string" ? parsed.script.trim() : "";
  const words = script.split(/\s+/).filter(Boolean).length;
  if (!title || !script) return { error: "The model's answer had no title or script — try again." };
  if (words < 60 || words > 170) return { error: `The model wrote ${words} words; a 30–60 second Short needs about 75–150. Try again.` };
  const scenes = parseScenes(JSON.stringify(parsed.scenes ?? [])).slice(0, 10).map((s) => ({ ...s, status: "planned" }));
  const seconds = scenes.reduce((a, s) => a + s.seconds, 0);
  if (scenes.length < 3 || seconds < 24 || seconds > 64) return { error: `The storyboard came back at ${scenes.length} scene(s), ${seconds} s — a Short needs 3 or more scenes and 30–60 s. Try again.` };
  return { title, script, scenes };
}

export async function cutShortCore(workspaceId: string, scriptId: string, actorId: string | null): Promise<CutShortResult> {
  const long = await db.script.findFirst({
    where: { id: scriptId, channel: { workspaceId } },
    select: { id: true, title: true, body: true, model: true, channelId: true, channel: { select: { defaultModel: true } } },
  });
  if (!long) return { ok: false, error: "That script isn't in this workspace." };
  const text = scriptPlainText(long.body ?? "");
  if (text.split(/\s+/).filter(Boolean).length < 150) return { ok: false, error: "The script is too short to cut a Short from — it needs at least 150 words." };
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { defaultModel: true } });

  const system =
    "You cut a long video script into a 30–60 second vertical Short (YouTube Shorts, Reels, TikTok). " +
    'Respond ONLY with a JSON object: {"title": string, "script": string, "scenes": [{"prompt": string, "seconds": number, "text": string}]}. ' +
    "`script` is the spoken words only — 75 to 150 words, a hook in the first sentence, one idea, a call to action at the end; no stage directions. " +
    "Use ONLY what the long script says: no new facts, numbers, names or claims. " +
    "`scenes`: 4 to 8 scenes of 4, 6 or 8 seconds, 30 to 60 seconds in all, in order with the script; each `prompt` describes ONE visually concrete vertical shot " +
    "(subject, setting, camera movement, mood) and `text` is that scene's on-screen caption (≤ 8 words). No brand logos.";
  const res = await llm.complete({
    purpose: "script.short",
    model: await resolveUsableModel(long.model ?? long.channel.defaultModel ?? workspace?.defaultModel ?? llm.defaultModel, workspaceId),
    system,
    messages: [{ role: "user", content: `Long script title: "${long.title}"\n\nLong script:\n${text.slice(0, 12000)}` }],
    maxTokens: 1600,
    workspaceId,
  });
  if (res.provider === "mock") return { ok: false, error: "No AI model could write it — the provider didn't answer, so nothing was made. Check Settings → Keys." };
  const short = readShortAnswer(res.content);
  if ("error" in short) return { ok: false, error: short.error };

  const words = short.script.split(/\s+/).filter(Boolean).length;
  const seconds = short.scenes.reduce((a, s) => a + s.seconds, 0);
  const body = short.script.split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join("");
  const made = await db.script.create({
    data: {
      channelId: long.channelId,
      title: `Short: ${short.title}`.slice(0, 200),
      body,
      bodyBy: passStamp(res),
      cutFromId: long.id,
      wordCount: words,
      durationSeconds: Math.round((words / 150) * 60),
    },
  });
  const render = await db.videoRender.create({
    data: {
      workspaceId,
      scriptId: made.id,
      title: short.title.slice(0, 200),
      prompt: short.scenes[0].prompt.slice(0, 2000),
      scenes: JSON.stringify(short.scenes),
      seconds,
      aspect: "9:16",
      costEstimate: estimateCostUsd(seconds),
    },
  });
  await writeAudit({ workspaceId, actorId, action: "script.short_cut", entityType: "script", entityId: long.id, meta: { shortScriptId: made.id, renderId: render.id, words, seconds, scenes: short.scenes.length, provider: res.provider, model: res.model } });
  return { ok: true, scriptId: made.id, renderId: render.id, words, seconds };
}
