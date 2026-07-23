"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { llm } from "@/lib/llm";
import { readJson, writeJson } from "@/lib/db/json";

type PromoKind =
  | "titles"           // title variants
  | "hooks"            // opening hook variants
  | "description"      // SEO video description
  | "tags"             // YouTube tags
  | "social_twitter"
  | "social_linkedin"
  | "social_instagram"
  | "newsletter"
  | "blog"
  | "shotlist";        // shot list / B-roll

const PROMPTS: Record<PromoKind, string> = {
  titles: "Generate 6 title variations for this YouTube video. Each: <= 70 chars, distinct angle (curiosity, contrarian, specific, listicle, question, big-claim). One per line.",
  hooks: "Generate 5 opening-hook variations (first 10 seconds spoken). Each 2-3 sentences. Punchy, no preamble. Distinct angles.",
  description: "Write a YouTube video description: 1 line hook, 2-3 paragraph summary, then 3-5 timestamps if the script structure suggests them, then a 1-line CTA. Plain text, no markdown.",
  tags: "Generate 20-30 YouTube tags (lowercase, no #, comma-separated, mix of head + long-tail). One comma-separated line.",
  social_twitter: "Write a 5-tweet thread teasing the video. Each tweet <= 280 chars. First tweet is the strongest hook. Last tweet links to the video.",
  social_linkedin: "Write a LinkedIn post (~150-200 words) introducing this video to a professional audience. First line is the hook. End with a question to drive engagement.",
  social_instagram: "Write an Instagram caption (~150 words) for a thumbnail-led post about this video. Punchy hook line, 3-line value tease, soft CTA. Include 8-12 hashtags at the end.",
  newsletter: "Write a 400-word newsletter section adapting this video. Lead with the most counter-intuitive insight, build with 2-3 supporting points, end with a CTA to watch.",
  blog: "Adapt the script into a blog post (~700 words). Add an intro, structured H2 sections matching the script, and a short conclusion. Light markdown headings.",
  shotlist: "Produce a shot list & B-roll guide for filming this script. Group by script section. For each: shot type (talking head / B-roll / animation), description, suggested duration. Table-like.",
};

export async function generatePromoAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId"));
  const kind = String(formData.get("kind")) as PromoKind;
  if (!PROMPTS[kind]) return;

  const { workspace } = await requireRole("EDITOR");
  const script = await db.script.findFirst({
    where: { id: scriptId, channel: { workspaceId: workspace.id } },
    include: { channel: true },
  });
  if (!script) return;

  const result = await llm.complete({
    model: script.model ?? script.channel.defaultModel ?? "claude-sonnet",
    system: `You produce YouTube publishing assets for the channel "${script.channel.name}" (niche: ${script.channel.nicheDescription}).
Follow the user instruction below and return ONLY the requested asset, no preamble.`,
    messages: [{ role: "user", content: `Instruction: ${PROMPTS[kind]}\n\nVideo title: ${script.title}\n\nScript:\n${(script.body ?? "").slice(0, 6000)}` }],
    workspaceId: workspace.id,
  });

  // Stash the latest assets on the script outline JSON under a publish slot.
  const outline = readJson<{ publish?: Record<string, string> }>(script.outline ?? null, {});
  outline.publish = { ...(outline.publish ?? {}), [kind]: result.content };
  await db.script.update({ where: { id: script.id }, data: { outline: writeJson(outline) } });
  revalidatePath(`/scripts/${script.id}/publish`);
}
