import { promises as fs } from "node:fs";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { keyring, open, seal, type Sealed } from "@/lib/keyring";
import { getStorageBackendSetting, localProvider, storage } from "@/lib/storage";
import { CHUNK_BYTES, formatBytes } from "@/lib/documents/kinds";

/**
 * A big file, one piece at a time (E-ENG-13). Railway gives a request body five
 * minutes, so 2,500 MB can't be one request on most lines — and one dropped
 * connection would lose all of it. No piece is held here longer than its own
 * request, and nothing is kept in memory but that piece:
 *   · on Drive each piece goes straight through to Drive's resumable upload;
 *   · on local storage they're appended to a part file, renamed when whole;
 *   · a file of one piece is stored in one go, the path every small file always
 *     took, so a Drive problem with the big path can't touch the common case.
 */

/** Someone's upload, as far as this file cares. */
export type UploadRow = {
  id: string;
  workspaceId: string;
  name: string;
  contentType: string;
  size: bigint;
  received: bigint;
  backend: string;
  remote: string | null;
};

/** The upload is gone from where it was going; start again. */
export class UploadGone extends Error {}
/** Worth trying the piece again in a moment. */
export class UploadBusy extends Error {}

const SEALED = "sealed:";
/** Drive's session address is a credential for this one upload: sealed like the rest where a key is set. */
const sealRemote = (url: string) => (keyring().current ? `${SEALED}${JSON.stringify(seal(url))}` : url);
/** ⚠ After a key is retired an old address can't be opened: that upload is over, not broken — start again. */
function openRemote(value: string | null): string {
  if (!value?.startsWith(SEALED)) return value ?? "";
  try {
    return open(JSON.parse(value.slice(SEALED.length)) as Sealed);
  } catch {
    throw new UploadGone("This upload's address can't be opened with the keys set now.");
  }
}

/** Start one. Throws with a person's words when there's no room, or Drive won't have it. */
export async function beginUpload(name: string, contentType: string, size: number): Promise<{ backend: string; remote: string | null }> {
  if (size <= CHUNK_BYTES) return { backend: "whole", remote: null };
  if ((await getStorageBackendSetting()) === "gdrive") {
    const { gdriveBeginResumable } = await import("@/lib/storage/gdrive");
    return { backend: "gdrive", remote: sealRemote(await gdriveBeginResumable(name, contentType, size)) };
  }
  const dir = await localProvider.ensureParts();
  // A full disk takes the whole app with it, so ask first (a gigabyte to spare).
  const disk = await fs.statfs(dir).catch(() => null);
  if (disk && disk.bavail * disk.bsize < size + 1024 * 1024 * 1024) {
    throw new Error(`There isn't room for ${formatBytes(size)} on this server's disk (${formatBytes(disk.bavail * disk.bsize)} free).`);
  }
  return { backend: "local", remote: nanoid(20) };
}

/** Take one piece. `key` is the stored file, once the last piece is in. */
export async function writePiece(s: UploadRow, offset: number, bytes: Buffer): Promise<{ received: number; key?: string }> {
  const size = Number(s.size);
  if (s.backend === "whole") {
    const stored = await storage.put(s.name, bytes, s.contentType, s.workspaceId);
    return { received: size, key: stored.key };
  }
  if (s.backend === "gdrive") {
    const { gdriveSendPiece, ResumableBusy, ResumableGone } = await import("@/lib/storage/gdrive");
    try {
      const out = await gdriveSendPiece(openRemote(s.remote), offset, bytes, size);
      return out.id ? { received: out.received, key: await ownedDriveKey(out.id, s.workspaceId) } : { received: out.received };
    } catch (e) {
      if (e instanceof ResumableGone) throw new UploadGone(e.message);
      if (e instanceof ResumableBusy) throw new UploadBusy(e.message);
      throw e;
    }
  }
  const part = localProvider.partPath(s.remote ?? "");
  // A retry after a piece that half-landed: cut back to where this one starts.
  const have = (await fs.stat(part).catch(() => null))?.size ?? 0;
  if (have > offset) await fs.truncate(part, offset);
  if (have < offset) throw new UploadGone("The part file is shorter than it should be.");
  await fs.appendFile(part, bytes);
  if (offset + bytes.byteLength < size) return { received: offset + bytes.byteLength };
  const key = await localProvider.adoptPart(part, s.name);
  const { recordOwner } = await import("@/lib/storage/owners");
  await recordOwner(key, s.workspaceId);
  return { received: size, key };
}

async function ownedDriveKey(id: string, workspaceId: string): Promise<string> {
  const { GDRIVE_KEY_PREFIX } = await import("@/lib/storage/gdrive");
  const key = `${GDRIVE_KEY_PREFIX}${id}`;
  const { recordOwner } = await import("@/lib/storage/owners");
  await recordOwner(key, workspaceId);
  return key;
}

/** How much really arrived — asked of Drive, because a piece's reply can be lost when the piece wasn't. */
export async function uploadStatus(s: UploadRow): Promise<{ received: number; key?: string }> {
  if (s.backend === "whole") return { received: Number(s.received) };
  if (s.backend === "gdrive") {
    const { gdriveResumableStatus, ResumableBusy, ResumableGone } = await import("@/lib/storage/gdrive");
    try {
      const out = await gdriveResumableStatus(openRemote(s.remote), Number(s.size));
      return out.id ? { received: out.received, key: await ownedDriveKey(out.id, s.workspaceId) } : { received: out.received };
    } catch (e) {
      if (e instanceof ResumableGone) throw new UploadGone(e.message);
      if (e instanceof ResumableBusy) throw new UploadBusy(e.message);
      throw e;
    }
  }
  return { received: (await fs.stat(localProvider.partPath(s.remote ?? "")).catch(() => null))?.size ?? 0 };
}

/** Give up on one: whatever arrived goes, wherever it is. Best effort. */
export async function dropUpload(s: UploadRow): Promise<void> {
  try {
    if (s.backend === "gdrive" && s.remote) {
      const { gdriveCancelResumable } = await import("@/lib/storage/gdrive");
      await gdriveCancelResumable(openRemote(s.remote));
    } else if (s.backend === "local" && s.remote) {
      await fs.rm(localProvider.partPath(s.remote), { force: true });
    }
  } catch {
    // Drive forgets an upload in a week anyway; a part file goes with the container.
  }
}

const WEEK_MS = 7 * 24 * 3600_000;
const DAY_MS = 24 * 3600_000;

/**
 * The housekeeping: uploads nobody came back to (Drive forgets them after a week),
 * finished ones past the time a repeated finish could need them, readings that
 * stopped, and files saved before the app could read them.
 */
export async function sweepUploads(now = Date.now()): Promise<{ dropped: number; started: number }> {
  const stale = await db.uploadSession.findMany({ where: { sourceId: null, updatedAt: { lt: new Date(now - WEEK_MS) } }, take: 50 });
  for (const s of stale) {
    await dropUpload(s);
    await db.uploadSession.delete({ where: { id: s.id } }).catch(() => {});
  }
  await db.uploadSession.deleteMany({ where: { sourceId: { not: null }, updatedAt: { lt: new Date(now - DAY_MS) } } });

  const { jobs } = await import("@/lib/jobs");
  const { registerResearchReadJobs } = await import("@/lib/jobs/research-read");
  registerResearchReadJobs();

  // A reading whose job ended with the row still saying "reading" stopped for good (the container died too often).
  const reading = await db.researchSource.findMany({ where: { readState: "reading" }, select: { id: true }, take: 20 });
  for (const r of reading) {
    const job = await jobs.latestFor("research.read", r.id);
    if (!job || job.state === "done" || job.state === "failed") {
      await db.researchSource.updateMany({
        where: { id: r.id, readState: "reading" },
        data: { readState: "failed", readNote: "Saved, but the reading stopped before it finished. Press Read again to try once more." },
      });
    }
  }

  const unread = await db.researchSource.findMany({ where: { readState: "unread" }, select: { id: true, channel: { select: { workspaceId: true } } }, take: 5 });
  let started = 0;
  for (const u of unread) {
    const { count } = await db.researchSource.updateMany({ where: { id: u.id, readState: "unread" }, data: { readState: "reading" } });
    if (!count) continue;
    await jobs.enqueue("research.read", { sourceId: u.id, actorId: null }, { refId: u.id, workspaceId: u.channel.workspaceId });
    started++;
  }
  return { dropped: stale.length, started };
}
