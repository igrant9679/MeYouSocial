"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { encryptSecret, decryptSecret, type Encrypted } from "@/lib/blog-crypto";
import { wpTestConnection, type WpCredentials } from "@/lib/wordpress";
import { publishCore } from "@/lib/blog-autopilot";
import { blockingChecks } from "@/lib/blog-gates";
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
  revalidatePath("/website");
}

/**
 * FR-7/FR-11 publish settings: which SEO plugin the site runs, the meta keys to
 * write, default taxonomy/author, the draft handoff switch, and the one
 * canonical slug rule.
 */
/** Website → Health → Test now (E-ART-16): the same read-only probe the sweep runs. */
export async function testWordPressAction() {
  const { workspace } = await requireRole("ADMIN");
  const { probeWordPress } = await import("@/lib/wp-health");
  const p = await probeWordPress(workspace.id);
  revalidatePath("/website");
  const msg = !p ? "No WordPress connection to test." : p.ok ? `Connected — ${p.detail}.` : `WordPress didn't answer: ${p.detail}`;
  redirect(`/website?${p?.ok ? "flash" : "flashErr"}=${encodeURIComponent(msg)}#health`);
}

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

  // A theme-relative file path, nothing else — a stray URL or shell-ish string
  // here would ride into every future publish payload.
  const templateRaw = String(formData.get("template") ?? "").trim();
  const template = /^[A-Za-z0-9._/-]{0,100}$/.test(templateRaw) ? templateRaw : "";

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
      template,
    },
  });
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "blog.publish_settings_saved",
    entityType: "wordpress_connection",
    meta: { seoPlugin, overrides: Object.keys(overrides) },
  });
  revalidatePath("/website");
}

export async function disconnectWordPressAction() {
  const { workspace } = await requireRole("ADMIN");
  await db.wordPressConnection.deleteMany({ where: { workspaceId: workspace.id } });
  revalidatePath("/website");
}

/**
 * Re-push the SEO metadata to an ALREADY-PUBLISHED post — for when the SEO
 * plugin choice (or the meta itself) changed after the article went out.
 * Runs on the SERVER, which matters: site firewalls that block desktop/probe
 * IPs have already accepted publishes from this host. Reads the post back and
 * reports how many fields the site actually stored — WP silently drops keys
 * no plugin registered, so the read-back is the only honest verdict.
 */
export async function pushSeoMetaAction(formData: FormData) {
  const postId = String(formData.get("postId"));
  const { user, workspace } = await requireRole("ADMIN");
  const back = (msg: string, ok = false): never =>
    redirect(`/blog/${postId}?tab=distribute&${ok ? "flash" : "flashErr"}=${encodeURIComponent(msg.slice(0, 300))}`);

  const post = await db.blogPost.findFirst({ where: { id: postId, workspaceId: workspace.id } });
  if (!post) return;
  if (!post.wpPostId) back("This post isn't on WordPress yet — publish it first.");
  const conn = await db.wordPressConnection.findUnique({ where: { workspaceId: workspace.id } });
  const creds = conn && (await credentialsFor(workspace.id));
  if (!conn || !creds) back("No WordPress connection — set one up on Distribute → Website.");

  const { effectiveFieldMap, buildSeoMeta, verifySeoMeta, isSeoPlugin: isPlugin } = await import("@/lib/seo-plugins");
  const plugin = isPlugin(conn!.seoPlugin) ? conn!.seoPlugin : "none";
  if (plugin === "none") back("Pick your site's SEO plugin on Distribute → Website first — with None selected there is nowhere to put the metadata.");

  const fieldMap = effectiveFieldMap(plugin, conn!.seoFieldMap);
  const seoValues = {
    title: post!.metaTitle ?? post!.title,
    description: post!.metaDescription ?? undefined,
    focusKeyword: post!.focusKeyword ?? undefined,
    canonical: post!.canonicalUrl ?? undefined,
    ogTitle: post!.ogTitle ?? post!.metaTitle ?? post!.title,
    ogDescription: post!.ogDescription ?? post!.metaDescription ?? undefined,
    // Only a PUBLIC og image: the one the last publish put in the media library
    // (publishReport.ogImageUrl, ART-06). Our stored urls are session-gated; with
    // none, Yoast falls back to the featured image, which IS in the library.
    ogImage: (() => {
      try {
        const u = (JSON.parse(post!.publishReport ?? "{}") as { ogImageUrl?: unknown }).ogImageUrl;
        return typeof u === "string" && /^https?:\/\//.test(u) ? u : undefined;
      } catch {
        return undefined;
      }
    })(),
  };
  const meta = buildSeoMeta(fieldMap, seoValues);
  if (!Object.keys(meta).length) back("Nothing to push — the post has no SEO metadata yet.");

  const { wpUpdatePostMeta, wpReadPost } = await import("@/lib/wordpress");
  const sent = await wpUpdatePostMeta(creds!, post!.wpPostId!, meta);
  if (!sent.ok) {
    // `rest_invalid_param` on meta keys = no plugin registered them = the
    // plugin isn't installed (or is outdated) on the site. Say that.
    const looksUnregistered = /rest_invalid_param|not one of/i.test(sent.detail ?? "");
    back(
      looksUnregistered
        ? `The site refused the ${plugin} meta fields — that usually means ${plugin} isn't installed (or is outdated) on the site. Site said: ${sent.detail}`
        : `The site rejected the meta update. Site said: ${sent.detail ?? "no detail"}`,
    );
  }

  const readBack = await wpReadPost(creds!, post!.wpPostId!);
  const outcomes = verifySeoMeta(fieldMap, seoValues, readBack?.meta ?? null);
  const landed = outcomes.filter((o) => o.accepted).length;
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "blog.seo_meta_pushed",
    entityType: "blog_post",
    entityId: post!.id,
    meta: { plugin, sent: outcomes.length, landed, dropped: outcomes.filter((o) => !o.accepted).map((o) => o.field) },
  });
  if (landed === outcomes.length) {
    back(`SEO meta pushed — the site stored all ${landed} field(s).`, true);
  }
  back(
    landed === 0
      ? `The site stored NONE of the ${outcomes.length} fields — is ${plugin} actually installed and up to date on the site?`
      : `Partial: ${landed} of ${outcomes.length} fields stored. Dropped: ${outcomes.filter((o) => !o.accepted).map((o) => o.field).join(", ")}.`,
  );
}

/**
 * Read the live article page again and check its social tags (E-ART-05) —
 * after fixing the SEO plugin, clearing a page cache, or just to see. Only
 * reads the page; nothing on the site changes.
 */
export async function checkLiveSocialTagsAction(formData: FormData) {
  const postId = String(formData.get("postId"));
  const { workspace } = await requireRole("EDITOR");
  const back = (msg: string, ok = false): never =>
    redirect(`/blog/${postId}?tab=distribute&${ok ? "flash" : "flashErr"}=${encodeURIComponent(msg.slice(0, 300))}`);
  const post = await db.blogPost.findFirst({ where: { id: postId, workspaceId: workspace.id }, select: { id: true, publishedUrl: true, publishReport: true } });
  if (!post) redirect("/blog");
  if (!post.publishedUrl) back("This article isn't live yet — there's no page to read.");
  const conn = await db.wordPressConnection.findUnique({ where: { workspaceId: workspace.id }, select: { baseUrl: true } });
  if (!conn) back("No WordPress connection — set one up on Distribute → Website.");
  let report: Record<string, unknown> = {};
  try {
    report = JSON.parse(post.publishReport ?? "{}") as Record<string, unknown>;
  } catch {
    report = {};
  }
  const { checkLiveHead } = await import("@/lib/live-head");
  const ogImageUrl = typeof report.ogImageUrl === "string" ? report.ogImageUrl : null;
  const live = await checkLiveHead(post.publishedUrl!, conn!.baseUrl, ogImageUrl);
  await db.blogPost.update({ where: { id: post.id }, data: { publishReport: JSON.stringify({ ...report, liveHead: live }) } });
  revalidatePath(`/blog/${post.id}`);
  revalidatePath("/website");
  if (live.error) back(`Couldn't check the live page: ${live.error}`);
  const off = (live.checks ?? []).filter((c) => c.state !== "ok");
  back(off.length ? `Checked the live page: ${off.map((c) => c.tag).join(", ")} ${off.length === 1 ? "needs" : "need"} a look.` : "Checked the live page: og:image, og:url and twitter:card are right.", off.length === 0);
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

/**
 * E-ART-02: push a live article's edits to its WordPress post — ADMIN, like
 * publishing. Compared first (what would change, against what the site says
 * now); refused when nothing changed or the publish gates hold it; the same
 * send as a refresh, without a trip back through review. The audit row
 * carries what changed.
 */
export async function updateOnWordPressAction(formData: FormData) {
  const postId = String(formData.get("postId") ?? "");
  const { workspace, user } = await requireRole("ADMIN");
  const back = (msg: string, ok: boolean): never => redirect(`/blog/${encodeURIComponent(postId)}/update?${ok ? "flash" : "flashErr"}=${encodeURIComponent(msg)}`);
  const { compareWithLive } = await import("@/lib/wp-update");
  const cmp = await compareWithLive(workspace.id, postId);
  if (!cmp.ok) back(cmp.error, false);
  if (cmp.ok && cmp.unchanged) back("Nothing to update — the site already says exactly this.", false);
  const blocking = await blockingChecks(workspace.id, postId);
  if (blocking?.length) back(`Held by the publish checks: ${blocking.join("; ")}.`, false);
  const ok = await publishCore(workspace.id, postId, { update: true });
  if (!ok) back("WordPress didn't take the update — see the last publish report on the article's Optimize tab.", false);
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "blog.update_pushed",
    entityType: "blog_post",
    entityId: postId,
    meta: cmp.ok ? { added: cmp.stats.added, removed: cmp.stats.removed, blocks: cmp.stats.blocks, title: cmp.title.changed, description: cmp.excerpt.changed, images: cmp.imagesChanged } : {},
  });
  revalidatePath(`/blog/${postId}`);
  redirect(`/blog/${encodeURIComponent(postId)}?flash=${encodeURIComponent("Updated on WordPress — the live post now has these edits, at the same address.")}`);
}
