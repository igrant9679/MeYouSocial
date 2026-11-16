import { db } from "@/lib/db";

/**
 * Workspace-scoped setting resolution (multi-tenant): each company brings its
 * own API keys / SMTP / provider switches, stored in WorkspaceSetting; the
 * global Setting row (and ultimately the env var, handled by each caller) is
 * the platform fallback for workspaces that haven't configured their own.
 *
 * Resolution: WorkspaceSetting[workspaceId, key] → (shareable keys only) the
 * row a workspace shares with this one → Setting[key] → "" (caller applies its
 * env fallback). 30s cache, busted by the admin save actions.
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

/**
 * WORKSPACE-ONLY keys — the opposite of PLATFORM_MANAGED_KEYS: a tenant's own
 * identity (which site and property it measures, which Google account or
 * service account reads them, which YouTube channel is connected). These never
 * inherit a global row: a workspace without its own value has NO value.
 *
 * ⚠ Why: with the global fallback, a workspace that hadn't configured analytics
 * would read whatever global row existed — and "disconnect" (which deletes the
 * workspace row) silently re-exposed it. Combined with the shared platform
 * service account, one tenant could query another tenant's Search Console.
 */
export const WORKSPACE_ONLY_KEYS: ReadonlySet<string> = new Set([
  "gsc:site_url",
  "ga4:property_id",
  "gsc:service_account",
  "ga4:service_account",
  "ganalytics_oauth:refresh_token",
  "ganalytics_oauth:account",
  "youtube_oauth:refresh_token",
  "youtube_oauth:channel",
]);

/**
 * SHAREABLE keys — the ones a workspace admin may let another workspace use
 * (KeyShare, lib/key-shares.ts; 2026-11-15). Resolution for these is
 * own row → a row another workspace shares → the platform's → env.
 *
 * ⚠ An ALLOWLIST, and only keys that buy a service: writing, images, voice,
 * search and reading. Never a credential that IS an identity — `zernio:api_key`
 * posts as the company's social accounts, a mailbox sends as a person, OAuth
 * tokens and service accounts read one tenant's own site — and never a
 * platform-managed key, which every workspace already has.
 *
 * ⚠ A share is a pointer, never a copy: the value is read from the giver's OWN
 * row at the moment of use, so a borrowed key cannot be passed on, a replaced key
 * reaches everyone, and a removed one reaches no one.
 */
export const SHAREABLE_KEYS: ReadonlySet<string> = new Set([
  "api_key:anthropic",
  "api_key:google",
  "api_key:openai",
  "api_key:elevenlabs",
  "api_key:heygen",
  "api_key:tavily",
  "api_key:serper",
  "api_key:dataforseo",
  "api_key:keywordseverywhere",
  "api_key:exa",
  "api_key:jina",
  "api_key:github",
]);

export function isShareableKey(key: string): boolean {
  return SHAREABLE_KEYS.has(key);
}

/**
 * The value of a key another workspace shares with this one: the giver's own
 * stored row, or "" when there is no share, the giver has been deleted (even
 * while it waits out its restore window), or the giver no longer stores one.
 */
async function sharedKeyValue(workspaceId: string, key: string): Promise<string> {
  const share = await db.keyShare.findUnique({
    where: { toWorkspaceId_key: { toWorkspaceId: workspaceId, key } },
    select: { fromWorkspaceId: true, from: { select: { deletedAt: true } } },
  });
  if (!share || share.from.deletedAt) return "";
  const row = await db.workspaceSetting.findUnique({ where: { workspaceId_key: { workspaceId: share.fromWorkspaceId, key } } });
  return row?.value ?? "";
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
      // No key of its own: one another workspace shares with it comes next,
      // ahead of the platform's — an admin chose it for this workspace.
      if (!value && SHAREABLE_KEYS.has(key)) value = await sharedKeyValue(workspaceId, key);
    }
    // Workspace-only keys stop here: no global row, ever (see WORKSPACE_ONLY_KEYS).
    if (!value && !WORKSPACE_ONLY_KEYS.has(key)) {
      const row = await db.setting.findUnique({ where: { key } });
      value = row?.value ?? "";
    }
  } catch (e) {
    // DB unavailable — callers fall through to their env fallback. ⚠ Say so:
    // this swallow once turned a UTM-tagging miss into an unexplainable "the
    // setting was true but the send behaved as if it wasn't" (2026-08-04).
    // A feature silently degrading must at least leave a line in the logs.
    console.warn(`[settings] read failed for "${key}" (ws=${workspaceId ?? "global"}) — returning empty:`, e instanceof Error ? e.message : e);
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
  const before = (await db.workspaceSetting.findUnique({ where: { workspaceId_key: { workspaceId, key } }, select: { value: true } }))?.value ?? "";
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
  // Who changed it, and from what (E-SET-05) — only when it did change, and
  // only when a person caused it; never breaks the write.
  if (before !== value) {
    const { recordSettingChange } = await import("@/lib/setting-history");
    await recordSettingChange(workspaceId, key, before || null, value || null).catch(() => undefined);
  }
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
