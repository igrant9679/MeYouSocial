"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { setWorkspaceSetting } from "@/lib/settings";
import { getPublicUrl } from "@/lib/public-url";

/**
 * Admin → Analytics: connect Google Search Console, GA4 and YouTube.
 *
 * Per-workspace by design — each company has its own site, property and
 * channel. Saving runs a LIVE probe (same pattern as the Drive storage card)
 * so a misconfiguration is caught here rather than surfacing later as silently
 * empty data.
 */

const back = (msg: string, ok = false) =>
  redirect(`/admin/analytics?${ok ? "ok" : "err"}=${encodeURIComponent(msg.slice(0, 300))}`);

// ── Search Console ───────────────────────────────────────────────────────────

export async function saveGscAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const serviceAccount = String(formData.get("service_account") ?? "").trim();
  const siteUrl = String(formData.get("site_url") ?? "").trim();

  if (serviceAccount) {
    const { parseServiceAccount } = await import("@/lib/google/service-account");
    if (!parseServiceAccount(serviceAccount)) {
      back("That doesn't look like a service-account JSON key (needs client_email and private_key).");
    }
    await setWorkspaceSetting(workspace.id, "gsc:service_account", serviceAccount);
  }
  await setWorkspaceSetting(workspace.id, "gsc:site_url", siteUrl);

  const { invalidateGoogleTokenCache } = await import("@/lib/google/service-account");
  invalidateGoogleTokenCache();

  if (!siteUrl) back("Search Console site cleared.", true);
  const { gscVerify } = await import("@/lib/analytics/gsc");
  const result = await gscVerify(workspace.id);
  revalidatePath("/admin/analytics");
  back(result.message, result.ok);
}

export async function clearGscAction() {
  const { workspace } = await requireRole("ADMIN");
  await setWorkspaceSetting(workspace.id, "gsc:service_account", "");
  await setWorkspaceSetting(workspace.id, "gsc:site_url", "");
  revalidatePath("/admin/analytics");
  back("Search Console disconnected.", true);
}

// ── GA4 ──────────────────────────────────────────────────────────────────────

export async function saveGa4Action(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const serviceAccount = String(formData.get("service_account") ?? "").trim();
  const propertyRaw = String(formData.get("property_id") ?? "").trim();

  if (serviceAccount) {
    const { parseServiceAccount } = await import("@/lib/google/service-account");
    if (!parseServiceAccount(serviceAccount)) {
      back("That doesn't look like a service-account JSON key (needs client_email and private_key).");
    }
    await setWorkspaceSetting(workspace.id, "ga4:service_account", serviceAccount);
  }

  const { normalizePropertyId, ga4Verify } = await import("@/lib/analytics/ga4");
  const propertyId = normalizePropertyId(propertyRaw);
  if (propertyRaw && !propertyId) {
    back("A GA4 property ID is the numeric id (e.g. 123456789) — not the measurement ID (G-XXXX).");
  }
  await setWorkspaceSetting(workspace.id, "ga4:property_id", propertyId);

  const { invalidateGoogleTokenCache } = await import("@/lib/google/service-account");
  invalidateGoogleTokenCache();

  if (!propertyId) back("GA4 property cleared.", true);
  const result = await ga4Verify(workspace.id);
  revalidatePath("/admin/analytics");
  back(result.message, result.ok);
}

export async function clearGa4Action() {
  const { workspace } = await requireRole("ADMIN");
  await setWorkspaceSetting(workspace.id, "ga4:service_account", "");
  await setWorkspaceSetting(workspace.id, "ga4:property_id", "");
  revalidatePath("/admin/analytics");
  back("GA4 disconnected.", true);
}

/**
 * Pull Search Console / GA4 data into BlogSnapshot now, instead of waiting for
 * the scheduled sweep. Reports honestly when a connector is live but nothing
 * matched — "connected" and "producing data" are different states.
 */
export async function syncAnalyticsNowAction() {
  const { workspace } = await requireRole("ADMIN");
  const { syncWorkspaceAnalytics } = await import("@/lib/analytics/sync");
  const outcome = await syncWorkspaceAnalytics(workspace.id);
  revalidatePath("/admin/analytics");
  revalidatePath("/insights");
  back(outcome.message, outcome.ok);
}

// ── YouTube OAuth ────────────────────────────────────────────────────────────

export async function saveYoutubeOauthAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const clientId = String(formData.get("client_id") ?? "").trim();
  const clientSecret = String(formData.get("client_secret") ?? "").trim();
  await setWorkspaceSetting(workspace.id, "youtube_oauth:client_id", clientId);
  // Keep an existing secret when the field is left blank (it renders masked).
  if (clientSecret) await setWorkspaceSetting(workspace.id, "youtube_oauth:client_secret", clientSecret);
  revalidatePath("/admin/analytics");
  back("YouTube OAuth client saved — now hit Connect.", true);
}

/** Kick off the consent flow (redirects to Google). */
export async function connectYoutubeAction() {
  const { workspace } = await requireRole("ADMIN");
  const { buildYoutubeAuthUrl } = await import("@/lib/youtube/oauth");
  const url = await buildYoutubeAuthUrl(workspace.id, await getPublicUrl());
  if (!url) back("Save an OAuth client ID and secret first.");
  redirect(url!);
}

export async function disconnectYoutubeAction() {
  const { workspace } = await requireRole("ADMIN");
  const { disconnectYoutubeOauth } = await import("@/lib/youtube/oauth");
  await disconnectYoutubeOauth(workspace.id);
  revalidatePath("/admin/analytics");
  back("YouTube disconnected.", true);
}
