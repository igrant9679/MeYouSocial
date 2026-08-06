"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, isPlatformOperator } from "@/lib/acl";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getPublicUrl } from "@/lib/public-url";
import {
  hostedAuthLink,
  unipileConfigured,
  EMAIL_PROVIDERS,
} from "@/lib/unipile";

/**
 * Connect an EMAIL mailbox through Unipile's hosted-auth wizard.
 *
 * Unipile is email-only since 2026-07-26 — social moved to Zernio, which
 * supports the networks this product needs. Unipile stays because Zernio has no
 * email channel and Railway blocks outbound SMTP.
 */
export async function connectAccountAction() {
  const { workspace } = await requireRole("ADMIN");
  if (!(await unipileConfigured())) redirect("/admin/connections?err=unconfigured");

  const origin = await getPublicUrl();
  let url: string;
  try {
    url = await hostedAuthLink({
      providers: EMAIL_PROVIDERS,
      name: workspace.id,
      notifyUrl: `${origin}/api/unipile/webhook`,
      successUrl: `${origin}/admin/connections?connected=1`,
      failureUrl: `${origin}/admin/connections?failed=1`,
    });
  } catch (e) {
    redirect(`/admin/connections?err=${encodeURIComponent(e instanceof Error ? e.message : "link failed")}`);
  }
  redirect(url);
}

/**
 * Start Zernio's OAuth flow for one platform, scoped to this workspace's
 * profile. The profile is created on first use.
 */
export async function connectSocialAccountAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const platform = String(formData.get("platform") ?? "").toLowerCase();
  const { platformFor, zernioConfigured, zernioConnectLink } = await import("@/lib/zernio");
  if (!platformFor(platform)) redirect("/admin/connections?err=" + encodeURIComponent("Unknown platform."));
  if (!(await zernioConfigured(workspace.id))) {
    redirect("/admin/connections?err=" + encodeURIComponent("Zernio isn't configured yet — add the API key below."));
  }

  const origin = await getPublicUrl();
  let url: string;
  try {
    const { ensureZernioProfile } = await import("@/lib/zernio/accounts");
    const profileId = await ensureZernioProfile(workspace.id);
    url = await zernioConnectLink({
      platform,
      profileId,
      // Zernio sends the browser back here; the account itself arrives via the
      // signed `account.connected` webhook, which carries the profileId.
      redirectUrl: `${origin}/admin/connections?connected=1`,
      workspaceId: workspace.id,
    });
  } catch (e) {
    redirect(`/admin/connections?err=${encodeURIComponent(e instanceof Error ? e.message : "connect failed")}`);
  }
  redirect(url);
}

/** Re-read this workspace's accounts from Zernio — the reconcile path. */
export async function syncSocialAccountsAction() {
  const { workspace } = await requireRole("ADMIN");
  const { syncZernioAccounts } = await import("@/lib/zernio/accounts");
  try {
    const { found, removed, profileId, adopted } = await syncZernioAccounts(workspace.id);
    revalidatePath("/admin/connections");
    redirect(
      "/admin/connections?ok=" +
        encodeURIComponent(
          (found
            ? `${workspace.name}: mirrored ${found} account${found === 1 ? "" : "s"} from Zernio${removed ? `; ${removed} no longer connected` : ""}.`
            : `${workspace.name}: Zernio reports no accounts under this profile yet.`) +
            // Naming the workspace and the newly-bound profile is what makes a
            // wrong-workspace refresh obvious immediately.
            (adopted ? ` Bound to Zernio profile ${profileId} — accounts now belong to ${workspace.name}.` : ""),
        ),
    );
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e; // redirect() control flow
    redirect("/admin/connections?err=" + encodeURIComponent(e instanceof Error ? e.message : "sync failed"));
  }
}

/**
 * Mirror the Unipile team's mailboxes into this workspace — the email-side
 * equivalent of syncSocialAccountsAction.
 *
 * Names the workspace in the confirmation for the same reason the Zernio one
 * does: Unipile credentials are platform-level, so this decides which tenant
 * owns a mailbox, and the active workspace is a cookie that may not be the one
 * you think.
 */
export async function syncMailboxesAction() {
  const { workspace } = await requireRole("ADMIN");
  const { syncUnipileMailboxes } = await import("@/lib/unipile/accounts");
  try {
    const { found, adopted, skipped, addresses } = await syncUnipileMailboxes(workspace.id);
    revalidatePath("/admin/connections");
    const detail = addresses.length ? ` (${addresses.join(", ")})` : "";
    redirect(
      "/admin/connections?ok=" +
        encodeURIComponent(
          adopted
            ? `${workspace.name}: mirrored ${adopted} mailbox${adopted === 1 ? "" : "es"} from Unipile${detail}.` +
              (skipped ? ` ${skipped} already belong to another workspace and were left alone.` : "")
            : found
              ? `Unipile has ${found} mailbox${found === 1 ? "" : "es"}, but ${skipped ? "they already belong to another workspace" : "none could be adopted"}.`
              : "Unipile reports no mailboxes yet — connect one with the button below.",
        ),
    );
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e; // redirect() control flow
    redirect("/admin/connections?err=" + encodeURIComponent(e instanceof Error ? e.message : "mailbox sync failed"));
  }
}

export async function disconnectAccountAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  await db.unipileAccount.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/admin/connections");
  redirect("/admin/connections?ok=disconnected");
}

/**
 * Forget a social account locally.
 *
 * Marks it disconnected rather than deleting: SocialPostTarget rows reference
 * the account id, and history has to stay readable. Revoking the OAuth grant
 * itself happens in Zernio.
 */
export async function disconnectSocialAccountAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  await db.zernioAccount.updateMany({ where: { id, workspaceId: workspace.id }, data: { status: "disconnected" } });
  revalidatePath("/admin/connections");
  redirect("/admin/connections?ok=disconnected");
}

/** Make an email account the default sender for its provider. */
export async function setDefaultAccountAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const row = await db.unipileAccount.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!row) redirect("/admin/connections");
  await db.$transaction([
    db.unipileAccount.updateMany({
      where: { workspaceId: workspace.id, kind: row.kind, provider: row.provider },
      data: { isDefault: false },
    }),
    db.unipileAccount.update({ where: { id: row.id }, data: { isDefault: true } }),
  ]);
  revalidatePath("/admin/connections");
  redirect("/admin/connections?ok=default");
}

/** Make a social account the default poster for its platform. */
export async function setDefaultSocialAccountAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const row = await db.zernioAccount.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!row) redirect("/admin/connections");
  await db.$transaction([
    db.zernioAccount.updateMany({ where: { workspaceId: workspace.id, platform: row.platform }, data: { isDefault: false } }),
    db.zernioAccount.update({ where: { id: row.id }, data: { isDefault: true } }),
  ]);
  revalidatePath("/admin/connections");
  redirect("/admin/connections?ok=default");
}

// ── Zernio credentials (platform operator) ───────────────────────────────────

/**
 * Save the Zernio API key — but only after proving it works.
 *
 * Same house pattern as Drive storage / GSC / GA4, and the lesson from the old
 * Unipile card, which saved unvalidated so a typo surfaced much later as a
 * mystery failure somewhere else.
 */
export async function saveZernioConfigAction(formData: FormData) {
  await requirePlatformOperator();
  const { setPlatformSetting } = await import("@/lib/settings");
  const { probeZernioCredentials } = await import("@/lib/zernio");

  const apiKey = String(formData.get("apiKey") ?? "").trim();
  const force = String(formData.get("force") ?? "") === "on";
  if (!apiKey) redirect("/admin/connections?err=" + encodeURIComponent("Paste your Zernio API key."));

  const probe = await probeZernioCredentials(apiKey);
  if (!probe.ok && !force) {
    redirect("/admin/connections?err=" + encodeURIComponent(`Not saved — ${probe.message}`));
  }
  await setPlatformSetting("zernio:api_key", apiKey);

  const secret = String(formData.get("webhookSecret") ?? "").trim();
  if (secret) await setPlatformSetting("zernio:webhook_secret", secret);

  revalidatePath("/admin/connections");
  revalidatePath("/social");
  redirect(
    "/admin/connections?ok=" +
      encodeURIComponent(probe.ok ? probe.message : `Saved without verifying — ${probe.message}`),
  );
}

/**
 * Save THIS WORKSPACE's own Zernio key (workspace tier beats the platform key
 * on read). Needed since 2026-08-06: Zernio serves exactly one user's accounts
 * per key, so two tenants whose accounts were connected by different Zernio
 * users cannot share one key — whichever connected last worked and the other
 * 403'd. Workspace ADMIN may save it (keys per tenant, the house rule).
 */
export async function saveWorkspaceZernioKeyAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const { setWorkspaceSetting } = await import("@/lib/settings");
  const { probeZernioCredentials } = await import("@/lib/zernio");

  const apiKey = String(formData.get("apiKey") ?? "").trim();
  const force = String(formData.get("force") ?? "") === "on";
  if (!apiKey) redirect("/admin/connections?err=" + encodeURIComponent("Paste the Zernio API key for this workspace."));

  const probe = await probeZernioCredentials(apiKey);
  if (!probe.ok && !force) {
    redirect("/admin/connections?err=" + encodeURIComponent(`Not saved — ${probe.message}`));
  }
  await setWorkspaceSetting(workspace.id, "zernio:api_key", apiKey);
  revalidatePath("/admin/connections");
  revalidatePath("/social");
  redirect(
    "/admin/connections?ok=" +
      encodeURIComponent(
        `${workspace.name} now uses its own Zernio key. ` + (probe.ok ? probe.message : `Saved without verifying — ${probe.message}`),
      ),
  );
}

export async function clearWorkspaceZernioKeyAction() {
  const { workspace } = await requireRole("ADMIN");
  const { setWorkspaceSetting } = await import("@/lib/settings");
  await setWorkspaceSetting(workspace.id, "zernio:api_key", "");
  revalidatePath("/admin/connections");
  redirect("/admin/connections?ok=" + encodeURIComponent(`${workspace.name} falls back to the platform Zernio key.`));
}

/** Re-probe the stored key and report exactly what Zernio says. */
export async function testZernioConfigAction() {
  await requirePlatformOperator();
  const { getSetting } = await import("@/lib/settings");
  const { probeZernioCredentials } = await import("@/lib/zernio");
  const key = (await getSetting("zernio:api_key")) || process.env.ZERNIO_API_KEY || "";
  if (!key) redirect("/admin/connections?err=" + encodeURIComponent("No Zernio API key is stored yet."));
  const probe = await probeZernioCredentials(key);
  redirect(`/admin/connections?${probe.ok ? "ok" : "err"}=` + encodeURIComponent(probe.message));
}

export async function clearZernioConfigAction() {
  await requirePlatformOperator();
  const { setPlatformSetting } = await import("@/lib/settings");
  await setPlatformSetting("zernio:api_key", "");
  await setPlatformSetting("zernio:webhook_secret", "");
  revalidatePath("/admin/connections");
  redirect("/admin/connections?ok=" + encodeURIComponent("Zernio credentials cleared."));
}

/**
 * Platform-operator only: save the Unipile DSN + API key (one account serves
 * every tenant). Gated to BOOTSTRAP_ADMIN_EMAIL like storage.
 */
/** Only the platform operator may touch the shared Unipile credentials. */
async function requirePlatformOperator() {
  const ctx = await requireRole("ADMIN");
  if (!isPlatformOperator(ctx.user.email)) {
    redirect("/admin/connections?err=" + encodeURIComponent("These credentials are managed by the platform operator."));
  }
  return ctx;
}

/**
 * Save the Unipile DSN + API key — but only after proving they work.
 *
 * Both fields are taken together in one form, because neither is testable
 * alone: a DSN with no key can't be called, and a key with no DSN has nowhere
 * to go. The previous two-form version saved each unvalidated and always said
 * "Saved", so a typo surfaced much later as a mystery failure somewhere else.
 *
 * Nothing is persisted unless the probe succeeds, EXCEPT via the explicit
 * `force` escape hatch — kept because a probe can fail for reasons that aren't
 * the credentials (Unipile down, egress hiccup), and refusing to let an
 * operator store a key they know is right would be its own trap.
 */
export async function saveUnipileConfigAction(formData: FormData) {
  await requirePlatformOperator();
  const { setPlatformSetting, getSetting } = await import("@/lib/settings");
  const { probeUnipileCredentials } = await import("@/lib/unipile");

  const dsn = String(formData.get("dsn") ?? "").trim();
  const rawKey = String(formData.get("apiKey") ?? "").trim();
  const force = String(formData.get("force") ?? "") === "on";

  if (!dsn && !rawKey) {
    redirect("/admin/connections?err=" + encodeURIComponent("Enter the DSN and API key from dashboard.unipile.com."));
  }
  // A blank key field means "keep the stored one" — so the DSN can be corrected
  // without re-pasting a secret the operator may no longer have to hand.
  const apiKey = rawKey || (await getSetting("unipile:api_key"));
  if (!apiKey) {
    redirect("/admin/connections?err=" + encodeURIComponent("An API key is required the first time."));
  }

  const probe = await probeUnipileCredentials(dsn, apiKey);
  if (!probe.ok && !force) {
    redirect("/admin/connections?err=" + encodeURIComponent(`Not saved — ${probe.message}`));
  }

  await setPlatformSetting("unipile:dsn", dsn);
  if (rawKey) await setPlatformSetting("unipile:api_key", rawKey);

  revalidatePath("/admin/connections");
  revalidatePath("/social");
  redirect(
    "/admin/connections?ok=" +
      encodeURIComponent(probe.ok ? probe.message : `Saved without verifying — ${probe.message}`),
  );
}

/** Clear the stored credentials. Connected accounts are left alone. */
export async function clearUnipileConfigAction() {
  await requirePlatformOperator();
  const { setPlatformSetting } = await import("@/lib/settings");
  await setPlatformSetting("unipile:dsn", "");
  await setPlatformSetting("unipile:api_key", "");
  revalidatePath("/admin/connections");
  redirect("/admin/connections?ok=" + encodeURIComponent("Unipile credentials cleared."));
}

/** Re-probe what's already stored, and report exactly what Unipile says. */
export async function testUnipileConfigAction() {
  await requirePlatformOperator();
  const { getSetting } = await import("@/lib/settings");
  const { probeUnipileCredentials } = await import("@/lib/unipile");
  // Same precedence the client itself uses: stored Setting, then env fallback.
  const dsn = (await getSetting("unipile:dsn")) || process.env.UNIPILE_DSN || "";
  const apiKey = (await getSetting("unipile:api_key")) || process.env.UNIPILE_API_KEY || "";
  if (!dsn || !apiKey) {
    redirect("/admin/connections?err=" + encodeURIComponent("Nothing to test — no DSN or API key is stored yet."));
  }
  const probe = await probeUnipileCredentials(dsn, apiKey);
  redirect(`/admin/connections?${probe.ok ? "ok" : "err"}=` + encodeURIComponent(probe.message));
}
