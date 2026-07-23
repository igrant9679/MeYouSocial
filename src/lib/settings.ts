import { db } from "@/lib/db";

/**
 * Workspace-scoped setting resolution (multi-tenant): each company brings its
 * own API keys / SMTP / provider switches, stored in WorkspaceSetting; the
 * global Setting row (and ultimately the env var, handled by each caller) is
 * the platform fallback for workspaces that haven't configured their own.
 *
 * Resolution: WorkspaceSetting[workspaceId, key] → Setting[key] → "" (caller
 * applies its env fallback). 30s cache, busted by the admin save actions.
 */

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { value: string; expires: number }>();

function cacheKey(key: string, workspaceId?: string | null): string {
  return `${workspaceId ?? "__global__"}:${key}`;
}

export async function getSetting(key: string, workspaceId?: string | null): Promise<string> {
  const ck = cacheKey(key, workspaceId);
  const hit = cache.get(ck);
  if (hit && hit.expires > Date.now()) return hit.value;

  let value = "";
  try {
    if (workspaceId) {
      const ws = await db.workspaceSetting.findUnique({
        where: { workspaceId_key: { workspaceId, key } },
      });
      value = ws?.value ?? "";
    }
    if (!value) {
      const row = await db.setting.findUnique({ where: { key } });
      value = row?.value ?? "";
    }
  } catch {
    // DB unavailable — callers fall through to their env fallback
  }
  cache.set(ck, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

/** Reads ONLY the workspace row — no global fallback. For admin UIs that must
 *  show whether THIS workspace configured a value vs inheriting the platform's. */
export async function getWorkspaceSettingRaw(workspaceId: string, key: string): Promise<string> {
  try {
    const ws = await db.workspaceSetting.findUnique({ where: { workspaceId_key: { workspaceId, key } } });
    return ws?.value ?? "";
  } catch {
    return "";
  }
}

export async function setWorkspaceSetting(workspaceId: string, key: string, value: string): Promise<void> {
  if (!value) {
    await db.workspaceSetting.deleteMany({ where: { workspaceId, key } });
  } else {
    await db.workspaceSetting.upsert({
      where: { workspaceId_key: { workspaceId, key } },
      update: { value },
      create: { workspaceId, key, value },
    });
  }
  invalidateSettingsCache();
}

export function invalidateSettingsCache() {
  cache.clear();
}
