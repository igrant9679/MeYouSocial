"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { llm } from "@/lib/llm";
import { readJson, writeJson } from "@/lib/db/json";

// Closes the last batch of [Could] FRs.

// ── — CTR scoring ───────────────────────────────────────────

export async function scoreThumbnailAction(formData: FormData) {
  const thumbId = String(formData.get("thumbnailId"));
  const { workspace } = await requireRole("EDITOR");
  const thumb = await db.thumbnail.findFirst({
    where: { id: thumbId, channel: { workspaceId: workspace.id } },
    include: { channel: true },
  });
  if (!thumb) return;

  // The mock LLM produces a stable score from prompt characteristics. The real
  // provider (when wired) returns a scored critique.
  const result = await llm.complete({
    model: thumb.channel.defaultModel ?? "claude-sonnet",
    system: `Score a YouTube thumbnail against CTR principles. Return a JSON-ish line:
score=<0-100>; contrast=<low|medium|high>; readability=<poor|ok|strong>; oneline=<short critique with one specific fix>.`,
    messages: [{
      role: "user",
      content: `Title: ${thumb.title}\nMode: ${thumb.mode}\nConcepts: ${(thumb.concepts ?? "").slice(0, 1000)}\nRendered URL: ${thumb.renderUrl ?? "(none)"}`,
    }],
    workspaceId: workspace.id,
  });
  // Pull the first integer out as the canonical score
  const numMatch = result.content.match(/score\s*=\s*(\d+)/i) ?? result.content.match(/(\d{2,3})/);
  const score = numMatch ? Math.min(100, Math.max(0, Number(numMatch[1]))) : 50;

  await db.thumbnail.update({
    where: { id: thumb.id },
    data: { ctrScore: score },
  });
  // Stash the critique on the concepts JSON so the UI can show it
  const concepts = readJson<Array<{ id: string; label: string; description: string; url: string }>>(thumb.concepts, []);
  await db.thumbnail.update({
    where: { id: thumb.id },
    data: { concepts: writeJson({ items: concepts, critique: result.content }) as string },
  });
  revalidatePath(`/thumbnails/${thumb.id}`);
}

// ── — Brand-asset settings per channel ──────────────────────

export async function updateThumbnailConfigAction(formData: FormData) {
  const channelId = String(formData.get("channelId"));
  const { workspace } = await requireRole("EDITOR");
  const channel = await db.channel.findFirst({ where: { id: channelId, workspaceId: workspace.id } });
  if (!channel) return;
  const cfg = {
    palette: String(formData.get("palette") ?? "").trim(),
    typography: String(formData.get("typography") ?? "").trim(),
    facePosition: String(formData.get("facePosition") ?? "").trim(),
    styleNotes: String(formData.get("styleNotes") ?? "").trim().slice(0, 1500),
    logoUrl: String(formData.get("logoUrl") ?? "").trim(),
  };
  const limit = Number(formData.get("limitThumbnailsPerMonth") ?? 0);
  await db.channel.update({
    where: { id: channelId },
    data: {
      thumbnailConfig: writeJson(cfg),
      limitThumbnailsPerMonth: Number.isFinite(limit) && limit > 0 ? limit : null,
    },
  });
  revalidatePath(`/channels/${channelId}/templates`); // thumbnail config lives near templates UX
  revalidatePath(`/thumbnails`);
}

// ── — Import shot list / markers from external tools ────────

export async function importMarkersAction(formData: FormData) {
  const channelId = formData.get("channelId") ? String(formData.get("channelId")) : null;
  const source = String(formData.get("source") ?? "premiere_marker");
  const raw = String(formData.get("raw") ?? "");
  if (!raw.trim()) return;

  const { workspace } = await requireRole("EDITOR");
  if (channelId) {
    const ok = await db.channel.findFirst({ where: { id: channelId, workspaceId: workspace.id } });
    if (!ok) return;
  }

  // Accept either CSV or one-per-line. Each marker becomes an Asset of kind="broll".
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let imported = 0;
  for (const line of lines) {
    // CSV style: "00:01:23,Establishing wide,Cold open" — name = second field if present
    const parts = line.split(",").map((p) => p.trim()).filter(Boolean);
    const name = parts.length >= 2 ? parts.slice(1).join(" — ") : parts[0];
    if (!name) continue;
    await db.asset.create({
      data: {
        channelId,
        kind: "broll",
        name: name.slice(0, 240),
        source,
        tags: writeJson([source]),
      },
    });
    imported++;
  }
  revalidatePath("/production/assets");
  redirect(`/production/assets?imported=${imported}`);
}

// ── — Clip a URL into a Swipe (incl. YouTube auto-thumbnail) ─

export async function clipSwipeAction(formData: FormData) {
  const url = String(formData.get("url") ?? "").trim();
  const channelId = formData.get("channelId") ? String(formData.get("channelId")) : null;
  if (!url) return;

  const { workspace } = await requireRole("EDITOR");

  // Auto-capture YouTube thumbnail
  const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([A-Za-z0-9_-]{6,})/);
  let imageUrl = url;
  let title = url;
  let kind = "landing";
  if (yt) {
    const id = yt[1];
    imageUrl = `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
    title = `YouTube · ${id}`;
    kind = "thumbnail";
  } else if (/\.(png|jpe?g|gif|webp)(\?|$)/i.test(url)) {
    // Direct image URL — use as-is
    title = url.split("/").pop()?.split("?")[0] ?? url;
    kind = "thumbnail";
  } else {
    // Web URL — point at a screenshot service so we still get an image. Picsum is a
    // deterministic mock for now; a real og:image fetcher would slot in here.
    imageUrl = `https://picsum.photos/seed/${encodeURIComponent(url).slice(0, 40)}/640/360`;
    kind = "landing";
  }

  await db.swipe.create({
    data: {
      workspaceId: workspace.id,
      channelId,
      imageUrl,
      title,
      sourceUrl: url,
      kind,
      tags: writeJson([]),
    },
  });
  revalidatePath("/production/swipes");
}

// ── — Attach a wiki page's checklist to a content project ────

export async function attachChecklistAction(formData: FormData) {
  const wikiDocId = String(formData.get("wikiDocId"));
  const contentProjectId = String(formData.get("contentProjectId"));
  const { workspace, user } = await requireRole("EDITOR");

  const [doc, project] = await Promise.all([
    db.wikiDoc.findFirst({ where: { id: wikiDocId, workspaceId: workspace.id } }),
    db.contentProject.findFirst({ where: { id: contentProjectId, channel: { workspaceId: workspace.id } } }),
  ]);
  if (!doc || !project) return;

  const items = readJson<string[]>(doc.checklist, []);
  if (items.length === 0) {
    // Heuristic: derive checklist items from the wiki body — pull "- " or "[ ]" lines
    const bodyItems = doc.body
      .split("\n")
      .map((l) => l.replace(/^\s*[-*]\s*(\[[ x]\]\s*)?/, "").trim())
      .filter((l) => l && l.length < 200)
      .slice(0, 20);
    items.push(...bodyItems);
  }
  for (const item of items.slice(0, 20)) {
    if (!item) continue;
    await db.task.create({
      data: {
        workspaceId: workspace.id,
        contentProjectId,
        assigneeId: user.id,
        title: item,
        description: `From SOP: ${doc.title}`,
      },
    });
  }
  revalidatePath(`/production/projects/${contentProjectId}`);
}

// ── — Optional video production add-on (TTS + avatar + render) ─

export async function launchVideoProductionAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId"));
  const { workspace } = await requireRole("EDITOR");
  const script = await db.script.findFirst({
    where: { id: scriptId, channel: { workspaceId: workspace.id } },
  });
  if (!script || !script.body) return;

  // We re-use the AgentRun row so progress shows on the same panel.
  const { registerAgentJobs } = await import("@/lib/jobs/agent");
  const { jobs } = await import("@/lib/jobs");
  registerAgentJobs();

  const run = await db.agentRun.create({
    data: { scriptId: script.id, status: "queued" },
  });
  // The standard agent pipeline already ends with a "voiceover" step ( pipeline).
  // For real TTS/avatar/render integration, wire env.USE_MOCK_PRODUCTION=false and supply
  // the provider keys; the existing job is the single place that branches.
  await jobs.enqueue("agent.run", { runId: run.id, scriptId: script.id });
  revalidatePath(`/scripts/${scriptId}`);
}
