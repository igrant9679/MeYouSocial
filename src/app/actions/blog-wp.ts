"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { encryptSecret, decryptSecret, type Encrypted } from "@/lib/blog-crypto";
import { wpTestConnection, wpCreatePost, type WpCredentials } from "@/lib/wordpress";
import { runBlogChecks, requiredChecksPass } from "@/lib/blog-checks";

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
  const post = await db.blogPost.findFirst({
    where: { id: postId, workspaceId: workspace.id },
  });
  if (!post || !post.body) return;
  if (post.status !== "final_approval" && post.status !== "published") return;

  // Re-verify the gates at the moment of publish (server is the authority).
  const unverified = await db.blogCitation.count({ where: { postId: post.id, verified: false } });
  if (!requiredChecksPass(runBlogChecks(post, unverified))) return;

  const creds = await credentialsFor(workspace.id);
  if (!creds) return;

  if (dryRun) {
    // Record the dry-run outcome on the connection status line (no post created).
    const test = await wpTestConnection(creds);
    await db.wordPressConnection.update({
      where: { workspaceId: workspace.id },
      data: { status: test.ok ? "connected" : "error" },
    });
    revalidatePath(`/blog/${post.id}`);
    return;
  }

  const created = await wpCreatePost(creds, {
    title: post.metaTitle ?? post.title,
    slug: post.slug,
    content: post.body,
    excerpt: post.metaDescription,
    status: "publish",
  });
  await db.blogPost.update({
    where: { id: post.id },
    data: { status: "published", publishedAt: new Date(), publishedUrl: created.link },
  });
  revalidatePath(`/blog/${post.id}`);
  revalidatePath("/blog");
}
