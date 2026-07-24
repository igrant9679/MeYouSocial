"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
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
  const { env } = await import("@/lib/env");
  if (!env.BOOTSTRAP_ADMIN_EMAIL || user.email !== env.BOOTSTRAP_ADMIN_EMAIL) {
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
      if (!(await getGdriveConfig())) fail("Add the service account JSON and folder below before switching to Google Drive.");
      const probe = await gdriveProbeWrite();
      if (!probe.ok) fail(`Drive write test failed: ${probe.error}`);
    }
    await db.setting.upsert({ where: { key: setting }, update: { value }, create: { key: setting, value } });
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

export async function saveApiKeyAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const provider = String(formData.get("provider") ?? "") as KeyProvider;
  if (!KEY_PROVIDERS.includes(provider) && provider !== "youtube" && provider !== "elevenlabs" && provider !== "heygen") return;
  const value = String(formData.get("value") ?? "").trim();
  const { setWorkspaceSetting } = await import("@/lib/settings");
  await setWorkspaceSetting(workspace.id, SETTING_KEY[provider], value);
  llm.invalidateKeyCache();
  revalidatePath("/admin/api-keys");
  redirect(`/admin/api-keys?ok=${provider}`);
}
