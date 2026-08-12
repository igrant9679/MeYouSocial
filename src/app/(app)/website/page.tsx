import Link from "next/link";
import { Globe, Download, Plug } from "lucide-react";
import { requireMembership, canAdmin, canEdit } from "@/lib/acl";
import { db } from "@/lib/db";
import { SubmitButton } from "@/components/SubmitButton";
import { connectWordPressAction, disconnectWordPressAction, savePublishSettingsAction } from "@/app/actions/blog-wp";
import {
  SEO_FIELDS,
  SEO_FIELD_LABELS,
  SEO_PLUGINS,
  SEO_PLUGIN_LABELS,
  effectiveFieldMap,
  isSeoPlugin,
  parseSlugRules,
} from "@/lib/seo-plugins";
import { addSitePageAction, deleteSitePageAction, importPublishedAsPagesAction } from "@/app/actions/blog-optimize";

/**
 * Website — the Distribute-side home of "publish articles to my site".
 *
 * Moved here from /blog/settings 2026-08-12: a publishing destination is a
 * Distribute concern, and buried under Blog nobody could find it (the user
 * asked "shouldn't there be a Website page under Distribute?" — yes). The old
 * URL redirects here. Two destinations, honestly separated:
 *
 *   - WORDPRESS: connected directly; articles publish (autonomously, if the
 *     publishing mode dial says so) with SEO metadata, taxonomy, featured
 *     image and — new — the theme's own post template.
 *   - ANY OTHER SITE: per-article standalone HTML export. No connection to
 *     configure; the export carries the article, its metadata and structured
 *     data, with images embedded so the file renders anywhere.
 */

function parseList(json: string): string[] {
  try {
    const raw = JSON.parse(json);
    return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export default async function WebsitePage() {
  const { workspace, membership } = await requireMembership();
  const [conn, pages, exportable] = await Promise.all([
    db.wordPressConnection.findUnique({ where: { workspaceId: workspace.id } }),
    db.sitePage.findMany({ where: { workspaceId: workspace.id }, orderBy: { title: "asc" }, take: 100 }),
    db.blogPost.findMany({
      where: { workspaceId: workspace.id, status: { in: ["final_approval", "published"] } },
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: { id: true, title: true, status: true, slug: true, publishedUrl: true },
    }),
  ]);
  const admin = canAdmin(membership.role);
  const plugin = conn && isSeoPlugin(conn.seoPlugin) ? conn.seoPlugin : "none";
  const activeMap = effectiveFieldMap(plugin, conn?.seoFieldMap);
  const slugRules = parseSlugRules(conn?.slugRules);

  return (
    <main className="p-6 w-full">
      <div className="flex items-center gap-3 mb-5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--blue-soft)", color: "var(--blue-on)" }}>
          <Globe className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-2xl leading-tight">Website</h1>
          <p className="text-xs text-[var(--mute)]">
            Your site as a publishing destination — WordPress connected directly, or any other site via HTML export.
            How much publishes unattended is the publishing dial on{" "}
            <Link href="/blog/automation" className="underline">Blog → Automation</Link>.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <Plug className="w-4 h-4" style={{ color: "var(--indigo-on)" }} />
          <h2 className="text-sm font-semibold flex-1">WordPress</h2>
          {conn ? (
            <span
              className="font-mono text-xs px-2 py-0.5 rounded-full"
              style={
                conn.status === "connected"
                  ? { background: "var(--green-soft)", color: "var(--green-on)" }
                  : { background: "var(--rose-soft)", color: "var(--rose-on)" }
              }
            >
              {conn.status} · {conn.baseUrl.replace(/^https?:\/\//, "")}
            </span>
          ) : (
            <span className="font-mono text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--panel)", color: "var(--mute)" }}>
              not connected
            </span>
          )}
        </div>

        {!admin ? (
          <p className="text-xs text-[var(--mute)]">An admin can connect a WordPress site here.</p>
        ) : (
          <>
            <form action={connectWordPressAction} className="flex flex-col gap-3">
              <label className="text-sm">
                <span className="block text-xs text-[var(--mute)] mb-1">Site URL (https)</span>
                <input name="baseUrl" type="url" required placeholder="https://example.com" defaultValue={conn?.baseUrl ?? ""} className="w-full font-mono text-xs" />
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="text-sm">
                  <span className="block text-xs text-[var(--mute)] mb-1">WP username</span>
                  <input name="username" required defaultValue={conn?.username ?? ""} className="w-full" />
                </label>
                <label className="text-sm">
                  <span className="block text-xs text-[var(--mute)] mb-1">
                    Application password {conn ? "(re-enter to update)" : ""}
                  </span>
                  <input name="appPassword" type="password" required placeholder="xxxx xxxx xxxx xxxx" className="w-full font-mono text-xs" autoComplete="off" />
                </label>
              </div>
              <p className="text-xs text-[var(--mute)]">
                Create one in WordPress under Users → Profile → Application Passwords. Stored encrypted; the connection is tested on save.
              </p>
              <div className="flex items-center gap-2">
                <SubmitButton className="btn primary" pendingText="Testing…">Save &amp; test</SubmitButton>
              </div>
            </form>
            {conn && (
              <form action={disconnectWordPressAction} className="mt-3">
                <button className="btn">Disconnect</button>
              </form>
            )}
          </>
        )}
      </div>

      {/* Publish fidelity (FR-7/FR-11): SEO plugin mapping, taxonomy, slug rule. */}
      {conn && (
        <form action={savePublishSettingsAction} className="card mt-5 flex flex-col gap-4">
          <div>
            <h2 className="text-sm font-semibold">Publishing</h2>
            <p className="text-xs text-[var(--mute)]">
              How posts land on the connected site: which SEO plugin gets the metadata, default taxonomy and author,
              the theme template, and the one canonical slug rule.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="block text-xs text-[var(--mute)] mb-1">SEO plugin</span>
              <select name="seoPlugin" defaultValue={conn.seoPlugin} className="w-full text-xs" disabled={!admin}>
                {SEO_PLUGINS.map((p) => (
                  <option key={p} value={p}>{SEO_PLUGIN_LABELS[p]}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-xs text-[var(--mute)] mb-1">Default author (WP username or id)</span>
              <input name="defaultAuthor" defaultValue={conn.defaultAuthor ?? ""} placeholder="blank = the connected user" className="w-full text-xs" disabled={!admin} />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-[var(--mute)] mb-1">Default categories (comma-separated)</span>
              <input name="defaultCategories" defaultValue={parseList(conn.defaultCategories).join(", ")} className="w-full text-xs" disabled={!admin} />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-[var(--mute)] mb-1">Default tags (comma-separated)</span>
              <input name="defaultTags" defaultValue={parseList(conn.defaultTags).join(", ")} className="w-full text-xs" disabled={!admin} />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="block text-xs text-[var(--mute)] mb-1">
                Post template (theme file — e.g. <span className="font-mono">template-fullwidth.php</span>)
              </span>
              <input
                name="template"
                defaultValue={conn.template ?? ""}
                placeholder="blank = the theme's default single-post template"
                className="w-full font-mono text-xs"
                disabled={!admin}
              />
              <span className="block text-[11px] text-[var(--mute)] mt-1">
                Applies your theme&apos;s own post template to every article this app publishes. Find the file name in
                the WordPress editor&apos;s Template dropdown, or in the theme&apos;s folder. ⚠ WordPress silently falls
                back to the default template if the file doesn&apos;t exist in the active theme — check the first
                published article rather than trusting this field.
              </span>
            </label>
          </div>
          <p className="text-xs text-[var(--mute)]">
            Categories and tags are matched by name and created if they don&apos;t exist. A post&apos;s own terms
            override these defaults.
          </p>

          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" name="publishAsDraft" defaultChecked={conn.publishAsDraft} disabled={!admin} className="mt-0.5" />
            <span>
              <b>Hand off as a WordPress draft</b> instead of publishing live. The post stays at final approval here
              until someone publishes it on the site.
            </span>
          </label>

          <div>
            <h3 className="text-xs font-semibold mb-1">SEO meta keys</h3>
            <p className="text-xs text-[var(--mute)] mb-2">
              WordPress only stores <span className="font-mono">meta</span> for keys registered with{" "}
              <span className="font-mono">show_in_rest</span>. Yoast and Rank Math register theirs; Squirrly keeps its
              data in its own tables, so its keys must be filled in per install. Every publish reads the post back and
              reports which fields actually landed — trust that report, not this form.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {SEO_FIELDS.map((f) => (
                <label key={f} className="text-sm">
                  <span className="block text-[11px] text-[var(--mute)] mb-1">{SEO_FIELD_LABELS[f]}</span>
                  <input
                    name={`seo_${f}`}
                    defaultValue={activeMap[f] ?? ""}
                    placeholder="not mapped"
                    className="w-full font-mono text-xs"
                    disabled={!admin}
                  />
                </label>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold mb-1">Slug convention</h3>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="block text-[11px] text-[var(--mute)] mb-1">Max words</span>
                <input name="slugMaxWords" type="number" min={1} max={15} defaultValue={slugRules.maxWords} className="w-20 font-mono text-xs" disabled={!admin} />
              </label>
              <label className="text-sm">
                <span className="block text-[11px] text-[var(--mute)] mb-1">Prefix</span>
                <input name="slugPrefix" defaultValue={slugRules.prefix ?? ""} placeholder="none" className="w-32 font-mono text-xs" disabled={!admin} />
              </label>
              <label className="flex items-center gap-1 text-xs pb-1.5">
                <input type="checkbox" name="slugStripStopWords" defaultChecked={slugRules.stripStopWords} disabled={!admin} /> strip stop words
              </label>
            </div>
          </div>

          {admin && <div><SubmitButton className="btn primary">Save publishing settings</SubmitButton></div>}
        </form>
      )}

      {/* ── Any other website: standalone HTML export ─────────────────────── */}
      <div className="card mt-5">
        <div className="flex items-center gap-2 mb-2">
          <Download className="w-4 h-4" style={{ color: "var(--teal-on)" }} />
          <h2 className="text-sm font-semibold flex-1">Publish anywhere — HTML export</h2>
        </div>
        <p className="text-xs text-[var(--mute)] mb-2">
          For sites that aren&apos;t WordPress: download any approved or published article as one complete HTML file —
          title, meta description, structured data and body, with images embedded so it renders anywhere. Paste the
          body into your CMS, or host the file as-is.{" "}
          <b>Social-preview (og:image) tags need the destination site to host the image</b> — embedded images
          can&apos;t serve that role, so set the preview image in your CMS after import.
        </p>
        {exportable.length === 0 ? (
          <p className="text-xs text-[var(--mute)]">
            Nothing to export yet — articles appear here once they reach final approval on the{" "}
            <Link href="/blog/board" className="underline">Blog board</Link>.
          </p>
        ) : (
          <ul className="text-xs flex flex-col gap-1">
            {exportable.map((p) => (
              <li key={p.id} className="flex items-center gap-2 border-b border-[var(--line)] pb-1.5 pt-0.5 last:border-0">
                <span className="font-semibold flex-1 min-w-0 truncate">{p.title}</span>
                <span
                  className="font-mono text-[9.5px] px-1.5 py-0.5 rounded-full shrink-0"
                  style={
                    p.status === "published"
                      ? { background: "var(--green-soft)", color: "var(--green-on)" }
                      : { background: "var(--violet-soft)", color: "var(--violet-on)" }
                  }
                >
                  {p.status === "published" ? "published" : "approved"}
                </span>
                <a href={`/api/blog-export/${p.id}`} className="btn sm shrink-0" download>
                  <Download className="w-3 h-3" /> HTML
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Site page inventory — fuels internal-link suggestions (Wave B′). */}
      <div className="card mt-5">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-sm font-semibold flex-1">
            Site pages <span className="font-mono text-xs text-[var(--mute)]">({pages.length})</span>
          </h2>
          {canEdit(membership.role) && (
            <form action={importPublishedAsPagesAction}>
              <SubmitButton className="btn" pendingText="Importing…">Import published posts</SubmitButton>
            </form>
          )}
        </div>
        <p className="text-xs text-[var(--mute)] mb-2">
          Pages on your site the AI can suggest as internal links from drafts.
        </p>
        {canEdit(membership.role) && (
          <form action={addSitePageAction} className="flex flex-wrap items-center gap-2 mb-2">
            <input name="url" type="url" required placeholder="https://…" className="text-xs font-mono flex-1 min-w-48" />
            <input name="title" required placeholder="page title" className="text-xs w-40" />
            <input name="topic" placeholder="topic (optional)" className="text-xs w-32" />
            <button className="btn">Add</button>
          </form>
        )}
        {pages.length === 0 ? (
          <p className="text-xs text-[var(--mute)]">No pages yet — add key pages or import your published posts.</p>
        ) : (
          <ul className="text-xs flex flex-col gap-1">
            {pages.map((p) => (
              <li key={p.id} className="flex items-center gap-2 border-b border-[var(--line)] pb-1 last:border-0">
                <span className="font-semibold shrink-0">{p.title}</span>
                <span className="font-mono text-[10px] text-[var(--mute)] truncate flex-1">{p.url}</span>
                {p.topic && <span className="text-[var(--mute)] shrink-0">{p.topic}</span>}
                {canEdit(membership.role) && (
                  <form action={deleteSitePageAction} className="shrink-0">
                    <input type="hidden" name="id" value={p.id} />
                    <button className="btn">✕</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
