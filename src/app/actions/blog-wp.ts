"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { encryptSecret, decryptSecret, type Encrypted } from "@/lib/blog-crypto";
import { wpTestConnection, type WpCredentials } from "@/lib/wordpress";
import { publishCore } from "@/lib/blog-autopilot";
import { writeAudit } from "@/lib/governance";
import { DEFAULT_SLUG_RULES, SEO_FIELDS, defaultFieldMap, isSeoPlugin } from "@/lib/seo-plugins";

/**
 * WordPress publishing (Spark FR-11 port). The application password is stored
 * AES-256-GCM encrypted and never echoed back to the client. Publishing is an
 * ADMIN act and re-verifies the publish gates server-side; dry-run reports what
 * would be sent without creating anything.
 */

async function credentialsFor(workspaceId: string): Promise<WpCredentials | null> {
  const conn = await db.wordPressConnection.findUnique({ where: { workspaceId } });
  if (!conn) return null;
  try {
    return {
      baseUrl: conn.baseUrl,
      username: conn.username,
      appPassword: decryptSecret(JSON.parse(conn.encAppPassword) as Encrypted),
    };
  } catch {
    return null;
  }
}

export async function connectWordPressAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const baseUrl = String(formData.get("baseUrl") ?? "").trim().replace(/\/+$/, "");
  const username = String(formData.get("username") ?? "").trim();
  const appPassword = String(formData.get("appPassword") ?? "").trim();
  if (!/^https:\/\//.test(baseUrl) || !username || !appPassword) return;

  const test = await wpTestConnection({ baseUrl, username, appPassword });
  await db.wordPressConnection.upsert({
    where: { workspaceId: workspace.id },
    update: {
      baseUrl,
      username,
      encAppPassword: JSON.stringify(encryptSecret(appPassword)),
      status: test.ok ? "connected" : "error",
    },
    create: {
      workspaceId: workspace.id,
      baseUrl,
      username,
      encAppPassword: JSON.stringify(encryptSecret(appPassword)),
      status: test.ok ? "connected" : "error",
    },
  });
  revalidatePath("/blog/settings");
}

/**
 * FR-7/FR-11 publish settings: which SEO plugin the site runs, the meta keys to
 * write, default taxonomy/author, the draft handoff switch, and the one
 * canonical slug rule.
 */
export async function savePublishSettingsAction(formData: FormData) {
  const { user, workspace } = await requireRole("ADMIN");
  const conn = await db.wordPressConnection.findUnique({ where: { workspaceId: workspace.id } });
  if (!conn) return;

  const plugin = String(formData.get("seoPlugin") ?? "none");
  const seoPlugin = isSeoPlugin(plugin) ? plugin : "none";

  // Only store keys that differ from the built-in map, so a plugin's defaults
  // keep improving without every workspace pinning an old copy.
  const builtIn = defaultFieldMap(seoPlugin);
  const overrides: Record<string, string> = {};
  for (const field of SEO_FIELDS) {
    const v = String(formData.get(`seo_${field}`) ?? "").trim();
    if (v && v !== builtIn[field]) overrides[field] = v.slice(0, 120);
  }

  const list = (name: string) =>
    JSON.stringify(
      String(formData.get(name) ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20),
    );

  const maxWords = parseInt(String(formData.get("slugMaxWords") ?? ""), 10);
  const slugRules = JSON.stringify({
    maxWords: Number.isFinite(maxWords) && maxWords >= 1 && maxWords <= 15 ? maxWords : DEFAULT_SLUG_RULES.maxWords,
    stripStopWords: formData.get("slugStripStopWords") === "on",
    prefix: String(formData.get("slugPrefix") ?? "").trim() || null,
  });

  await db.wordPressConnection.update({
    where: { workspaceId: workspace.id },
    data: {
      seoPlugin,
      seoFieldMap: JSON.stringify(overrides),
      defaultCategories: list("defaultCategories"),
      defaultTags: list("defaultTags"),
      defaultAuthor: String(formData.get("defaultAuthor") ?? "").trim() || null,
      publishAsDraft: formData.get("publishAsDraft") === "on",
      slugRules,
    },
  });
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "blog.publish_settings_saved",
    entityType: "wordpress_connection",
    meta: { seoPlugin, overrides: Object.keys(overrides) },
  });
  revalidatePath("/blog/settings");
}

export async function disconnectWordPressAction() {
  const { workspace } = await requireRole("ADMIN");
  await db.wordPressConnection.deleteMany({ where: { workspaceId: workspace.id } });
  revalidatePath("/blog/settings");
}

export async function publishToWordPressAction(formData: FormData) {
  const postId = String(formData.get("postId"));
  const dryRun = String(formData.get("dryRun")) === "1";
  const { workspace } = await requireRole("ADMIN");

  if (dryRun) {
    // Record the dry-run outcome on the connection status line (no post created).
    const creds = await credentialsFor(workspace.id);
    if (!creds) return;
    const test = await wpTestConnection(creds);
    await db.wordPressConnection.update({
      where: { workspaceId: workspace.id },
      data: { status: test.ok ? "connected" : "error" },
    });
    revalidatePath(`/blog/${postId}`);
    return;
  }

  // Status check, publish gates, credential decryption, WP call, and audit all
  // live in the shared core (also used by the autopilot scheduler).
  await publishCore(workspace.id, postId);
  revalidatePath(`/blog/${postId}`);
  revalidatePath("/blog");
}
