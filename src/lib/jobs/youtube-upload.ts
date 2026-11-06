import { promises as fs } from "node:fs";
import { jobs } from "@/lib/jobs";
import { db } from "@/lib/db";

/**
 * Upload a project's video to YouTube in the background (E-VID-03).
 *
 * The file is read from storage onto disk once (Drive streams to a temp file),
 * then sent in 8 MiB pieces — never whole in memory. The session address is
 * sealed on the row, so a job that dies (a redeploy) resumes from what YouTube
 * says it holds instead of starting over. ONE attempt per press: a failure is
 * left on the row with its reason for a person to Retry, which resumes.
 * Each piece reports progress, which is also the job's heartbeat.
 */

export const YOUTUBE_UPLOAD_JOB = "youtube.upload";
let registered = false;

export function registerYoutubeUploadJobs() {
  if (registered) return;
  registered = true;
  jobs.register<{ uploadId: string }>(YOUTUBE_UPLOAD_JOB, async ({ uploadId }, ctx) => {
    const up = await db.youtubeUpload.findUnique({ where: { id: uploadId } });
    if (!up || up.state === "done") return;
    const fail = async (message: string): Promise<never> => {
      await db.youtubeUpload.update({ where: { id: up.id }, data: { state: "failed", error: message.slice(0, 500) } });
      throw new Error(message);
    };
    const { youtubeAccessToken } = await import("@/lib/youtube/oauth");
    const { storage } = await import("@/lib/storage");
    const { seal, open } = await import("@/lib/keyring");
    const yt = await import("@/lib/youtube/upload");
    const token = await youtubeAccessToken(up.workspaceId);
    if (!token) return fail("The workspace's YouTube connection isn't working — reconnect YouTube under Settings → Connections, then Retry.");

    await db.youtubeUpload.update({ where: { id: up.id }, data: { state: "uploading", error: null } });
    const file = await storage.fileOnDisk(up.sourceKey, yt.YT_MAX_BYTES);
    if (file === "too-big") return fail("The video is over the 4 GB this app moves in one upload — upload it in YouTube Studio.");
    if (!file) return fail("The video file couldn't be read from storage — it may have been deleted.");
    try {
      // The size is the stored file's own, read once it's on disk.
      const total = (await fs.stat(file.path)).size;
      if (!total) return fail("The stored video is empty.");
      await db.youtubeUpload.update({ where: { id: up.id }, data: { size: BigInt(total) } });
      const meta = {
        title: up.title, description: up.description, tags: JSON.parse(up.tags) as string[],
        privacy: up.privacy as "private" | "unlisted" | "public", publishAt: up.publishAt, madeForKids: up.madeForKids,
      };
      let session: string | null = null;
      try { session = up.session ? open(JSON.parse(up.session)) : null; } catch { session = null; }
      let sent = 0;
      let videoId: string | null = null;
      const begin = async () => {
        session = await yt.beginYoutubeUpload(token, meta, total, up.contentType);
        await db.youtubeUpload.update({ where: { id: up.id }, data: { session: JSON.stringify(seal(session)), sent: 0 } });
        sent = 0;
      };
      if (session) {
        try { const s = await yt.youtubeUploadStatus(session, token, total); sent = s.received; videoId = s.videoId ?? null; }
        catch (e) { if (e instanceof yt.UploadGone) await begin(); else throw e; }
      } else await begin();

      const fh = await fs.open(file.path, "r");
      try {
        let busy = 0, restarts = 0;
        while (!videoId && sent < total) {
          const len = Math.min(yt.YT_CHUNK, total - sent);
          const buf = Buffer.alloc(len);
          const { bytesRead } = await fh.read(buf, 0, len, sent);
          if (bytesRead !== len) return fail("The stored video is shorter than it should be — upload it again.");
          try {
            const r = await yt.sendYoutubePiece(session!, token, sent, buf, total);
            sent = r.received;
            videoId = r.videoId ?? null;
            busy = 0;
          } catch (e) {
            if (e instanceof yt.UploadGone && restarts++ < 1) { await begin(); continue; }
            if (!(e instanceof yt.UploadBusy) || ++busy > 8) throw e;
            await new Promise((res) => setTimeout(res, Math.min(30_000, 1000 * 2 ** busy)));
            // A lost reply isn't a lost piece: ask how much arrived.
            const s = await yt.youtubeUploadStatus(session!, token, total).catch(() => null);
            if (s) { sent = s.received; videoId = s.videoId ?? null; }
          }
          await db.youtubeUpload.update({ where: { id: up.id }, data: { sent: BigInt(sent) } });
          await ctx.progress(Math.min(0.97, sent / Math.max(1, total)));
        }
      } finally {
        await fh.close();
      }
      if (!videoId) return fail("YouTube took every byte but didn't say which video it made — check YouTube Studio before uploading again.");

      // The thumbnail — a refusal is a note on a finished upload, not a failure.
      let thumbnailNote: string | null = null;
      if (up.thumbnailKey) {
        const head = await storage.head(up.thumbnailKey, yt.YT_THUMB_MAX + 1).catch(() => null);
        const type = up.thumbnailKey.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
        thumbnailNote = head ? (await yt.setYoutubeThumbnail(token, videoId, head, type)).note : "The thumbnail file couldn't be read, so it wasn't set.";
      }
      await db.youtubeUpload.update({ where: { id: up.id }, data: { state: "done", videoId, sent: BigInt(total), session: null, thumbnailNote } });
      // The project carries its video (E-MEA-17) — unless a person already linked another.
      if (up.projectId) await db.contentProject.updateMany({ where: { id: up.projectId, youtubeVideoId: null }, data: { youtubeVideoId: videoId } });
      const { writeAudit } = await import("@/lib/governance");
      await writeAudit({ workspaceId: up.workspaceId, actorId: up.createdById, action: "youtube.uploaded", entityType: "youtube_upload", entityId: up.id, meta: { videoId, privacy: meta.publishAt ? "scheduled" : meta.privacy, bytes: total } });
      await ctx.progress(1);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const row = await db.youtubeUpload.findUnique({ where: { id: up.id }, select: { state: true } });
      if (row?.state !== "failed") await db.youtubeUpload.update({ where: { id: up.id }, data: { state: "failed", error: message.slice(0, 500) } });
      throw e;
    } finally {
      await file.done();
    }
  });
}
