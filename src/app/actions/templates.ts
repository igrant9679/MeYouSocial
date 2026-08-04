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

/**
 * Edit a CUSTOM template's name, kind and structure text.
 *
 * Built-ins (channelId null) are deliberately not editable: they're one shared
 * set of rows serving every workspace on the install, so an admin "fixing" one
 * would silently rewrite it for every other tenant. The path for those is
 * duplicateTemplateAction below — copy it into your channel, then edit freely.
 *
 * The structure column is JSON with two authoring shapes: cloned templates
 * carry prose in `ai`, seeded ones carry a `sections` list. The textarea edits
 * whichever shape the template already has, and everything else in the JSON
 * (sources, notes) is preserved untouched.
 */
export async function updateTemplateAction(formData: FormData) {
  const id = String(formData.get("id"));
  const channelId = String(formData.get("channelId"));
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  const kind = String(formData.get("kind") ?? "long") === "short" ? "short" : "long";
  const body = String(formData.get("body") ?? "").trim().slice(0, 20_000);
  if (!name || !body) return;

  const { workspace } = await requireRole("EDITOR");
  const template = await db.template.findFirst({
    where: { id, channelId, channel: { workspaceId: workspace.id } },
  });
  if (!template) return;

  let structure: Record<string, unknown> = {};
  try { structure = JSON.parse(template.structure) as Record<string, unknown>; } catch { /* rebuild below */ }
  if (Array.isArray(structure.sections) && !structure.ai) {
    structure.sections = body.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } else {
    structure.ai = body;
  }

  await db.template.update({
    where: { id: template.id },
    data: { name, kind, structure: writeJson(structure) },
  });
  revalidatePath(`/channels/${channelId}/templates`);
  const { redirect } = await import("next/navigation");
  redirect(`/channels/${channelId}/templates?focus=${template.id}`);
}

/** Copy a template (built-in or own) into this channel as an editable custom one. */
export async function duplicateTemplateAction(formData: FormData) {
  const id = String(formData.get("id"));
  const channelId = String(formData.get("channelId"));
  const { workspace } = await requireRole("EDITOR");
  const channel = await db.channel.findFirst({ where: { id: channelId, workspaceId: workspace.id } });
  if (!channel) return;
  // Source must be a built-in, or a template this workspace already owns —
  // never another tenant's row.
  const src = await db.template.findFirst({
    where: { id, OR: [{ channelId: null }, { channel: { workspaceId: workspace.id } }] },
  });
  if (!src) return;

  const copy = await db.template.create({
    data: {
      channelId,
      name: `${src.name} (copy)`.slice(0, 80),
      kind: src.kind,
      source: "custom",
      structure: src.structure,
    },
  });
  revalidatePath(`/channels/${channelId}/templates`);
  const { redirect } = await import("next/navigation");
  redirect(`/channels/${channelId}/templates?focus=${copy.id}`);
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
