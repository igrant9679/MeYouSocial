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

/**
 * PLATFORM-MANAGED keys — shared by every workspace, editable only by the
 * platform operator (`isPlatformOperator`, i.e. BOOTSTRAP_ADMIN_EMAIL).
 *
 * ⚠ These deliberately SKIP the WorkspaceSetting layer on read. Gating the
 * write alone would not be enough: resolution is workspace-first, so any row
 * left behind from before a key became platform-managed would shadow the shared
 * value forever, for that one tenant, invisibly. Skipping the layer means there
 * is exactly one source of truth and a stale row is inert rather than wrong.
 *
 * `api_key:youtube` is here because the YouTube **Data** API key is not bound to
 * a channel — it reads any public channel by id — so one key genuinely serves
 * every tenant. The channel-owned half (`youtube_oauth:*`) is the opposite: it
 * is per-workspace and must NEVER be listed here.
 *
 * ⚠ Adding a key here makes it shared across tenants. Quota is per Cloud
 * project, not per workspace, so one tenant can exhaust another's. Only add a
 * credential the operator genuinely intends to pool.
 */
export const PLATFORM_MANAGED_KEYS: ReadonlySet<string> = new Set(["api_key:youtube"]);

export function isPlatformManagedKey(key: string): boolean {
  return PLATFORM_MANAGED_KEYS.has(key);
}

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
    // Platform-managed keys ignore the workspace layer entirely — see the note
    // on PLATFORM_MANAGED_KEYS. Everything else is workspace-first.
    if (workspaceId && !PLATFORM_MANAGED_KEYS.has(key)) {
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
  // A platform-managed key has no meaningful per-workspace value; returning a
  // stale row here would let an admin UI claim "your key" for a shared one.
  if (PLATFORM_MANAGED_KEYS.has(key)) return "";
  try {
    const ws = await db.workspaceSetting.findUnique({ where: { workspaceId_key: { workspaceId, key } } });
    return ws?.value ?? "";
  } catch {
    return "";
  }
}

export async function setWorkspaceSetting(workspaceId: string, key: string, value: string): Promise<void> {
  // Fail loudly rather than writing a row that would be silently ignored on
  // read. If this throws, the caller should be using setPlatformSetting.
  if (PLATFORM_MANAGED_KEYS.has(key)) {
    throw new Error(`"${key}" is platform-managed — write it with setPlatformSetting, not per workspace.`);
  }
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

/** Platform-level (global) Setting write — for operator-managed infra config
 *  (storage, Unipile) that is shared across every tenant. Empty value clears. */
export async function setPlatformSetting(key: string, value: string): Promise<void> {
  if (!value) {
    await db.setting.deleteMany({ where: { key } });
  } else {
    await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }
  invalidateSettingsCache();
}

export function invalidateSettingsCache() {
  cache.clear();
}
