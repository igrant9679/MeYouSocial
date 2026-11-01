import { db } from "@/lib/db";
import { getSetting, setWorkspaceSetting } from "@/lib/settings";

/**
 * Website connection health (E-ART-16): the WordPress connection is tested on
 * save and then never again, so an expired application password or a security
 * plugin blocking the REST API was found by the next publish failing. Now a
 * probe (the same read-only /users/me the save does) runs with the analytics
 * sweep and on "Test now"; the result is kept with when it ran, a connection
 * that stops answering flips to "error" and its admins are told once, and the
 * Website page shows it beside the last publish report.
 */
export const PROBE_SETTING = "wordpress:last_probe";
/** `fails` = probes failed in a row; the connection reads "error" only from the second, so one network blip can't hold a publish. */
export type WpProbe = { at: string; ok: boolean; detail: string; fails: number };

export async function lastProbe(workspaceId: string): Promise<WpProbe | null> {
  try {
    const v = JSON.parse((await getSetting(PROBE_SETTING, workspaceId)) || "null") as WpProbe | null;
    return v?.at ? v : null;
  } catch {
    return null;
  }
}

export async function probeWordPress(workspaceId: string): Promise<WpProbe | null> {
  const conn = await db.wordPressConnection.findUnique({ where: { workspaceId } });
  if (!conn) return null;
  const [{ decryptSecret }, { wpTestConnection }] = await Promise.all([import("@/lib/blog-crypto"), import("@/lib/wordpress")]);
  let result: { ok: boolean; detail: string };
  try {
    result = await wpTestConnection({ baseUrl: conn.baseUrl, username: conn.username, appPassword: decryptSecret(JSON.parse(conn.encAppPassword)) });
  } catch (e) {
    result = { ok: false, detail: e instanceof Error ? e.message : "the stored password can't be read" };
  }
  const before = await lastProbe(workspaceId);
  const probe: WpProbe = { at: new Date().toISOString(), ok: result.ok, detail: result.detail.slice(0, 300), fails: result.ok ? 0 : (before?.fails ?? 0) + 1 };
  await setWorkspaceSetting(workspaceId, PROBE_SETTING, JSON.stringify(probe));
  const status = result.ok ? "connected" : probe.fails >= 2 ? "error" : conn.status;
  if (status !== conn.status) {
    await db.wordPressConnection.updateMany({ where: { id: conn.id }, data: { status } });
    if (!result.ok) {
      const { notify } = await import("@/lib/notify");
      await notify({
        workspaceId,
        kind: "account_broken",
        title: "Your website's WordPress connection stopped working",
        body: `${conn.baseUrl.replace(/^https?:\/\//, "")} answered: ${probe.detail}. Articles can't publish there until it's fixed — re-enter the application password on Website.`,
        path: "/website",
        entityType: "wordpress",
        entityId: conn.id,
        userIds: (await db.membership.findMany({ where: { workspaceId, role: "ADMIN", status: "active" }, select: { userId: true } })).map((m) => m.userId),
      });
    }
  }
  return probe;
}

/** The sweep's half: every live workspace with a WordPress connection. */
export async function probeAllWordPress(): Promise<{ probed: number; failing: number }> {
  const conns = await db.wordPressConnection.findMany({ where: { workspace: { deletedAt: null } }, select: { workspaceId: true } });
  let failing = 0;
  for (const c of conns) {
    try {
      const p = await probeWordPress(c.workspaceId);
      if (p && !p.ok) failing++;
    } catch (e) {
      console.warn(`[website] probe failed for ${c.workspaceId}:`, e instanceof Error ? e.message : e);
    }
  }
  return { probed: conns.length, failing };
}

export type PublishReportView = {
  postId: string; title: string; at: string | null; link: string | null;
  seoAccepted: number; seoSent: number; seoUnverified: boolean;
  featured: "applied" | "not applied" | "upload failed" | "none";
  featuredError: string | null;
  inline: { uploaded: number; failed: number } | null;
  missedTerms: string[];
};

/** The latest article's publish report, readable. */
export async function latestPublishReport(workspaceId: string): Promise<PublishReportView | null> {
  const post = await db.blogPost.findFirst({
    where: { workspaceId, publishReport: { not: null } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, publishReport: true, publishedUrl: true },
  });
  if (!post?.publishReport) return null;
  let r: Record<string, unknown>;
  try { r = JSON.parse(post.publishReport) as Record<string, unknown>; } catch { return null; }
  const seo = Array.isArray(r.seo) ? (r.seo as { accepted?: boolean }[]) : [];
  const fm = r.featuredMedia as { applied?: boolean | null } | null | undefined;
  const cats = r.categories as { missed?: string[] } | undefined;
  const tags = r.tags as { missed?: string[] } | undefined;
  return {
    postId: post.id,
    title: post.title,
    at: typeof r.at === "string" ? r.at : null,
    link: post.publishedUrl ?? (typeof r.draftLink === "string" ? r.draftLink : null),
    seoAccepted: seo.filter((o) => o.accepted).length,
    seoSent: seo.length,
    seoUnverified: r.seoUnverified === true,
    featured: r.featuredUploadFailed ? "upload failed" : fm ? (fm.applied === false ? "not applied" : "applied") : "none",
    featuredError: typeof r.featuredUploadError === "string" ? r.featuredUploadError : null,
    inline: (r.inlineImages as { uploaded: number; failed: number } | undefined) ?? null,
    missedTerms: [...(cats?.missed ?? []), ...(tags?.missed ?? [])].slice(0, 6),
  };
}
