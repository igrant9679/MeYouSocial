import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { SelectAllBox } from "@/components/SelectAllBox";
import { CsvButton } from "@/components/CsvButton";
import { EmptyState } from "@/components/EmptyState";
import { bulkArticlesAction } from "@/app/actions/article-bulk";
import { ARTICLE_STATUSES, articlesHref, type ArticleQuery, type listArticles } from "@/lib/article-list";
import { formatDay, formatZonedMoment } from "@/lib/zoned-dates";

const STATUS_LABEL: Record<string, { title: string; hue: string }> = {
  drafting: { title: "Drafting", hue: "amber" },
  draft_review: { title: "In review", hue: "blue" },
  final_approval: { title: "Final approval", hue: "violet" },
  published: { title: "Published", hue: "green" },
};

/**
 * The Articles list view (E-ART-08): filters, pages, and bulk actions for
 * editors. A server component — the filters are a GET form, the bulk bar is
 * one form whose pressed button names the action; only "select all" needs JS.
 */
export function ArticleList({ q, list, topics, members, editor, admin, timeZone, anyArticles }: {
  q: ArticleQuery;
  list: Awaited<ReturnType<typeof listArticles>>;
  topics: Array<{ id: string; name: string }>;
  members: Array<{ userId: string; name: string }>;
  editor: boolean;
  admin: boolean;
  timeZone: string;
  anyArticles: boolean;
}) {
  const filtered = !!(q.status || q.topic || q.reviewer || q.q);
  const back = articlesHref(q);
  const nameOf = new Map(members.map((m) => [m.userId, m.name]));
  const all = Object.values(list.counts).reduce((a, n) => a + n, 0);
  const chip = (active: boolean) =>
    "text-xs font-mono px-2.5 py-1 rounded-md border " + (active ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--line-2)] text-[var(--mute)]");

  if (!anyArticles) {
    return (
      <section className="card mb-4">
        <EmptyState
          variant="inline"
          line="No articles yet."
          note={editor ? "Approve an idea on the Ideas board and the engine writes the first one — or create one with the form above." : "An editor approves an idea or creates an article; drafts appear here on their own."}
          action={editor ? { label: "Open the Ideas board", href: "/ideas" } : null}
        />
      </section>
    );
  }

  return (
    <section className="card mb-4" data-article-list>
      <nav className="flex flex-wrap items-center gap-1 mb-3" data-article-status>
        <Link href={articlesHref(q, { status: null, page: 1 })} className={chip(!q.status)}>All ({all})</Link>
        {ARTICLE_STATUSES.map((st) => (
          <Link key={st} href={articlesHref(q, { status: st, page: 1 })} className={chip(q.status === st)} data-status-chip={st}>
            {STATUS_LABEL[st].title} ({list.counts[st] ?? 0})
          </Link>
        ))}
      </nav>

      {/* Filters: a plain GET form, so the URL carries them. */}
      <form method="get" action="/blog" className="flex flex-wrap items-end gap-2 mb-3" data-article-filters>
        <input type="hidden" name="view" value="list" />
        {q.status && <input type="hidden" name="status" value={q.status} />}
        <label className="text-xs">
          <span className="block text-[var(--mute)] mb-0.5">Title or keyword</span>
          <input type="search" name="q" defaultValue={q.q} placeholder="Search…" className="w-48 border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs" />
        </label>
        <label className="text-xs">
          <span className="block text-[var(--mute)] mb-0.5">Topic</span>
          <select name="topic" defaultValue={q.topic ?? ""} className="w-44 border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs">
            <option value="">Any Topic</option>
            {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-[var(--mute)] mb-0.5">Reviewer</span>
          <select name="reviewer" defaultValue={q.reviewer ?? ""} className="w-40 border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs">
            <option value="">Anyone</option>
            <option value="none">No reviewer</option>
            {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
          </select>
        </label>
        <button className="btn">Filter</button>
        {filtered && <Link href="/blog?view=list" className="text-xs underline text-[var(--mute)]">Clear</Link>}
      </form>

      {list.items.length === 0 ? (
        <p className="text-xs text-[var(--mute)] m-0" data-articles-empty>
          No article matches these filters. <Link href="/blog?view=list" className="underline">Show every article</Link>.
        </p>
      ) : (
        <form action={bulkArticlesAction} data-article-bulk>
          <input type="hidden" name="back" value={back} />
          {editor && (
            <div className="flex flex-wrap items-center gap-2 mb-3 p-2 rounded-lg border border-[var(--line)] text-xs" data-bulk-bar>
              <SelectAllBox />
              <span className="text-[var(--mute)]">With the ticked articles:</span>
              <select name="reviewerId" defaultValue="" className="w-36 border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs" aria-label="Reviewer to set">
                <option value="">no reviewer</option>
                {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
              </select>
              <SubmitButton className="btn" name="op" value="assign" pendingText="Setting…">Set reviewer</SubmitButton>
              <SubmitButton className="btn" name="op" value="advance" pendingText="Checking…" title="In review → final approval, where the checks pass">Advance what passes</SubmitButton>
              {admin && (
                <details className="relative" data-bulk-schedule>
                  <summary className="btn cursor-pointer list-none">Schedule…</summary>
                  <div className="absolute z-10 mt-1 p-3 card !shadow-lg flex flex-col gap-2 w-64">
                    <p className="m-0 text-[var(--mute)]">Ticked articles at final approval, in the order shown, from this day — {timeZone}.</p>
                    <label>First day <input type="date" name="startDay" className="w-full border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs" /></label>
                    <label>Time <input type="time" name="time" defaultValue="09:00" className="w-full border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs" /></label>
                    <label>Every <input type="number" name="everyDays" defaultValue={1} min={1} max={14} className="w-16 border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs" /> day(s)</label>
                    <SubmitButton className="btn primary" name="op" value="schedule" pendingText="Scheduling…">Schedule</SubmitButton>
                  </div>
                </details>
              )}
              {admin && (
                <details className="relative" data-bulk-delete>
                  <summary className="btn cursor-pointer list-none" style={{ color: "var(--rose-on)" }}>Delete…</summary>
                  <div className="absolute z-10 mt-1 p-3 card !shadow-lg flex flex-col gap-2 w-64">
                    <label className="flex items-start gap-1.5"><input type="checkbox" name="confirm" value="yes" /> Yes, delete the ticked articles. Published ones are kept.</label>
                    <SubmitButton className="btn" name="op" value="delete" pendingText="Deleting…" style={{ color: "var(--rose-on)" }}>Delete</SubmitButton>
                  </div>
                </details>
              )}
              <span className="ml-auto"><CsvButton table="articles-list" filename="articles" /></span>
            </div>
          )}
          {!editor && <div className="flex justify-end mb-1"><CsvButton table="articles-list" filename="articles" /></div>}
          <div className="overflow-x-auto">
            <table data-csv="articles-list" className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-[var(--mute)]">
                  {editor && <th className="py-1.5 px-2 w-6 border-b-2 border-[var(--line)]" data-csv-skip><span className="sr-only">Select</span></th>}
                  {["Status", "Article", "Topic", "Reviewer", "Keyword", "Updated", "Scheduled"].map((h) => (
                    <th key={h} className="py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.items.map((p) => {
                  const st = STATUS_LABEL[p.status] ?? { title: p.status, hue: "cyan" };
                  return (
                    <tr key={p.id} className="odd:bg-[var(--zebra)]" data-article={p.id}>
                      {editor && (
                        <td className="py-1.5 px-2 border-b border-[var(--line)]" data-csv-skip>
                          <input type="checkbox" name="ids" value={p.id} aria-label={`Select “${p.title}”`} />
                        </td>
                      )}
                      <td className="py-1.5 px-2 border-b border-[var(--line)] whitespace-nowrap">
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: `var(--${st.hue}-soft)`, color: `var(--${st.hue}-on)` }}>{st.title}</span>
                      </td>
                      <td className="py-1.5 px-2 border-b border-[var(--line)] min-w-56">
                        <Link href={`/blog/${p.id}`} className="font-semibold hover:underline">{p.title}</Link>
                        {p.citations.length > 0 && (
                          <span className="ml-1.5 font-mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>{p.citations.length} unverified</span>
                        )}
                      </td>
                      <td className="py-1.5 px-2 border-b border-[var(--line)]">{p.topic?.name ?? "—"}</td>
                      <td className="py-1.5 px-2 border-b border-[var(--line)]">{p.reviewerId ? (nameOf.get(p.reviewerId) ?? "a former member") : "—"}</td>
                      <td className="py-1.5 px-2 border-b border-[var(--line)] text-[var(--mute)]">{p.focusKeyword ?? "—"}</td>
                      <td className="py-1.5 px-2 border-b border-[var(--line)] font-mono whitespace-nowrap">{formatDay(p.updatedAt, timeZone)}</td>
                      <td className="py-1.5 px-2 border-b border-[var(--line)] font-mono whitespace-nowrap">{p.scheduledAt ? formatZonedMoment(p.scheduledAt, timeZone) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </form>
      )}

      {list.pages > 1 && (
        <nav className="flex flex-wrap items-center gap-3 mt-3 text-xs font-mono" data-article-pages>
          {q.page > 1 ? <Link href={articlesHref(q, { page: q.page - 1 })} className="underline">← Newer</Link> : <span className="text-[var(--mute)]">← Newer</span>}
          <span className="text-[var(--mute)]">Page {q.page} of {list.pages} · {list.total} articles</span>
          {q.page < list.pages ? <Link href={articlesHref(q, { page: q.page + 1 })} className="underline">Older →</Link> : <span className="text-[var(--mute)]">Older →</span>}
        </nav>
      )}
    </section>
  );
}
