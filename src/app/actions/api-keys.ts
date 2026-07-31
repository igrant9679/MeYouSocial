"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, isPlatformOperator } from "@/lib/acl";
import { db } from "@/lib/db";
import { KEY_PROVIDERS, type KeyProvider } from "@/lib/llm/keys";
import { llm } from "@/lib/llm";

// Admin-only: save / clear provider API keys and switches. Multi-tenant: every
// save below writes a WorkspaceSetting row for the acting admin's workspace —
// each company brings its own keys; the global Setting/env stays as the
// platform fallback (managed by the platform operator, not through this UI).
// After save we bust the settings cache so the new key takes effect within a
// request, no redeploy.

const SETTING_KEY: Record<KeyProvider, string> = {
  anthropic: "api_key:anthropic",
  openai:    "api_key:openai",
  google:    "api_key:google",
  deepseek:  "api_key:deepseek",
  xai:       "api_key:xai",
  moonshot:  "api_key:moonshot",
  minimax:   "api_key:minimax",
  youtube:   "api_key:youtube",
  elevenlabs: "api_key:elevenlabs",
  heygen:    "api_key:heygen",
};

/**
 * Media provider switches (video renderer, TTS) — stored as Settings so admins
 * change them in-app without touching Railway. Values are validated here.
 */
export async function saveMediaSettingAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const setting = String(formData.get("setting") ?? "");
  const value = String(formData.get("value") ?? "");
  const ALLOWED: Record<string, string[]> = {
    "video:provider": ["auto", "mock", "veo"],
    "tts:provider": ["mock", "elevenlabs"],
    "image:provider": ["auto", "mock", "openai", "google"],
  };
  if (!ALLOWED[setting]?.includes(value)) return;
  const { setWorkspaceSetting } = await import("@/lib/settings");
  await setWorkspaceSetting(workspace.id, setting, value);
  revalidatePath("/admin/api-keys");
  redirect(`/admin/api-keys?ok=${encodeURIComponent(setting)}`);
}

const SEARCH_VENDORS = ["tavily", "serper"] as const;

/** Admin-only: save / clear a search provider key (same DB-first pattern). */
export async function saveSearchKeyAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const vendor = String(formData.get("vendor") ?? "");
  if (!(SEARCH_VENDORS as readonly string[]).includes(vendor)) return;
  const value = String(formData.get("value") ?? "").trim();
  const { setWorkspaceSetting } = await import("@/lib/settings");
  await setWorkspaceSetting(workspace.id, `api_key:${vendor}`, value);
  revalidatePath("/admin/api-keys");
  redirect(`/admin/api-keys?ok=${vendor}`);
}

/**
 * Storage settings (backend switch, Drive service account, Drive folder).
 * Validation is live: switching to Drive — or changing the folder while Drive
 * is configured — runs a write-then-delete probe so a misconfigured folder or
 * exhausted quota fails HERE with a message, not silently at upload time.
 */
export async function saveStorageSettingAction(formData: FormData) {
  // Storage is PLATFORM infrastructure (one Drive/local store serves every
  // tenant) — only the platform operator may change it.
  const { user } = await requireRole("ADMIN");
  if (!isPlatformOperator(user.email)) {
    redirect("/admin/api-keys?err=" + encodeURIComponent("Storage is managed by the platform operator."));
  }
  const setting = String(formData.get("setting") ?? "");
  const value = String(formData.get("value") ?? "").trim();
  const { invalidateStorageCache } = await import("@/lib/storage");
  const { invalidateGdriveCache, parseServiceAccount, extractFolderId, getGdriveConfig, gdriveProbeWrite } = await import("@/lib/storage/gdrive");

  const fail = (msg: string) => redirect(`/admin/api-keys?err=${encodeURIComponent(msg)}#storage`);

  if (setting === "storage:backend") {
    if (value !== "local" && value !== "gdrive") return;
    if (value === "gdrive") {
      invalidateGdriveCache();
      const { getDriveAuthMode, resolveDriveAccess } = await import("@/lib/storage/gdrive");
      // Which prerequisite is missing depends on the auth mode — telling an
      // OAuth user to paste a service account JSON would send them the wrong way.
      if ((await getDriveAuthMode()) === "oauth") {
        if (!(await resolveDriveAccess().catch(() => null))) {
          fail("Connect a Google account below before switching storage to Google Drive.");
        }
      } else if (!(await getGdriveConfig())) {
        fail("Add the service account JSON and folder below before switching to Google Drive.");
      }
      const probe = await gdriveProbeWrite();
      if (!probe.ok) fail(`Drive write test failed: ${probe.error}`);
    }
    await db.setting.upsert({ where: { key: setting }, update: { value }, create: { key: setting, value } });
  } else if (setting === "gdrive:auth_mode") {
    if (value !== "service_account" && value !== "oauth") return;
    await db.setting.upsert({ where: { key: setting }, update: { value }, create: { key: setting, value } });
    invalidateGdriveCache();
    // If Drive is already the live backend, a mode switch changes where every
    // future upload goes — prove the new mode actually works rather than
    // letting it fail at upload time. The setting is kept either way; the
    // operator may well be mid-setup.
    const backend = await db.setting.findUnique({ where: { key: "storage:backend" } });
    if (backend?.value === "gdrive") {
      const probe = await gdriveProbeWrite();
      if (!probe.ok) fail(`Switched, but the write test failed: ${probe.error}`);
    }
  } else if (setting === "gdrive:service_account") {
    if (value && !parseServiceAccount(value)) {
      fail("That doesn't look like a service account JSON key (needs client_email + private_key). Google Cloud Console → IAM → Service Accounts → Keys → Add key (JSON).");
    }
    if (value) {
      await db.setting.upsert({ where: { key: setting }, update: { value }, create: { key: setting, value } });
    } else {
      await db.setting.deleteMany({ where: { key: setting } });
    }
  } else if (setting === "gdrive:folder_id") {
    const id = value ? extractFolderId(value) : null;
    if (value && !id) fail("Couldn't read a folder id from that — paste the folder's URL or its id.");
    if (id) {
      await db.setting.upsert({ where: { key: setting }, update: { value: id }, create: { key: setting, value: id } });
      invalidateGdriveCache();
      if (await getGdriveConfig()) {
        const probe = await gdriveProbeWrite();
        if (!probe.ok) fail(`Saved, but the write test failed: ${probe.error}`);
      }
    } else {
      await db.setting.deleteMany({ where: { key: setting } });
    }
  } else {
    return;
  }

  invalidateGdriveCache();
  invalidateStorageCache();
  revalidatePath("/admin/api-keys");
  redirect(`/admin/api-keys?ok=${encodeURIComponent(setting)}#storage`);
}

// ── Drive user-OAuth (platform storage) ──────────────────────────────────────
//
// Mirrors the YouTube OAuth actions in analytics-connections.ts, but every
// value is a PLATFORM setting and every action is gated to the platform
// operator — storage is shared infrastructure, not a per-tenant credential.

/** Guard + redirect helper shared by the three OAuth actions below. */
async function requireStorageOperator() {
  const { user } = await requireRole("ADMIN");
  if (!isPlatformOperator(user.email)) {
    redirect("/admin/api-keys?err=" + encodeURIComponent("Storage is managed by the platform operator.") + "#storage");
  }
}

export async function saveGdriveOauthClientAction(formData: FormData) {
  await requireStorageOperator();
  const clientId = String(formData.get("client_id") ?? "").trim();
  const clientSecret = String(formData.get("client_secret") ?? "").trim();
  const { setPlatformSetting } = await import("@/lib/settings");
  await setPlatformSetting("gdrive_oauth:client_id", clientId);
  // Keep an existing secret when the field is left blank (it renders masked).
  if (clientSecret) await setPlatformSetting("gdrive_oauth:client_secret", clientSecret);
  revalidatePath("/admin/api-keys");
  redirect("/admin/api-keys?ok=" + encodeURIComponent("Drive OAuth client saved — now hit Connect.") + "#storage");
}

/** Kick off the consent flow (redirects to Google). */
export async function connectGdriveAction() {
  await requireStorageOperator();
  const { buildGdriveAuthUrl } = await import("@/lib/storage/gdrive-oauth");
  const { getPublicUrl } = await import("@/lib/public-url");
  const url = await buildGdriveAuthUrl(await getPublicUrl());
  if (!url) {
    redirect("/admin/api-keys?err=" + encodeURIComponent("Save an OAuth client ID and secret first.") + "#storage");
  }
  redirect(url!);
}

export async function disconnectGdriveAction() {
  await requireStorageOperator();
  const { disconnectGdriveOauth } = await import("@/lib/storage/gdrive-oauth");
  const { invalidateGdriveCache } = await import("@/lib/storage/gdrive");
  await disconnectGdriveOauth();
  invalidateGdriveCache();
  revalidatePath("/admin/api-keys");
  // Deliberately does NOT touch storage:backend. If Drive was live, uploads now
  // fail loudly with "not connected" — which is correct. Silently reverting to
  // local disk would scatter new files onto a disk that gets wiped on redeploy,
  // and nothing would say so.
  redirect("/admin/api-keys?ok=" + encodeURIComponent("Google account disconnected. Files already in Drive keep working.") + "#storage");
}

export async function saveApiKeyAction(formData: FormData) {
  const { workspace, user } = await requireRole("ADMIN");
  const provider = String(formData.get("provider") ?? "") as KeyProvider;
  if (!KEY_PROVIDERS.includes(provider) && provider !== "youtube" && provider !== "elevenlabs" && provider !== "heygen") return;
  const value = String(formData.get("value") ?? "").trim();
  const settingKey = SETTING_KEY[provider];
  const { setWorkspaceSetting, setPlatformSetting, isPlatformManagedKey } = await import("@/lib/settings");

  if (isPlatformManagedKey(settingKey)) {
    // Shared across every tenant, so only the operator may touch it. Workspace
    // admins don't get a field for this at all — this is the server-side half,
    // because a hidden input is not a permission check.
    if (!isPlatformOperator(user.email)) {
      redirect("/admin/api-keys?err=" + encodeURIComponent(`The ${provider} key is shared across all workspaces and is managed by the platform operator.`));
    }
    await setPlatformSetting(settingKey, value);
    // Clear anything left from before the key became shared. Without this the
    // old rows are inert (getSetting skips the workspace layer for these) but
    // still readable in the DB, which reads as "this tenant has its own key".
    await db.workspaceSetting.deleteMany({ where: { key: settingKey } });
  } else {
    await setWorkspaceSetting(workspace.id, settingKey, value);
  }

  llm.invalidateKeyCache();
  revalidatePath("/admin/api-keys");
  redirect(`/admin/api-keys?ok=${provider}`);
}
