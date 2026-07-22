"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { encryptSecret, decryptSecret, type Encrypted } from "@/lib/blog-crypto";
import { wpTestConnection, type WpCredentials } from "@/lib/wordpress";
import { publishCore } from "@/lib/blog-autopilot";

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
