import Link from "next/link";
import { Pause, Play, RefreshCw, Rss } from "lucide-react";
import { requireMembership, canEdit } from "@/lib/acl";
import { db } from "@/lib/db";
import { isFullyAutonomous } from "@/lib/autonomy";
import { listCategories } from "@/lib/social/categories";
import { formatInZone, getPostingTimeZone } from "@/lib/social/slots";
import { networkFor } from "@/lib/social/networks";
import { SubmitButton } from "@/components/SubmitButton";
import { DeleteButton } from "@/components/DeleteButton";
import { EmptyState } from "@/components/EmptyState";
import { Banner } from "@/components/SocialPostCard";
import { addFeedAction, checkFeedNowAction, toggleFeedAction, updateFeedAction } from "@/app/actions/social-rss";

// Distribute → RSS (Socialmonials parity, phase 4, 2026-10-17). Follow a feed;
// its new items become social ideas (each waits for a person) or drafts.

type SP = { ok?: string; err?: string; flash?: string };
const inputCls = "border border-[var(--line-2)] rounded-lg px-2 py-1.5 text-xs";

export default async function RssPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { workspace, membership } = await requireMembership();
  const editor = canEdit(membership.role);
  const sp = await searchParams;
  const [feeds, topics, categories, autonomous, tz, accounts] = await Promise.all([
    db.rssFeed.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "asc" },
      // Newest by the feed's own date: a feed lists newest first, so insertion
      // order would show the oldest of a read first.
      include: { items: { orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }], take: 5, select: { id: true, title: true, link: true, socialIdeaId: true, postId: true, skipped: true, createdAt: true } }, _count: { select: { items: true } } },
    }),
    db.topic.findMany({ where: { workspaceId: workspace.id, status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    listCategories(workspace.id),
    isFullyAutonomous(workspace.id),
    getPostingTimeZone(workspace.id),
    db.zernioAccount.findMany({ where: { workspaceId: workspace.id, status: "connected" }, orderBy: [{ platform: "asc" }, { displayName: "asc" }], select: { id: true, platform: true, displayName: true, username: true } }),
  ]);
  const accountName = new Map(accounts.map((a) => [a.id, `${a.displayName ?? a.username ?? a.platform} (${networkFor(a.platform)?.label ?? a.platform})`]));
  // The honest description of "drafts" depends on this workspace's autonomy.
  const draftsMeaning = autonomous
    ? "Draft posts — ⚠ full autonomy is on here, so the sweep queues them into free slots: they go out on their own."
    : "Draft posts — they wait in Drafts until someone queues them.";

  return (
    <div>
      <div className="flex items-baseline gap-3 flex-wrap mb-3">
        <h1 className="font-mono text-[22px] font-bold m-0">RSS</h1>
        <p className="text-[13px] text-[var(--mute)] m-0">Follow a blog or news feed and its new items arrive here as social ideas or drafts — checked about once an hour.</p>
      </div>
      {sp.ok && <Banner kind="ok" text={sp.ok} />}
      {sp.err && <Banner kind="err" text={sp.err} />}
      {sp.flash && <Banner kind="ok" text={sp.flash} />}

      {editor && (
        <form action={addFeedAction} className="card mb-4 flex flex-wrap items-end gap-2">
          <label className="text-xs flex-1 min-w-72"><span className="block text-[10px] text-[var(--mute)] mb-1">Feed address</span><input name="url" required type="url" placeholder="https://example.org/feed" className={`${inputCls} w-full`} /></label>
          <label className="text-xs"><span className="block text-[10px] text-[var(--mute)] mb-1">New items become</span><ModeSelect draftsMeaning={draftsMeaning} value="ideas" /></label>
          {topics.length > 0 && (
            <label className="text-xs"><span className="block text-[10px] text-[var(--mute)] mb-1">Topic</span>
              <select name="topicId" defaultValue="" className={inputCls}><option value="">none</option>{topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          )}
          <label className="text-xs"><span className="block text-[10px] text-[var(--mute)] mb-1">Category</span>
            <select name="category" defaultValue="Industry News" className={inputCls}><option value="">none</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <SubmitButton className="btn primary" pendingText="Reading the feed…"><Rss className="w-4 h-4" /> Follow</SubmitButton>
          <FeedOptions accounts={accounts} accountName={accountName} />
          <span className="basis-full text-[10px] text-[var(--mute)]">The first read brings in at most 5 items from the last week; older ones are marked seen, so a busy feed can&apos;t flood the board.</span>
        </form>
      )}

      {feeds.length === 0 ? (
        <EmptyState line="No feeds followed yet." note="A feed is a blog's or news site's RSS address — most end in /feed, /rss or .xml." />
      ) : (
        <ul className="flex flex-col gap-3 m-0 p-0 list-none">
          {feeds.map((f) => (
            <li key={f.id} className="card" style={f.active ? undefined : { opacity: 0.7 }}>
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <Rss className="w-4 h-4" style={{ color: "var(--amber-on)" }} />
                <span className="font-semibold text-sm">{f.title ?? f.url}</span>
                {!f.active && <span className="font-mono text-[10px] uppercase text-[var(--mute)]">paused</span>}
                <span className="flex-1" />
                {editor && (
                  <>
                    <form action={checkFeedNowAction}><input type="hidden" name="id" value={f.id} /><SubmitButton className="btn sm" pendingText="Reading…" title="Read the feed now"><RefreshCw className="w-3 h-3" /> Check now</SubmitButton></form>
                    <form action={toggleFeedAction}><input type="hidden" name="id" value={f.id} /><SubmitButton className="btn sm" pendingText="…">{f.active ? <><Pause className="w-3 h-3" /> Pause</> : <><Play className="w-3 h-3" /> Resume</>}</SubmitButton></form>
                    <DeleteButton kind="rssFeed" id={f.id} name={f.title ?? f.url} returnTo="/social/rss" iconOnly />
                  </>
                )}
              </div>
              <p className="text-[11px] text-[var(--mute)] m-0 mb-2 break-all">
                {f.url} · {f._count.items} item{f._count.items === 1 ? "" : "s"} seen · {f.lastCheckedAt ? `checked ${formatInZone(f.lastCheckedAt, tz)}` : "not checked yet"}
                {f.lastError && <span style={{ color: "var(--rose-on)" }}> · last read failed: {f.lastError}</span>}
              </p>
              <FeedRules feed={f} accountName={accountName} />
              {editor && (
                <form action={updateFeedAction} className="flex flex-wrap items-end gap-2 mb-2">
                  <input type="hidden" name="id" value={f.id} />
                  <ModeSelect draftsMeaning={draftsMeaning} value={f.mode} />
                  {topics.length > 0 && <select name="topicId" defaultValue={f.topicId ?? ""} className={inputCls} aria-label="Topic"><option value="">no topic</option>{topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
                  <select name="category" defaultValue={f.category ?? ""} className={inputCls} aria-label="Category"><option value="">no category</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                  <SubmitButton className="btn sm" pendingText="…">Save</SubmitButton>
                  <FeedOptions feed={f} accounts={accounts} accountName={accountName} />
                </form>
              )}
              {f.items.length > 0 && (
                <ul className="text-xs m-0 pl-4 flex flex-col gap-0.5">
                  {f.items.map((it) => (
                    <li key={it.id}>
                      {it.link ? <a href={it.link} target="_blank" rel="noreferrer" className="hover:underline">{it.title}</a> : it.title}
                      <span className="text-[10px] text-[var(--mute)]"> · {it.socialIdeaId ? <Link href="/ideas?format=social" className="underline">an idea on the board</Link> : it.postId ? <Link href={`/social/${it.postId}/edit`} className="underline">a draft</Link> : it.skipped ? <span data-rss-skipped title="The feed's words skipped it — change them under Filters and defaults.">skipped — {it.skipped}</span> : <span title="Not every item is brought in: the first read takes at most 5 from the past week and each later read at most 10, so a busy feed can't flood the board. The rest are marked seen so they never arrive late.">seen, not brought in</span>}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type FeedRulesInput = { mode: string; includeWords: string | null; excludeWords: string | null; useImage: boolean; accountIds: string };
const readIds = (json: string) => { try { const v = JSON.parse(json); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };

/** What this feed's words and defaults do, in one line — nothing when there are none. */
function FeedRules({ feed, accountName }: { feed: FeedRulesInput; accountName: Map<string, string> }) {
  const ids = readIds(feed.accountIds).filter((id) => accountName.has(id));
  const parts = [
    feed.includeWords ? `only items mentioning ${feed.includeWords}` : null,
    feed.excludeWords ? `never ${feed.excludeWords}` : null,
    feed.mode === "drafts" && feed.useImage ? "drafts take the article's picture" : null,
    feed.mode === "drafts" && ids.length ? `drafts go to ${ids.map((id) => accountName.get(id)).join(", ")}` : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  return <p className="text-[11px] m-0 mb-2" data-rss-rules>{parts.join(" · ")}</p>;
}

/** The filters and defaults fields (E-SOC-20), folded so the form stays one line. */
function FeedOptions({ feed, accounts, accountName }: { feed?: FeedRulesInput; accounts: { id: string }[]; accountName: Map<string, string> }) {
  const chosen = new Set(feed ? readIds(feed.accountIds) : []);
  const open = !!feed && (!!feed.includeWords || !!feed.excludeWords || feed.useImage || chosen.size > 0);
  return (
    <details className="basis-full text-xs" open={open} data-rss-options>
      <summary className="cursor-pointer select-none text-[var(--mute)]">Filters and defaults</summary>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-56"><span className="block text-[10px] text-[var(--mute)] mb-1">Only items mentioning (commas between; blank = all)</span>
          <input name="includeWords" defaultValue={feed?.includeWords ?? ""} placeholder="e.g. hiring, remote work" className={`${inputCls} w-full`} /></label>
        <label className="flex-1 min-w-56"><span className="block text-[10px] text-[var(--mute)] mb-1">Never items mentioning</span>
          <input name="excludeWords" defaultValue={feed?.excludeWords ?? ""} placeholder="e.g. sponsored, webinar" className={`${inputCls} w-full`} /></label>
        <span className="basis-full text-[10px] text-[var(--mute)]">Whole words, in the title or summary. A &ldquo;never&rdquo; word always wins; skipped items are listed as skipped, with why.</span>
        <label className="inline-flex items-center gap-1.5 cursor-pointer"><input type="checkbox" name="useImage" defaultChecked={feed?.useImage ?? false} /> Drafts take the article&apos;s picture</label>
        <span className="text-[10px] text-[var(--mute)]">The feed&apos;s own image, else the page&apos;s preview image — kept in Media. Drafts mode only.</span>
        {accounts.length > 0 ? (
          <fieldset className="basis-full m-0 p-0 border-0">
            <legend className="text-[10px] text-[var(--mute)] mb-1">Drafts go to (drafts mode only; a network that needs a picture is left off a draft without one)</legend>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {accounts.map((a) => (
                <label key={a.id} className="inline-flex items-center gap-1 cursor-pointer"><input type="checkbox" name="accountIds" value={a.id} defaultChecked={chosen.has(a.id)} /> {accountName.get(a.id)}</label>
              ))}
            </div>
          </fieldset>
        ) : (
          <span className="basis-full text-[10px] text-[var(--mute)]">No connected accounts — drafts have none chosen until you connect one.</span>
        )}
      </div>
    </details>
  );
}

function ModeSelect({ value, name = "mode", draftsMeaning }: { value: string; name?: string; draftsMeaning: string }) {
  return (
    <select name={name} defaultValue={value} className={inputCls}>
      <option value="ideas">Social ideas on the board — each waits for a person</option>
      <option value="drafts">{draftsMeaning}</option>
    </select>
  );
}
