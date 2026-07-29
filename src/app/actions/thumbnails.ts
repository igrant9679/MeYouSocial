"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { llm } from "@/lib/llm";
import { images } from "@/lib/images";
import { describeImageStyle, fetchReferenceImage } from "@/lib/vision";
import { readJson, writeJson } from "@/lib/db/json";

type Concept = { id: string; label: string; description: string; url: string; sawReference?: boolean };

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
      workspaceId: workspace.id,
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
    workspaceId: workspace.id,
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

  // ── Actually LOOK at the reference ────────────────────────────────────────
  // This used to hand the URL to llm.complete() as a plain string. A text model
  // can't fetch a URL, so the "analysis" was recall or invention — convincing
  // for a famous video the model already knows, and quietly wrong for the real
  // use case (a competitor's thumbnail nobody has memorised). Now the bytes are
  // fetched and passed to a vision model, and when they CAN'T be fetched we say
  // we're working from the title alone rather than describing nothing.
  const reference = await fetchReferenceImage(parsed.data.referenceUrl);
  let styleNote: string;
  let sawReference = false;
  if (reference) {
    try {
      styleNote = await describeImageStyle(reference, workspace.id);
      sawReference = true;
    } catch {
      styleNote = "";
    }
  } else {
    styleNote = "";
  }

  const prompt = sawReference
    ? `Render a YouTube thumbnail in this reference style:\n${styleNote.slice(0, 1200)}\nVideo title: ${parsed.data.title}.`
    : `Render a bold, high-contrast YouTube thumbnail for the video title: ${parsed.data.title}.`;

  const img = await images.generate({
    prompt,
    aspectRatio: "16:9",
    referenceUrl: parsed.data.referenceUrl,
    workspaceId: workspace.id,
  });

  // Recorded so the UI can distinguish a real style match from a title-only
  // render. Without this the two are indistinguishable on screen, which is how
  // the old behaviour went unnoticed.
  const description = sawReference
    ? styleNote.slice(0, 400)
    : `Could not open the reference, so this was rendered from the title alone — its style is not based on ${parsed.data.referenceUrl.slice(0, 80)}. Paste a direct image URL or a YouTube video link to match a style.`;

  const thumb = await db.thumbnail.create({
    data: {
      channelId: parsed.data.channelId,
      title: parsed.data.title,
      mode: "clone",
      concepts: writeJson([
        { id: "ref", label: sawReference ? "Clone" : "Title only", description, url: img.url, sawReference },
      ]),
      renderUrl: img.url,
    },
  });
  const { redirect } = await import("next/navigation");
  redirect(`/thumbnails/${thumb.id}`);
}
