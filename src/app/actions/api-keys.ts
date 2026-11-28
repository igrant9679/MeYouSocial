"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, isPlatformOperator } from "@/lib/acl";
import { db } from "@/lib/db";
import { KEY_PROVIDERS, isUsedKeyProvider, type KeyProvider } from "@/lib/llm/keys";
import { llm } from "@/lib/llm";
import { checkKeyFormat, keyFormatMessage } from "@/lib/key-format";
import { writeAudit } from "@/lib/governance";
import { createHash } from "node:crypto";

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
  openrouter: "api_key:openrouter",
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
    // "veo" (until 2026-11-24) is still READ as google: Veo's preview models are gone; Gemini Omni Flash replaced them.
    "video:provider": ["auto", "mock", "google"],
    "tts:provider": ["mock", "elevenlabs"],
    "image:provider": ["auto", "mock", "openai", "google"],
  };
  if (!ALLOWED[setting]?.includes(value)) return;
  const { setWorkspaceSetting } = await import("@/lib/settings");
  await setWorkspaceSetting(workspace.id, setting, value);
  revalidatePath("/admin/api-keys");
  redirect(`/admin/api-keys?ok=${encodeURIComponent(setting)}`);
}

// Web search (tavily, serper — lib/search) and search data / keyword volume
// (dataforseo, keywordseverywhere — lib/search-data) share this one save path.
// exa, jina and github feed Reach — live sources for search, reading, research and ideas (2026-11-09).
const SEARCH_VENDORS = ["tavily", "serper", "dataforseo", "keywordseverywhere", "exa", "jina", "github"] as const;

/** Admin-only: save / clear a search provider key (same DB-first pattern). */
/**
 * Start (or clear) a rotation checklist (E-SEC-03): after an incident, the
 * Keys page ticks off each stored key once it has been replaced since then.
 */
export async function rotationChecklistAction(formData: FormData) {
  const { workspace, user } = await requireRole("ADMIN");
  const start = formData.get("intent") === "start";
  const { setWorkspaceSetting } = await import("@/lib/settings");
  const { ROTATION_SETTING } = await import("@/lib/key-history");
  await setWorkspaceSetting(workspace.id, ROTATION_SETTING, start ? new Date().toISOString() : "");
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: start ? "security.rotation_started" : "security.rotation_cleared", entityType: "workspace", entityId: workspace.id });
  revalidatePath("/admin/api-keys");
  redirect("/admin/api-keys#rotation");
}

/**
 * Every key change is recorded — the key's name and a short fingerprint, never
 * the key (E-SEC-12). It used to leave no trace at all; the record also tells
 * every admin.
 */
async function auditKey(workspaceId: string, actorId: string, name: string, removing: boolean, value: string, platform = false) {
  await writeAudit({
    workspaceId, actorId,
    action: removing ? "api_key.removed" : "api_key.saved",
    entityType: "api_key", entityId: name,
    meta: { platform, ...(removing ? {} : { fingerprint: createHash("sha256").update(value).digest("hex").slice(0, 10) }) },
  });
}

export async function saveSearchKeyAction(formData: FormData) {
  const { workspace, user } = await requireRole("ADMIN");
  const vendor = String(formData.get("vendor") ?? "");
  if (!(SEARCH_VENDORS as readonly string[]).includes(vendor)) return;
  const value = String(formData.get("value") ?? "").trim();
  const removing = keyIntent(formData, vendor, value) === "remove";
  const problem = removing ? null : checkKeyFormat(vendor, value);
  if (problem) {
    redirect(`/admin/api-keys?err=${encodeURIComponent(keyFormatMessage(vendor, problem))}`);
  }
  const { setWorkspaceSetting } = await import("@/lib/settings");
  await setWorkspaceSetting(workspace.id, `api_key:${vendor}`, removing ? "" : value);
  await auditKey(workspace.id, user.id, vendor, removing, value);
  const ended = removing ? await endShares(workspace.id, `api_key:${vendor}`, user.id) : 0;
  revalidatePath("/admin/api-keys");
  if (removing) redirect(removedRedirect(vendor, ended));
  redirect(`/admin/api-keys?ok=${vendor}`);
}

/**
 * Reach's two dials (2026-11-09): `reach:free` — free public services (Jina
 * Reader and Exa's hosted endpoint, both keyless) on or off; `ideas:listen` —
 * idea discovery (articles, social posts and videos, since part dc) listens to live discussions first, on or off. Both default
 * on; an admin's choice, written through setWorkspaceSetting so it's audited.
 */
export async function saveReachDialAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const dial = String(formData.get("dial") ?? "");
  const on = String(formData.get("value") ?? "") === "on";
  if (dial !== "reach:free" && dial !== "ideas:listen") return;
  const { setWorkspaceSetting } = await import("@/lib/settings");
  // "" (the default, on) or "off" — absent means on, as both readers treat it.
  await setWorkspaceSetting(workspace.id, dial, on ? "" : "off");
  revalidatePath("/admin/api-keys");
  const what = dial === "reach:free"
    ? (on ? "Free public sources are on: pages are read through Jina Reader and Exa, and search falls back to Exa without a key." : "Free public sources are off: nothing goes to Jina or Exa without a key, pages are read by this server only, and Reddit needs an Exa key.")
    : (on ? "Idea discovery listens to live discussions first — articles, social posts and videos — and keeps the links on each idea." : "Idea discovery no longer listens to live discussions — ideas come from the company profile, Topics, keywords and competitors' videos only.");
  redirect(`/admin/api-keys?flash=${encodeURIComponent(what)}#reach`);
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
  const removing = keyIntent(formData, provider, value) === "remove";

  // Nothing calls these providers yet (SET-04): a key saved for one would read
  // as working and do nothing. Removing an old one is still allowed.
  if (!removing && KEY_PROVIDERS.includes(provider) && !isUsedKeyProvider(provider)) {
    redirect(`/admin/api-keys?err=${encodeURIComponent(`Nothing in the app calls ${provider} yet, so a key for it would do nothing. It wasn't saved.`)}`);
  }

  // Refuse here, not three screens later. A key field that accepts anything is
  // how a URL ended up stored as an ElevenLabs key with tts:provider pointed at
  // it — invisible until a render failed for an unrelated-looking reason.
  const problem = removing ? null : checkKeyFormat(provider, value);
  if (problem) {
    redirect(`/admin/api-keys?err=${encodeURIComponent(keyFormatMessage(provider, problem))}`);
  }
  const stored = removing ? "" : value;

  // OpenRouter (2026-11-27): the key is checked with OpenRouter before it is saved — a refused
  // key is not saved, and anything else is saved with what the check said (credit left, or why
  // it couldn't be checked).
  const checked = provider === "openrouter" && !removing ? await openRouterKeyCheck(value, "key-openrouter") : "";

  const settingKey = SETTING_KEY[provider];
  const { setWorkspaceSetting, setPlatformSetting, isPlatformManagedKey } = await import("@/lib/settings");

  if (isPlatformManagedKey(settingKey)) {
    // Shared across every tenant, so only the operator may touch it. Workspace
    // admins don't get a field for this at all — this is the server-side half,
    // because a hidden input is not a permission check.
    if (!isPlatformOperator(user.email)) {
      redirect("/admin/api-keys?err=" + encodeURIComponent(`The ${provider} key is shared across all workspaces and is managed by the platform operator.`));
    }
    await setPlatformSetting(settingKey, stored);
    // Clear anything left from before the key became shared. Without this the
    // old rows are inert (getSetting skips the workspace layer for these) but
    // still readable in the DB, which reads as "this tenant has its own key".
    await db.workspaceSetting.deleteMany({ where: { key: settingKey } });
  } else {
    await setWorkspaceSetting(workspace.id, settingKey, stored);
  }

  llm.invalidateKeyCache();
  await auditKey(workspace.id, user.id, provider, removing, stored, isPlatformManagedKey(settingKey));
  const ended = removing && !isPlatformManagedKey(settingKey) ? await endShares(workspace.id, settingKey, user.id) : 0;
  revalidatePath("/admin/api-keys");
  if (removing) redirect(removedRedirect(provider, ended));
  if (checked) redirect(`/admin/api-keys?ok=${provider}&flash=${encodeURIComponent(checked)}#key-${provider}`);
  redirect(`/admin/api-keys?ok=${provider}`);
}

/**
 * Ask OpenRouter about a key before saving it (GET /api/v1/key). A key it refuses (401) is not
 * saved — the admin is sent back with OpenRouter's own words. Out of credit, a network failure
 * or any other answer still saves, and the sentence returned says so.
 */
async function openRouterKeyCheck(value: string, anchor: string): Promise<string> {
  const { checkOpenRouterKey, describeKeyCheck } = await import("@/lib/llm/openrouter");
  let refused = "";
  let said = "";
  try {
    said = `OpenRouter key checked: ${describeKeyCheck(await checkOpenRouterKey(value))}`;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if ((e as { status?: number }).status === 401) refused = message.replace(/^openrouter 401: /, "");
    else said = `Saved, but OpenRouter's check didn't pass: ${message.replace(/^openrouter /, "")}`;
  }
  if (refused) redirect(`/admin/api-keys?err=${encodeURIComponent(`Not saved: ${refused}`)}#${anchor}`);
  return said;
}

/**
 * The platform's shared OpenRouter key (2026-11-27, the owner's OpenRouter decisions): the
 * global row, operator only. Any workspace with no OpenRouter key of its own uses it when it
 * picks an OpenRouter model, billed to the platform; those calls count against each
 * workspace's monthly AI budget like any other. ⚠ The owner pastes it; nobody else types or
 * reads it, and the page never shows any part of it.
 */
export async function savePlatformOpenRouterKeyAction(formData: FormData) {
  const { workspace, user } = await requireRole("ADMIN");
  const back = "#platform-openrouter";
  if (!isPlatformOperator(user.email)) {
    redirect(`/admin/api-keys?err=${encodeURIComponent("The shared OpenRouter key is managed by the platform operator.")}${back}`);
  }
  const intent = String(formData.get("intent") ?? "");
  if (intent === "remove") redirect(`/admin/api-keys?confirmRemove=platform-openrouter${back}`);
  const removing = intent === "remove-confirmed";
  const value = String(formData.get("value") ?? "").trim();
  if (!removing && !value) redirect(`/admin/api-keys?err=${encodeURIComponent("The key field was empty, so nothing was saved. To take the shared key away, use Remove.")}${back}`);
  const problem = removing ? null : checkKeyFormat("openrouter", value);
  if (problem) redirect(`/admin/api-keys?err=${encodeURIComponent(keyFormatMessage("openrouter", problem))}${back}`);
  const checked = removing ? "" : await openRouterKeyCheck(value, "platform-openrouter");

  const { setPlatformSetting, getSetting } = await import("@/lib/settings");
  await setPlatformSetting("api_key:openrouter", removing ? "" : value);
  llm.invalidateKeyCache();
  await auditKey(workspace.id, user.id, "openrouter", removing, value, true);

  // Without a shared key the platform default can't run on OpenRouter: put it back on today's default.
  let reset = "";
  if (removing) {
    const { env } = await import("@/lib/env");
    const { PLATFORM_DEFAULT_MODEL_KEY } = await import("@/lib/llm/models");
    const current = await getSetting(PLATFORM_DEFAULT_MODEL_KEY).catch(() => "");
    if (current.startsWith("openrouter:") && !env.OPENROUTER_API_KEY) {
      await setPlatformSetting(PLATFORM_DEFAULT_MODEL_KEY, "");
      await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "ai.platform_default_set", entityType: "setting", entityId: PLATFORM_DEFAULT_MODEL_KEY, meta: { from: current, to: null, why: "shared OpenRouter key removed" } });
      reset = " The platform default is back on today's default, since nothing could run it.";
    }
  }
  revalidatePath("/admin/api-keys");
  redirect(`/admin/api-keys?flash=${encodeURIComponent(removing ? `Removed the shared OpenRouter key. Workspaces without their own OpenRouter key can no longer use OpenRouter models.${reset}` : `Saved the shared OpenRouter key. ${checked}`)}${back}`);
}

/**
 * The platform's default model for a workspace with no model or writing key of its own
 * (2026-11-27): "" = today's default, or one of OpenRouter's models — which needs the shared
 * OpenRouter key first, and must be listed and able to give structured answers. Operator only.
 */
export async function savePlatformDefaultModelAction(formData: FormData) {
  const { workspace, user } = await requireRole("ADMIN");
  const back = "#platform-openrouter";
  if (!isPlatformOperator(user.email)) {
    redirect(`/admin/api-keys?err=${encodeURIComponent("The platform default is managed by the platform operator.")}${back}`);
  }
  const value = String(formData.get("model") ?? "").trim();
  const { getSetting, setPlatformSetting } = await import("@/lib/settings");
  const { env } = await import("@/lib/env");
  const { PLATFORM_DEFAULT_MODEL_KEY, getModel } = await import("@/lib/llm/models");
  const { isOpenRouterModel, openrouterSlug, canAnswerStructured } = await import("@/lib/llm/openrouter-catalog");
  const fail = (msg: string) => redirect(`/admin/api-keys?err=${encodeURIComponent(msg)}${back}`);
  if (value) {
    if (!isOpenRouterModel(value)) fail("The platform default is today's default or one of OpenRouter's models.");
    const shared = (await getSetting("api_key:openrouter").catch(() => "")) || env.OPENROUTER_API_KEY;
    if (!shared) fail("Paste the shared OpenRouter key first — without it, no workspace could run an OpenRouter default.");
    const { lookupOpenRouterModel } = await import("@/lib/llm/openrouter");
    const { known, model } = await lookupOpenRouterModel(openrouterSlug(value));
    if (!known) fail("OpenRouter's model list can't be read just now, so the model can't be checked. Try again in a minute.");
    if (!model) fail(`OpenRouter doesn't list “${openrouterSlug(value)}”.`);
    if (model && !canAnswerStructured(model)) fail(`${getModel(value)?.label ?? value} can't give the structured answers parts of Publisher need.`);
  }
  const before = await getSetting(PLATFORM_DEFAULT_MODEL_KEY).catch(() => "");
  if (before !== value) {
    await setPlatformSetting(PLATFORM_DEFAULT_MODEL_KEY, value);
    await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "ai.platform_default_set", entityType: "setting", entityId: PLATFORM_DEFAULT_MODEL_KEY, meta: { from: before || null, to: value || null } });
  }
  revalidatePath("/admin/api-keys");
  redirect(`/admin/api-keys?flash=${encodeURIComponent(value
    ? `Workspaces with no model or writing key of their own now write with ${getModel(value)?.label ?? value}, on the shared OpenRouter key.`
    : "The platform default is today's default again.")}${back}`);
}

/**
 * Audit SET-05: an empty field used to delete the key behind a "Saved" banner,
 * moving the workspace onto the platform's key (and bill) — easy to do while
 * rotating. Save now refuses an empty field; Remove key is its own button, and
 * its first press only asks (the page shows ?confirmRemove=) — the second,
 * "remove-confirmed", clears.
 */
function keyIntent(formData: FormData, id: string, value: string): "save" | "remove" {
  const intent = String(formData.get("intent") ?? "");
  if (intent === "remove") redirect(`/admin/api-keys?confirmRemove=${encodeURIComponent(id)}#key-${id}`);
  if (intent === "remove-confirmed") return "remove";
  if (!value) {
    redirect(`/admin/api-keys?err=${encodeURIComponent("The key field was empty, so nothing was saved. To take a key away, use Remove key next to it.")}#key-${id}`);
  }
  return "save";
}

/**
 * A removed key takes its shares with it (lib/key-shares.ts): a share points at
 * this workspace's own row, so once the row is gone it could only sit there
 * doing nothing — and come back to life, unasked, when a new key is saved.
 */
async function endShares(workspaceId: string, settingKey: string, actorId: string): Promise<number> {
  const { endSharesOfKey } = await import("@/lib/key-shares");
  return endSharesOfKey(workspaceId, settingKey, actorId).catch(() => 0);
}

function removedRedirect(id: string, sharesEnded = 0): string {
  const shared = sharesEnded > 0
    ? ` It was shared with ${sharesEnded} other workspace${sharesEnded === 1 ? "" : "s"}; ${sharesEnded === 1 ? "that share has" : "those shares have"} ended and ${sharesEnded === 1 ? "its" : "their"} admins were told.`
    : "";
  return `/admin/api-keys?flash=${encodeURIComponent(`Removed the ${id} key. Anything that used it falls back to the platform's key if there is one, or stops until a key is added.${shared}`)}#key-${id}`;
}
