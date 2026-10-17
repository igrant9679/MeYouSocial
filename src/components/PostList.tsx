import Link from "next/link";
import { Copy, Pencil, Search, Send, Trash2, Undo2, ExternalLink, ListPlus } from "lucide-react";
import { db } from "@/lib/db";
import { networkFor } from "@/lib/social/networks";
import { formatInZone, getPostingTimeZone } from "@/lib/social/slots";
import { listCategories } from "@/lib/social/categories";
import { loadPostList, listCounts, SOURCES, TYPES, type ListFilter, type ListTab } from "@/lib/social/post-lists";
import { bulkPostsAction } from "@/app/actions/social-lists";
import { deleteSocialPostAction, duplicateSocialPostAction, publishNowAction, unscheduleSocialPostAction } from "@/app/actions/social";
import { SubmitButton } from "@/components/SubmitButton";
import { EmptyState } from "@/components/EmptyState";
import { Banner, MediaThumbs, listKeys, STATUS_STYLE } from "@/components/SocialPostCard";

/**
 * Queue · Sent · Drafts — the three Socialmonials list tabs (2026-10-17), one
 * component so a filter, a column and a bulk action mean the same thing on
 * each. Server component: filters are a GET form, bulk actions a server-action
 * form the row checkboxes join through the `form` attribute (so no form is
 * ever nested inside another — the nesting trap that once made the Inbox's
 * Dismiss submit the wrong action).
 */

const TITLES: Record<ListTab, { title: string; sentence: (n: number) => string }> = {
  queue: { title: "Queue", sentence: (n) => (n ? `${n} post${n === 1 ? "" : "s"} waiting to go out. When the time comes, each publishes on its own.` : "Nothing is waiting to go out.") },
  sent: { title: "Sent", sentence: (n) => (n ? `${n} post${n === 1 ? "" : "s"} published, partly published or failed — the record of what actually went out.` : "Nothing has been sent yet.") },
  drafts: { title: "Drafts", sentence: (n) => (n ? `${n} draft${n === 1 ? "" : "s"} — nothing here goes anywhere until someone queues, schedules or approves it.` : "No drafts.") },
};

export async function PostList({
  tab,
  workspaceId,
  editor,
  filter,
  flash,
}: {
  tab: ListTab;
  workspaceId: string;
  editor: boolean;
  filter: ListFilter;
  flash: { ok?: string; err?: string };
}) {
  const [{ rows, total, page, pages }, counts, tz, accounts, used] = await Promise.all([
    loadPostList(workspaceId, tab, filter),
    listCounts(workspaceId),
    getPostingTimeZone(workspaceId),
    db.zernioAccount.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" }, select: { accountId: true, platform: true, displayName: true, username: true, status: true } }),
    db.socialPost.findMany({ where: { workspaceId, category: { not: null } }, distinct: ["category"], select: { category: true } }),
  ]);
  const categories = await listCategories(workspaceId, used.map((u) => u.category));
  const filtered = Boolean(filter.q || filter.category || filter.type || filter.profile || filter.source);

  // The list's own URL with the current filters — where actions come back to.
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries({ q: filter.q, category: filter.category, type: filter.type, profile: filter.profile, source: filter.source })) if (v) qs.set(k, String(v));
  if (page > 1) qs.set("page", String(page));
  const here = `/social/${tab}${qs.toString() ? `?${qs.toString()}` : ""}`;
  const pageHref = (p: number) => {
    const c = new URLSearchParams(qs);
    if (p > 1) c.set("page", String(p)); else c.delete("page");
    return `/social/${tab}${c.toString() ? `?${c.toString()}` : ""}`;
  };
  const sel = "border border-[var(--line-2)] rounded-lg px-2 py-1.5 text-xs";

  return (
    <div>
      <div className="flex items-baseline gap-3 flex-wrap mb-3">
        <h1 className="font-mono text-[22px] font-bold m-0">{TITLES[tab].title}</h1>
        <p className="text-[13px] text-[var(--mute)] m-0">{TITLES[tab].sentence(tab === "queue" ? counts.queue : tab === "sent" ? counts.sent : counts.drafts)}</p>
      </div>
      {flash.ok && <Banner kind="ok" text={flash.ok} />}
      {flash.err && <Banner kind="err" text={flash.err} />}

      {/* Search + filters — a plain GET form, so a filtered list is a link. */}
      <form method="get" action={`/social/${tab}`} className="card mb-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 flex-1 min-w-56 border border-[var(--line-2)] rounded-lg px-2 py-1.5">
          <Search className="w-3.5 h-3.5 text-[var(--mute)]" />
          <input name="q" defaultValue={filter.q ?? ""} placeholder="Search posts" className="flex-1 text-xs border-0 outline-none bg-transparent" />
        </label>
        <select name="category" defaultValue={filter.category ?? ""} className={sel} aria-label="Category">
          <option value="">Category: all</option>
          <option value="__none__">No category</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select name="type" defaultValue={filter.type ?? ""} className={sel} aria-label="Type">
          <option value="">Type: all</option>
          {TYPES[tab].map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select name="profile" defaultValue={filter.profile ?? ""} className={sel} aria-label="Social profile">
          <option value="">Social profiles: all</option>
          {accounts.map((a) => (
            <option key={a.accountId} value={a.accountId}>{networkFor(a.platform)?.label ?? a.platform} · {a.displayName ?? a.username ?? a.accountId}{a.status !== "connected" ? " (disconnected)" : ""}</option>
          ))}
        </select>
        <select name="source" defaultValue={filter.source ?? ""} className={sel} aria-label="Source">
          <option value="">Source: all</option>
          {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button className="btn sm primary" type="submit">Apply</button>
        {filtered && <Link href={`/social/${tab}`} className="btn sm">Clear</Link>}
      </form>

      {/* Bulk toolbar — its own form; row checkboxes join it via form="bulk". */}
      {editor && rows.length > 0 && tab !== "sent" && (
        <form id="bulk" action={bulkPostsAction} className="flex flex-wrap items-center gap-2 mb-2 text-xs">
          <input type="hidden" name="back" value={here} />
          <span className="text-[var(--mute)]">With the ticked posts:</span>
          {tab === "queue" && <SubmitButton className="btn sm" name="op" value="unschedule" pendingText="…"><Undo2 className="w-3 h-3" /> Move to drafts</SubmitButton>}
          {tab === "drafts" && <SubmitButton className="btn sm" name="op" value="queue" pendingText="…"><ListPlus className="w-3 h-3" /> Add to queue</SubmitButton>}
          <SubmitButton className="btn sm" name="op" value="delete" pendingText="…" title="Deletes drafts, scheduled and failed posts. Sent posts are the record and are never deleted here."><Trash2 className="w-3 h-3" /> Delete</SubmitButton>
        </form>
      )}

      {rows.length === 0 ? (
        <EmptyState
          line={filtered ? "Nothing matches these filters." : TITLES[tab].sentence(0)}
          action={filtered ? { label: "Clear the filters", href: `/social/${tab}` } : editor ? { label: "Compose a post", href: "/social/compose" } : null}
        />
      ) : (
        <div className="card !p-0 overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-[var(--mute)]">
                {editor && tab !== "sent" && <th className="py-2 px-2 w-6 border-b-2 border-[var(--line)]" />}
                <th className="py-2 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)]">Attachments</th>
                <th className="py-2 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)]">Message</th>
                <th className="py-2 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)]">Category</th>
                <th className="py-2 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)]">{tab === "sent" ? "Result" : "Type"}</th>
                <th className="py-2 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)]">{tab === "sent" ? "Posted on" : tab === "queue" ? "Post on" : "Networks"}</th>
                <th className="py-2 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)] text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ row: p, source, addedBy, onSlot }) => {
                const st = STATUS_STYLE[p.status] ?? STATUS_STYLE.draft;
                const typeLabel =
                  tab === "queue" ? (p.status === "publishing" ? "Publishing now" : onSlot ? "Queued" : "Scheduled")
                  : tab === "drafts" ? (p.approval === "pending" ? "Awaiting approval" : p.approval === "changes" ? "Changes requested" : "Draft")
                  : st.label;
                // Drafts can carry a proposed time (Caption Studio, posts held for
                // approval) — shown so nobody mistakes it for an unscheduled draft.
                const when = tab === "sent" ? p.publishedAt ?? p.updatedAt : p.scheduledAt;
                return (
                  <tr key={p.id} className="align-top border-b border-[var(--line)] last:border-0">
                    {editor && tab !== "sent" && (
                      <td className="py-2 px-2"><input type="checkbox" name="ids" value={p.id} form="bulk" aria-label="Select this post" /></td>
                    )}
                    <td className="py-2 px-2 w-24">{listKeys(p.mediaKeys).length ? <MediaThumbs keys={listKeys(p.mediaKeys).slice(0, 1)} size="h-16 w-16" /> : <span className="text-[10px] text-[var(--mute)]">—</span>}</td>
                    <td className="py-2 px-2 min-w-72 max-w-xl">
                      <p className="m-0 whitespace-pre-wrap line-clamp-4 leading-snug">{p.text || <span className="text-[var(--mute)]">(no text)</span>}</p>
                      <p className="m-0 mt-1 text-[10px] text-[var(--mute)]">
                        Added {formatInZone(p.createdAt, tz)}{addedBy ? ` · by ${addedBy}` : ""} · {SOURCES.find((s) => s.value === source)?.label}
                        {p.campaign && <> · campaign {p.campaign.name}</>}
                        {p.topic && <> · {p.topic.name}</>}
                      </p>
                      {tab === "sent" && p.targets.some((t) => t.status === "failed") && (
                        <p className="m-0 mt-1 text-[10px]" style={{ color: "var(--rose-on)" }}>
                          {p.targets.filter((t) => t.status === "failed").map((t) => `${networkFor(t.provider)?.label ?? t.provider}: ${(t.error ?? "failed").slice(0, 120)}`).join(" · ")}
                        </p>
                      )}
                    </td>
                    <td className="py-2 px-2 whitespace-nowrap">{p.category ? <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--green-soft)", color: "var(--green-on)" }}>{p.category}</span> : <span className="text-[var(--mute)]">—</span>}</td>
                    <td className="py-2 px-2 whitespace-nowrap">
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: st.bg, color: st.fg }}>{typeLabel}</span>
                    </td>
                    <td className="py-2 px-2 min-w-40">
                      <div className="flex flex-wrap gap-1 mb-1">
                        {p.targets.map((t) => {
                          const net = networkFor(t.provider);
                          const live = tab === "sent" && t.platformPostUrl;
                          const chip = (
                            <span className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded-full border" title={`${net?.label ?? t.provider}${t.accountName ? ` · ${t.accountName}` : ""}${tab === "sent" ? ` · ${t.status}` : ""}`}
                              style={{ borderColor: tab === "sent" && t.status === "failed" ? "var(--rose)" : "var(--line-2)" }}>
                              <span className="w-1.5 h-1.5 rounded-full" style={{ background: net?.color ?? "var(--mute)" }} />
                              {net?.label ?? t.provider}
                              {live && <ExternalLink className="w-2.5 h-2.5" />}
                            </span>
                          );
                          return live ? <a key={t.id} href={t.platformPostUrl!} target="_blank" rel="noreferrer">{chip}</a> : <span key={t.id}>{chip}</span>;
                        })}
                        {p.targets.length === 0 && <span className="text-[10px] text-[var(--mute)]">no account yet</span>}
                      </div>
                      {when && <span className="font-mono text-[10px] text-[var(--mute)]">{tab === "drafts" ? "proposed " : ""}{formatInZone(when, tz)}</span>}
                    </td>
                    <td className="py-2 px-2">
                      {editor && (
                        <div className="flex flex-wrap justify-end gap-1">
                          {tab !== "sent" && <Link href={`/social/${p.id}/edit`} className="btn sm" title="Edit"><Pencil className="w-3 h-3" /></Link>}
                          {tab === "queue" && p.status === "scheduled" && (
                            <form action={unscheduleSocialPostAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value={here} />
                              <SubmitButton className="btn sm" pendingText="…" title="Move back to drafts"><Undo2 className="w-3 h-3" /></SubmitButton></form>
                          )}
                          {tab !== "sent" && p.targets.length > 0 && p.approval !== "pending" && p.approval !== "changes" && (
                            <form action={publishNowAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value={here} />
                              <SubmitButton className="btn sm" pendingText="…" title="Publish now"><Send className="w-3 h-3" /></SubmitButton></form>
                          )}
                          <form action={duplicateSocialPostAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value={here} />
                            <SubmitButton className="btn sm" pendingText="…" title="Duplicate to drafts"><Copy className="w-3 h-3" /></SubmitButton></form>
                          {tab !== "sent" && (
                            <form action={deleteSocialPostAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value={here} />
                              <SubmitButton className="btn sm" pendingText="…" title="Delete"><Trash2 className="w-3 h-3" /></SubmitButton></form>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center gap-2 mt-3 text-xs">
          {page > 1 && <Link href={pageHref(page - 1)} className="btn sm">← Newer</Link>}
          <span className="text-[var(--mute)]">Page {page} of {pages} · {total} post{total === 1 ? "" : "s"}</span>
          {page < pages && <Link href={pageHref(page + 1)} className="btn sm">Older →</Link>}
        </div>
      )}
    </div>
  );
}

/** Parse the list's searchParams into a ListFilter, bounded. */
export function listFilterFrom(sp: Record<string, string | undefined>): ListFilter {
  const s = (v?: string, n = 120) => (v ?? "").trim().slice(0, n) || undefined;
  return {
    q: s(sp.q, 200),
    category: s(sp.category, 40),
    type: s(sp.type, 20),
    profile: s(sp.profile, 80),
    source: s(sp.source, 20),
    page: Math.max(1, parseInt(sp.page ?? "1", 10) || 1),
  };
}
