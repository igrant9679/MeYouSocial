"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { llm } from "@/lib/llm";
import { images } from "@/lib/images";
import { readJson, writeJson } from "@/lib/db/json";

type Concept = { id: string; label: string; description: string; url: string };

/** Brainstorm: 4 concept sketches from title (+ optional topic). */
export async function brainstormThumbnailsAction(formData: FormData) {
  const { workspace, user } = await requireRole("EDITOR");
  const channelId = String(formData.get("channelId"));
  const title = String(formData.get("title") ?? "").trim();
  const topic = String(formData.get("topic") ?? "").trim();
  if (!title) return;

  const channel = await db.channel.findFirst({ where: { id: channelId, workspaceId: workspace.id } });
  if (!channel) return;

  // 1) Generate four concept descriptions via the LLM router.
  const completion = await llm.complete({
    model: channel.defaultModel ?? "claude-sonnet",
    system: `Produce 4 sharply distinct YouTube thumbnail concepts for the given video.
Return EXACTLY 4 numbered lines: "LABEL — short visual brief".
LABELs should cover 4 proven formats: 1) Face + reaction, 2) Object + tight crop, 3) Big text + arrow, 4) Before/After split.`,
    messages: [{ role: "user", content: `Title: ${title}\nTopic: ${topic}\nNiche: ${channel.nicheDescription}` }],
    workspaceId: workspace.id,
  });

  const lines = completion.content
    .split("\n")
    .map((l) => l.replace(/^[*\-\d.\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 4);

  // 2) For each concept, render a thumbnail via the image provider (mocked).
  const concepts: Concept[] = [];
  for (const line of lines) {
    const [labelRaw, briefRaw] = line.split("—").map((s) => s.trim());
    const label = labelRaw || "Concept";
    const brief = briefRaw || line;
    const img = await images.generate({
      prompt: `YouTube thumbnail, 1280x720. Concept: ${label}. Visual brief: ${brief}. Video title: ${title}.`,
      aspectRatio: "16:9",
    });
    concepts.push({
      id: Math.random().toString(36).slice(2, 10),
      label,
      description: brief,
      url: img.url,
    });
  }

  const thumb = await db.thumbnail.create({
    data: {
      channelId,
      title,
      mode: "brainstorm",
      concepts: writeJson(concepts),
    },
  });

  await db.usageLog.create({
    data: { workspaceId: workspace.id, actorId: user.id, action: "thumbnail.brainstorm", words: completion.outputTokens ?? 0 },
  });

  revalidatePath(`/thumbnails`);
  const { redirect } = await import("next/navigation");
  redirect(`/thumbnails/${thumb.id}`);
}

/** Render a publish-ready thumbnail from a selected concept. */
export async function renderThumbnailAction(formData: FormData) {
  const thumbId = String(formData.get("thumbnailId"));
  const conceptId = String(formData.get("conceptId"));

  const { workspace } = await requireRole("EDITOR");
  const thumb = await db.thumbnail.findFirst({
    where: { id: thumbId, channel: { workspaceId: workspace.id } },
  });
  if (!thumb) return;

  const concepts = readJson<Concept[]>(thumb.concepts, []);
  const concept = concepts.find((c) => c.id === conceptId);
  if (!concept) return;

  const img = await images.generate({
    prompt: `Final-quality YouTube thumbnail, 1280x720, high contrast. ${concept.label} — ${concept.description}. Title: ${thumb.title}.`,
    aspectRatio: "16:9",
  });

  await db.thumbnail.update({
    where: { id: thumb.id },
    data: { renderUrl: img.url },
  });
  revalidatePath(`/thumbnails/${thumb.id}`);
}

const cloneSchema = z.object({
  channelId: z.string(),
  title: z.string().min(1).max(200),
  referenceUrl: z.string().min(1).max(2000),
});

/** Clone/Remix: analyze a reference and render in that style. */
export async function cloneThumbnailAction(formData: FormData) {
  const parsed = cloneSchema.safeParse({
    channelId: formData.get("channelId"),
    title: formData.get("title"),
    referenceUrl: formData.get("referenceUrl"),
  });
  if (!parsed.success) return;
  const { workspace } = await requireRole("EDITOR");
  const channel = await db.channel.findFirst({ where: { id: parsed.data.channelId, workspaceId: workspace.id } });
  if (!channel) return;

  // "Analyze" the reference — in mock mode this is fake but the abstraction is real.
  const analysis = await llm.complete({
    model: channel.defaultModel ?? "claude-sonnet",
    system: "Describe the visual style of the supplied reference image/URL: palette, typography, composition, lighting. Be concise.",
    messages: [{ role: "user", content: `Reference: ${parsed.data.referenceUrl}\nVideo title for the new thumbnail: ${parsed.data.title}` }],
    workspaceId: workspace.id,
  });

  const img = await images.generate({
    prompt: `Render a YouTube thumbnail in the following reference style:\n${analysis.content.slice(0, 800)}\nVideo title: ${parsed.data.title}.`,
    aspectRatio: "16:9",
    referenceUrl: parsed.data.referenceUrl,
  });

  const thumb = await db.thumbnail.create({
    data: {
      channelId: parsed.data.channelId,
      title: parsed.data.title,
      mode: "clone",
      concepts: writeJson([{ id: "ref", label: "Clone", description: analysis.content.slice(0, 400), url: img.url }]),
      renderUrl: img.url,
    },
  });
  const { redirect } = await import("next/navigation");
  redirect(`/thumbnails/${thumb.id}`);
}
