import Link from "next/link";
import { ArrowLeft, Plug } from "lucide-react";
import { requireMembership, canAdmin, canEdit } from "@/lib/acl";
import { db } from "@/lib/db";
import { SubmitButton } from "@/components/SubmitButton";
import { connectWordPressAction, disconnectWordPressAction } from "@/app/actions/blog-wp";
import { addSitePageAction, deleteSitePageAction, importPublishedAsPagesAction } from "@/app/actions/blog-optimize";
import { SubmitButton as SB } from "@/components/SubmitButton";

// Blog settings: WordPress connection (Spark FR-11). App password is write-only
// — stored encrypted, never displayed.

export default async function BlogSettingsPage() {
  const { workspace, membership } = await requireMembership();
  const [conn, pages] = await Promise.all([
    db.wordPressConnection.findUnique({ where: { workspaceId: workspace.id } }),
    db.sitePage.findMany({ where: { workspaceId: workspace.id }, orderBy: { title: "asc" }, take: 100 }),
  ]);
  const admin = canAdmin(membership.role);

  return (
    <main className="p-6 max-w-3xl mx-auto w-full">
      <Link href="/blog" className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Blog
      </Link>
      <div className="flex items-center gap-3 mb-5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--indigo-soft)", color: "var(--indigo-on)" }}>
          <Plug className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-2xl leading-tight">Blog settings</h1>
          <p className="text-xs text-[var(--mute)]">WordPress publishing connection for this workspace.</p>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-3">
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
                <SubmitButton className="btn primary" pendingText="Testing…">Save & test</SubmitButton>
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

      {/* Site page inventory — fuels internal-link suggestions (Wave B′). */}
      <div className="card mt-5">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-sm font-semibold flex-1">
            Site pages <span className="font-mono text-xs text-[var(--mute)]">({pages.length})</span>
          </h2>
          {canEdit(membership.role) && (
            <form action={importPublishedAsPagesAction}>
              <SB className="btn" pendingText="Importing…">Import published posts</SB>
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
