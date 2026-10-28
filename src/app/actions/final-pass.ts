"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
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
  const back = `/thumbnails/${thumb.id}`;
  const refuse = (why: string) => redirect(`${back}?flashErr=${encodeURIComponent(why)}`);
  if (!thumb.renderUrl) refuse("Render the thumbnail first — the score is read from the image itself.");

  // ⚠ VID-08: a TEXT model scored the title and concept notes — it never saw the
  // picture — and a reply without a number was stored as 50. Now a vision model
  // looks at the rendered image; no image, no vision key or no number = no score.
  const { askAboutImage, fetchReferenceImage } = await import("@/lib/vision");
  const url = thumb.renderUrl!;
  let image: { bytes: Buffer; mimeType: string; source: string } | null = null;
  const own = url.match(/^\/(?:api\/files|uploads)\/(.+)$/);
  if (own) {
    const { storage } = await import("@/lib/storage");
    const bytes = await storage.get(decodeURIComponent(own[1])).catch(() => null);
    if (bytes) image = { bytes, mimeType: /\.jpe?g$/i.test(own[1]) ? "image/jpeg" : /\.webp$/i.test(own[1]) ? "image/webp" : "image/png", source: url };
  } else {
    image = await fetchReferenceImage(url);
  }
  if (!image) refuse("The rendered image couldn't be opened, so it wasn't scored.");
  let critique = "";
  try {
    critique = await askAboutImage(image!, `Score this YouTube thumbnail for click-through, judging only what you can see. Reply on one line exactly as:
score=<0-100>; contrast=<low|medium|high>; readability=<poor|ok|strong>; oneline=<a short critique with one specific fix>.
The video's title: ${thumb.title ?? "(none)"}`, workspace.id);
  } catch {
    refuse("Scoring needs a Google or OpenAI key (Settings → Keys) — a model has to see the image.");
  }
  const numMatch = critique.match(/score\s*=\s*(\d{1,3})/i);
  if (!numMatch) refuse("The model looked but gave no score, so none was recorded.");
  const score = Math.min(100, Math.max(0, Number(numMatch![1])));

  // The critique rides on the concepts JSON. Read the list out of either shape
  // first — re-scoring nested the object inside itself and hid every concept.
  const blob = readJson<unknown>(thumb.concepts, []);
  const items = Array.isArray(blob) ? blob : ((blob as { items?: unknown[] })?.items ?? []);
  await db.thumbnail.update({
    where: { id: thumb.id },
    data: { ctrScore: score, concepts: writeJson({ items, critique }) as string },
  });
  revalidatePath(back);
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
        workspaceId: workspace.id,
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

