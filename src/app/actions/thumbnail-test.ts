"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { isGloballyPaused, writeAudit } from "@/lib/governance";
import { youtubeAccessToken, youtubeOauthConnected } from "@/lib/youtube/oauth";
import { projectUploadSources } from "@/lib/youtube/upload-sources";
import { setYoutubeThumbnail } from "@/lib/youtube/upload";
import { advanceThumbnailTests, ensureReachJob, readJsonOr, type Variant } from "@/lib/youtube/thumbnail-test";

/**
 * A thumbnail A/B test on the project's published video (E-VID-05). ADMIN: it
 * changes what the public sees. The first press makes a summary; only the yes
 * puts thumbnail A on the video and starts the clock.
 */
export async function startThumbnailTestAction(formData: FormData) {
  const { workspace, user } = await requireRole("ADMIN");
  const projectId = String(formData.get("projectId") ?? "");
  const back = `/production/projects/${encodeURIComponent(projectId)}`;
  const err = (m: string): never => redirect(`${back}?flashErr=${encodeURIComponent(m)}#thumbnail-test`);
  const project = await db.contentProject.findFirst({ where: { id: projectId, channel: { workspaceId: workspace.id } }, select: { id: true, scriptId: true, youtubeVideoId: true } });
  if (!project) err("That project isn't in this workspace.");
  if (!project!.youtubeVideoId) err("Link the project to its YouTube video first — the test changes that video's thumbnail.");
  if (!(await youtubeOauthConnected(workspace.id)).connected) err("No YouTube channel is connected — connect it under Settings → Connections first.");
  const running = await db.thumbnailTest.count({ where: { workspaceId: workspace.id, videoId: project!.youtubeVideoId!, state: { in: ["running", "measuring"] } } });
  if (running) err("This video already has a thumbnail test running.");
  const sources = await projectUploadSources(workspace.id, project!.id, project!.scriptId);
  const picked = [...new Set(formData.getAll("variant").map(String))];
  const variants: Variant[] = picked.map((v) => sources.images.find((s) => s.value === v)).filter((s): s is NonNullable<typeof s> => Boolean(s)).map((s, i) => ({ key: s.key, label: `${String.fromCharCode(65 + i)} — ${s.label.replace(/^(Asset|Thumbnail) — /, "")}` }));
  if (variants.length !== picked.length) err("Pick from this project's own images.");
  if (variants.length < 2 || variants.length > 3) err("Pick two or three thumbnails to compare.");
  const daysEach = Number(formData.get("daysEach"));
  if (![3, 5, 7, 14].includes(daysEach)) err("Choose how many days each thumbnail runs.");
  await db.thumbnailTest.deleteMany({ where: { workspaceId: workspace.id, projectId: project!.id, state: "draft" } });
  const t = await db.thumbnailTest.create({ data: { workspaceId: workspace.id, projectId: project!.id, videoId: project!.youtubeVideoId!, variants: JSON.stringify(variants), daysEach, state: "draft", createdById: user.id } });
  redirect(`${back}?confirmTest=${t.id}#thumbnail-test`);
}

export async function confirmThumbnailTestAction(formData: FormData) {
  const { workspace, user } = await requireRole("ADMIN");
  const t = await db.thumbnailTest.findFirst({ where: { id: String(formData.get("id") ?? ""), workspaceId: workspace.id, state: "draft" } });
  const back = t?.projectId ? `/production/projects/${t.projectId}` : "/production";
  const go = (k: "flash" | "flashErr", m: string): never => redirect(`${back}?${k}=${encodeURIComponent(m)}#thumbnail-test`);
  if (!t) go("flashErr", "That test isn't waiting for a yes any more.");
  if (await isGloballyPaused(workspace.id)) go("flashErr", "Automation is paused for this workspace, so the video's thumbnail isn't changed until it's resumed.");
  const token = await youtubeAccessToken(workspace.id);
  if (!token) go("flashErr", "The YouTube connection isn't working — reconnect it under Settings → Connections.");
  const variants = readJsonOr<Variant[]>(t!.variants, []);
  const { storage } = await import("@/lib/storage");
  const bytes = await storage.head(variants[0].key, 2 * 1024 * 1024 + 1).catch(() => null);
  const set = bytes ? await setYoutubeThumbnail(token!, t!.videoId, bytes, variants[0].key.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg") : { ok: false, note: "Thumbnail A couldn't be read from storage." };
  if (!set.ok) {
    await db.thumbnailTest.update({ where: { id: t!.id }, data: { state: "failed", error: set.note } });
    go("flashErr", `Not started — ${set.note}`);
  }
  // The reach-report job has to exist before the days it measures; made now, its error kept as a note.
  const reachNote = await ensureReachJob(token!, workspace.id).then(() => null, (e: unknown) => (e instanceof Error ? e.message : String(e)));
  const now = new Date();
  await db.thumbnailTest.update({ where: { id: t!.id }, data: { state: "running", startedAt: now, current: 0, windows: JSON.stringify([{ variant: 0, from: now.toISOString(), to: null, setOk: true }]), error: reachNote } });
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "youtube.thumbnail_test_started", entityType: "thumbnail_test", entityId: t!.id, meta: { videoId: t!.videoId, variants: variants.length, daysEach: t!.daysEach } });
  revalidatePath(back);
  go("flash", `Thumbnail A is on the video. Each thumbnail runs ${t!.daysEach} days; YouTube's numbers arrive about two days late, so the verdict comes a few days after the last one.`);
}

export async function thumbnailTestStepAction(formData: FormData) {
  const { workspace, user } = await requireRole("ADMIN");
  const op = String(formData.get("op") ?? "");
  const t = await db.thumbnailTest.findFirst({ where: { id: String(formData.get("id") ?? ""), workspaceId: workspace.id } });
  const back = t?.projectId ? `/production/projects/${t.projectId}` : "/production";
  const go = (k: "flash" | "flashErr", m: string): never => redirect(`${back}?${k}=${encodeURIComponent(m)}#thumbnail-test`);
  if (!t) go("flashErr", "That test isn't here any more.");
  if (op === "discard") {
    await db.thumbnailTest.deleteMany({ where: { id: t!.id, state: { in: ["draft", "failed", "stopped", "done"] } } });
    go("flash", t!.state === "draft" ? "Not started." : "Removed.");
  }
  if (op === "stop") {
    const r = await db.thumbnailTest.updateMany({ where: { id: t!.id, state: { in: ["running", "measuring"] } }, data: { state: "stopped" } });
    if (r.count) await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "youtube.thumbnail_test_stopped", entityType: "thumbnail_test", entityId: t!.id });
    go(r.count ? "flash" : "flashErr", r.count ? "Stopped — the thumbnail on the video now stays." : "That test isn't running.");
  }
  if (op === "check") {
    if (t!.state !== "running" && t!.state !== "measuring") go("flashErr", "That test isn't running.");
    await advanceThumbnailTests(new Date(), t!.id);
    revalidatePath(back);
    const after = await db.thumbnailTest.findUnique({ where: { id: t!.id }, select: { error: true, state: true } });
    go(after?.error ? "flashErr" : "flash", after?.error ?? `Checked — the test is ${after?.state}.`);
  }
  go("flashErr", "Nothing to do.");
}
