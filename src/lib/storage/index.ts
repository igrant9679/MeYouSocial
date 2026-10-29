import { promises as fs } from "node:fs";
import path from "node:path";
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
  url(key) {
    return key.startsWith("gdrive:") ? `/api/files/${encodeURIComponent(key)}` : `/uploads/${key}`;
  },
};
