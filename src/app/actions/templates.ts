"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { llm } from "@/lib/llm";
import { youtubeFor } from "@/lib/youtube";
import { writeJson } from "@/lib/db/json";

// Custom template by cloning a single video.
// Combine 2–3 videos into one synthesized custom template.

const MAX_REFERENCES = 3;

export async function cloneTemplateAction(formData: FormData) {
  const channelId = String(formData.get("channelId"));
  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "long");
  const refsRaw = String(formData.get("references") ?? "");
  if (!name) return;

  const handles = refsRaw.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean).slice(0, MAX_REFERENCES);
  if (handles.length === 0) return;

  const { workspace } = await requireRole("EDITOR");
  const channel = await db.channel.findFirst({ where: { id: channelId, workspaceId: workspace.id } });
  if (!channel) return;

  // Pull transcripts for each reference. Reference can be a YouTube URL/handle.
  const transcripts: { ref: string; transcript: string }[] = [];
  for (const ref of handles) {
    const ch = await youtubeFor(workspace.id).findChannel(ref);
    if (!ch) continue;
    const videos = await youtubeFor(workspace.id).listVideos(ch.id, 1);
    const t = videos[0] ? await youtubeFor(workspace.id).getTranscript(videos[0].id) : null;
    if (t) transcripts.push({ ref, transcript: t });
  }

  // Have the LLM produce a structured template: sections + pacing + transitions.
  const completion = await llm.complete({
    model: channel.defaultModel ?? "claude-sonnet",
    system: `Analyze the supplied YouTube transcript(s) and produce a reusable script template.
Return JSON with: sections (ordered array of { title, purpose, typicalDurationSeconds, beats: string[] }),
pacing (overall cadence summary), transitions (recurring connector phrases), notes (anything else distinctive).
${transcripts.length > 1 ? "Synthesize across all references — extract the common structural pattern." : ""}`,
    messages: [{
      role: "user",
      content: transcripts.map((t, i) => `--- Reference ${i + 1} (${t.ref}) ---\n${t.transcript.slice(0, 6_000)}`).join("\n\n"),
    }],
    workspaceId: workspace.id,
  });

  const template = await db.template.create({
    data: {
      channelId,
      name,
      kind: kind === "short" ? "short" : "long",
      source: transcripts.length > 1 ? "cloned-combined" : "cloned",
      structure: writeJson({
        ai: completion.content,
        sources: transcripts.map((t) => t.ref),
      }),
    },
  });
  revalidatePath(`/channels/${channelId}/templates`);
  const { redirect } = await import("next/navigation");
  redirect(`/channels/${channelId}/templates?focus=${template.id}`);
}

export async function deleteTemplateAction(formData: FormData) {
  const id = String(formData.get("id"));
  const channelId = String(formData.get("channelId"));
  const { workspace } = await requireRole("EDITOR");
  // Only delete templates owned by this channel — built-in (channelId null) are immutable.
  await db.template.deleteMany({
    where: { id, channelId, channel: { workspaceId: workspace.id } },
  });
  revalidatePath(`/channels/${channelId}/templates`);
}
