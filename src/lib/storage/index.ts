import { createWriteStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { nanoid } from "nanoid";
import { env } from "@/lib/env";

// Storage layer (uploads, voiceovers, persisted video renders).
// Backends: local | gdrive. Which backend receives NEW files is the Setting
// `storage:backend` (Settings → Keys → Storage), DB-first with STORAGE_BACKEND
// env fallback — same pattern as `video:provider`. Reads dispatch on the KEY
// (gdrive keys are `gdrive:<fileId>`, local keys are bare `<nanoid><ext>`), so
// files stored under either backend keep resolving after a switch.
//
// Serving: /uploads/<key> streams local files from disk; /api/files/<key>
// streams Drive files. Both are session-gated routes — nothing is public.

export type StoredFile = {
  key: string;       // opaque key (use for retrieval)
  url: string;       // app-relative URL served by our routes
  size: number;
  contentType?: string;
  originalName?: string;
};

export interface StorageProvider {
  put(name: string, data: Buffer | Uint8Array, contentType?: string): Promise<StoredFile>;
  get(key: string): Promise<Buffer | null>;
  url(key: string): string;
  /** Delete the file; true when it's gone (or was never there). For a purge (E-SEC-14). */
  remove(key: string): Promise<boolean>;
}

class LocalStorage implements StorageProvider {
  constructor(private root: string) {}
  private async ensure() {
    await fs.mkdir(this.root, { recursive: true });
  }
  async put(name: string, data: Buffer | Uint8Array, contentType?: string): Promise<StoredFile> {
    await this.ensure();
    const ext = path.extname(name) || "";
    const key = nanoid(16) + ext;
    const full = path.join(this.root, key);
    await fs.writeFile(full, data);
    return {
      key,
      url: `/uploads/${key}`,
      size: data.byteLength,
      contentType,
      originalName: name,
    };
  }
  async get(key: string): Promise<Buffer | null> {
    // Keys are nanoid+ext; reject anything path-like so a crafted key can
    // never traverse out of the uploads root.
    if (!/^[A-Za-z0-9_-]+(\.[A-Za-z0-9]+)?$/.test(key)) return null;
    try {
      return await fs.readFile(path.join(this.root, key));
    } catch {
      return null;
    }
  }
  url(key: string): string {
    return `/uploads/${key}`;
  }
  /** Where a stored file lives, or null when this isn't a key — so a big file can be streamed, not loaded. */
  pathOf(key: string): string | null {
    return /^[A-Za-z0-9_-]+(\.[A-Za-z0-9]+)?$/.test(key) ? path.join(this.root, key) : null;
  }
  /** A file coming up in pieces (lib/storage/chunked.ts). Its folder isn't a key, so it can't be served. */
  partPath(name: string): string {
    return path.join(this.root, ".uploading", name);
  }
  async ensureParts(): Promise<string> {
    const dir = path.join(this.root, ".uploading");
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }
  /** A whole part file becomes a stored one. */
  async adoptPart(part: string, originalName: string): Promise<string> {
    await this.ensure();
    const key = nanoid(16) + path.extname(originalName);
    await fs.rename(part, path.join(this.root, key));
    return key;
  }
  async remove(key: string): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]+(\.[A-Za-z0-9]+)?$/.test(key)) return false;
    try {
      await fs.unlink(path.join(this.root, key));
      return true;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === "ENOENT";
    }
  }
}

export const localProvider = new LocalStorage(path.resolve(env.STORAGE_LOCAL_DIR));

// ── Backend selection (DB Setting first, env fallback, 30s cache) ────────────

export type StorageBackend = "local" | "gdrive";

const BACKEND_TTL_MS = 30_000;
let backendCache: { value: StorageBackend; expires: number } | null = null;

export async function getStorageBackendSetting(): Promise<StorageBackend> {
  if (backendCache && backendCache.expires > Date.now()) return backendCache.value;
  let value: StorageBackend | null = null;
  try {
    const { db } = await import("@/lib/db");
    const row = await db.setting.findUnique({ where: { key: "storage:backend" } });
    if (row?.value === "local" || row?.value === "gdrive") value = row.value;
  } catch {
    // DB unavailable — fall through to env
  }
  if (!value) value = env.STORAGE_BACKEND === "gdrive" ? "gdrive" : "local";
  backendCache = { value, expires: Date.now() + BACKEND_TTL_MS };
  return value;
}

export function invalidateStorageCache() {
  backendCache = null;
}

// ── Dispatching facade ───────────────────────────────────────────────────────

/**
 * The facade every caller uses. `owner` is REQUIRED (E-SEC-11): the workspace
 * whose members may open the file — recorded as a StoredObject row and checked by
 * /uploads and /api/files (lib/storage/owners.ts). Pass null only for a file that
 * belongs to no workspace; it is then open to any signed-in member, the rule every
 * file stored before 2026-10-29 still has.
 */
export type OwnedStorage = Omit<StorageProvider, "put"> & {
  put(name: string, data: Buffer | Uint8Array, contentType: string | undefined, owner: string | null): Promise<StoredFile>;
  /** The first `bytes` bytes (all of a smaller file), without fetching the rest. Null when it can't be read. */
  head(key: string, bytes: number): Promise<Buffer | null>;
  /**
   * The file at a path on this machine, without holding it in memory. "too-big" past
   * `maxBytes` (nothing kept); null when it can't be fetched. Call `done` afterwards.
   */
  fileOnDisk(key: string, maxBytes: number): Promise<{ path: string; done(): Promise<void> } | "too-big" | null>;
};

export const storage: OwnedStorage = {
  async put(name, data, contentType, owner) {
    let file: StoredFile;
    if ((await getStorageBackendSetting()) === "gdrive") {
      // Throws with a clear message if Drive is selected but unconfigured —
      // silently falling back to local would quietly lose the file on the
      // next redeploy, which is the exact failure this backend exists to fix.
      const { gdriveProvider } = await import("@/lib/storage/gdrive");
      file = await gdriveProvider.put(name, data, contentType);
    } else {
      file = await localProvider.put(name, data, contentType);
    }
    if (owner) {
      const { recordOwner } = await import("@/lib/storage/owners");
      await recordOwner(file.key, owner);
    }
    return file;
  },
  async get(key) {
    if (key.startsWith("gdrive:")) {
      const { gdriveProvider } = await import("@/lib/storage/gdrive");
      return gdriveProvider.get(key);
    }
    return localProvider.get(key);
  },
  async head(key, bytes) {
    if (key.startsWith("gdrive:")) {
      const { gdriveFetchMedia } = await import("@/lib/storage/gdrive");
      const res = await gdriveFetchMedia(key.slice("gdrive:".length), `bytes=0-${bytes - 1}`).catch(() => null);
      if (!res?.body || !(res.ok || res.status === 206)) return null;
      // The Range is a request: stop reading at the size asked for whatever comes back.
      const parts: Buffer[] = [];
      let have = 0;
      const reader = res.body.getReader();
      while (have < bytes) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(Buffer.from(value));
        have += value.byteLength;
      }
      await reader.cancel().catch(() => {});
      return Buffer.concat(parts).subarray(0, bytes);
    }
    const file = localProvider.pathOf(key);
    const handle = file ? await fs.open(file, "r").catch(() => null) : null;
    if (!handle) return null;
    try {
      const buf = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buf, 0, bytes, 0);
      return buf.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  },
  async fileOnDisk(key, maxBytes) {
    if (!key.startsWith("gdrive:")) {
      const file = localProvider.pathOf(key);
      const stat = file ? await fs.stat(file).catch(() => null) : null;
      if (!file || !stat?.isFile()) return null;
      return stat.size > maxBytes ? "too-big" : { path: file, done: async () => {} };
    }
    const { gdriveFetchMedia } = await import("@/lib/storage/gdrive");
    const res = await gdriveFetchMedia(key.slice("gdrive:".length)).catch(() => null);
    if (!res?.ok || !res.body) return null;
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) {
      await res.body.cancel().catch(() => {});
      return "too-big";
    }
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mys-file-"));
    const done = () => fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    const out = path.join(dir, "file.bin");
    let seen = 0;
    const counted = new Transform({
      transform(chunk: Buffer, _enc, next) {
        seen += chunk.byteLength;
        next(seen > maxBytes ? new Error("too-big") : null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), counted, createWriteStream(out));
      return { path: out, done };
    } catch {
      await done();
      return seen > maxBytes ? "too-big" : null;
    }
  },
  url(key) {
    return key.startsWith("gdrive:") ? `/api/files/${encodeURIComponent(key)}` : `/uploads/${key}`;
  },
  async remove(key) {
    if (key.startsWith("gdrive:")) {
      const { gdriveProvider } = await import("@/lib/storage/gdrive");
      return gdriveProvider.remove(key);
    }
    return localProvider.remove(key);
  },
};
