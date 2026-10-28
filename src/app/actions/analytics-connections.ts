"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { setWorkspaceSetting } from "@/lib/settings";
import { getPublicUrl } from "@/lib/public-url";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";

/**
 * Settings → Analytics: connect Google Search Console, GA4 and YouTube.
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
/**
 * Link a page with traffic to an article published without a URL in the app
 * (E-MEA-10). Only a post with NO live URL, and only a full address — an
 * existing URL is never replaced from here.
 */
export async function linkUnmatchedPageAction(formData: FormData) {
  const { workspace, membership } = await requireRole("ADMIN");
  const url = String(formData.get("url") ?? "").trim();
  const postId = String(formData.get("postId") ?? "");
  if (!/^https?:\/\/[^\s]+$/i.test(url)) return back("That page has no full address to link — only Search Console pages can be linked.");
  if (!postId) return back("Choose the article that page is.");
  const post = await db.blogPost.findFirst({ where: { id: postId, workspaceId: workspace.id }, select: { id: true, title: true, status: true, publishedUrl: true } });
  if (!post) return back("That article isn't in this workspace.");
  if (post.publishedUrl) return back(`“${post.title}” already has a live URL (${post.publishedUrl}); it wasn't changed.`);
  if (post.status !== "published") return back(`“${post.title}” isn't published, so it can't have a live page yet.`);
  const taken = await db.blogPost.findFirst({ where: { workspaceId: workspace.id, publishedUrl: url }, select: { title: true } });
  if (taken) return back(`That address is already “${taken.title}”.`);
  await db.blogPost.update({ where: { id: post.id }, data: { publishedUrl: url } });
  await writeAudit({ workspaceId: workspace.id, actorId: membership.userId, action: "analytics.url_linked", entityType: "blog_post", entityId: post.id, meta: { url } });
  const { forgetUnmatched, urlKey } = await import("@/lib/analytics/sync");
  await forgetUnmatched(workspace.id, urlKey(url)).catch(() => undefined);
  revalidatePath("/admin/analytics");
  back(`Linked ${url} to “${post.title}”. The next sync (or Sync now) attaches its numbers.`, true);
}

export async function syncAnalyticsNowAction() {
  const { workspace } = await requireRole("ADMIN");
  const { syncWorkspaceAnalytics } = await import("@/lib/analytics/sync");
  let outcome: Awaited<ReturnType<typeof syncWorkspaceAnalytics>>;
  try {
    outcome = await syncWorkspaceAnalytics(workspace.id);
  } catch (e) {
    // Each source catches its own Google error now; this is the database or
    // the site index — say so on the tab instead of the error page (MEA-06).
    return back(`The sync couldn't run: ${e instanceof Error ? e.message : String(e)}`);
  }
  revalidatePath("/admin/analytics");
  revalidatePath("/insights");
  back(outcome.message, outcome.ok);
}

// ── Google OAuth (shared client; YouTube + Analytics consent flows) ──────────

export async function saveYoutubeOauthAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const clientId = String(formData.get("client_id") ?? "").trim();
  const clientSecret = String(formData.get("client_secret") ?? "").trim();
  await setWorkspaceSetting(workspace.id, "youtube_oauth:client_id", clientId);
  // Keep an existing secret when the field is left blank (it renders masked).
  if (clientSecret) await setWorkspaceSetting(workspace.id, "youtube_oauth:client_secret", clientSecret);
  revalidatePath("/admin/analytics");
  back("Google OAuth client saved — now hit a Connect button.", true);
}

/** Kick off the Search Console + GA4 consent flow (redirects to Google). */
export async function connectGoogleAnalyticsAction() {
  const { workspace } = await requireRole("ADMIN");
  const { buildAnalyticsAuthUrl } = await import("@/lib/google/analytics-oauth");
  const url = await buildAnalyticsAuthUrl(workspace.id, await getPublicUrl());
  if (!url) back("Save a Google OAuth client ID and secret first.");
  redirect(url!);
}

export async function disconnectGoogleAnalyticsAction() {
  const { workspace } = await requireRole("ADMIN");
  const { disconnectAnalyticsOauth } = await import("@/lib/google/analytics-oauth");
  await disconnectAnalyticsOauth(workspace.id);
  revalidatePath("/admin/analytics");
  back("Google account disconnected — analytics falls back to a service account if one is available.", true);
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
