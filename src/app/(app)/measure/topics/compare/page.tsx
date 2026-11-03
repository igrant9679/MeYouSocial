import Link from "next/link";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { StageHeader } from "@/components/StageShell";
import { getPostingTimeZone } from "@/lib/social/slots";
import { measureRange, MEASURE_PRESETS } from "@/lib/measure-range";
import { formatShortDay } from "@/lib/zoned-dates";
import { MAX_COMPARE, topicComparison, type CompareItem } from "@/lib/topic-compare";
import { CsvButton } from "@/components/CsvButton";

// Measure → Topics → Compare (E-MEA-12): two to four Topics over the same
// weeks — clicks, posts sent and their engagement — with each Topic's own
// articles and posts and what they earned. A dash is unmeasured, never zero.

const th = "py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)] text-left";
const td = "py-1.5 px-2 border-b border-[var(--line)] align-top";
const dash = <span className="text-[var(--mute)]" title="Not measured">—</span>;
const n = (v: number | null) => (v === null ? dash : <span className="font-mono tabular-nums">{v.toLocaleString("en-GB")}</span>);

export default async function CompareTopicsPage({ searchParams }: { searchParams: Promise<{ t?: string | string[]; range?: string }> }) {
  const { workspace } = await requireMembership();
  const sp = await searchParams;
  const asked = [...new Set((Array.isArray(sp.t) ? sp.t : sp.t ? [sp.t] : []).filter(Boolean))];
  const tz = await getPostingTimeZone(workspace.id).catch(() => "UTC");
  const range = await measureRange({ range: sp.range }, tz);
  const all = await db.topic.findMany({ where: { workspaceId: workspace.id, status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const chosen = asked.filter((id) => all.some((t) => t.id === id)).slice(0, MAX_COMPARE);
  const cmp = chosen.length >= 2 ? await topicComparison(workspace.id, chosen, range) : null;

  return (
    <div>
      <StageHeader
        title="Compare Topics"
        sentence={`Two to four Topics over the same weeks of the ${range.label}: search clicks, posts sent and what they earned, then each one's own articles and posts.`}
        counts={[{ label: "topics", n: all.length, href: "/measure/topics", hue: "violet" }]}
      />
      <Link href="/measure/topics" className="text-xs text-[var(--mute)] hover:underline">← All Topics</Link>

      <form method="get" className="card my-3 flex flex-col gap-2 text-xs" data-compare-pick>
        <p className="m-0 font-semibold">Pick two to four Topics</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {all.map((t) => (
            <label key={t.id} className="inline-flex items-center gap-1.5">
              <input type="checkbox" name="t" value={t.id} defaultChecked={chosen.includes(t.id)} /> {t.name}
            </label>
          ))}
          {all.length === 0 && <span className="text-[var(--mute)]">No Topics yet — add them on Ideas → Topics.</span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="inline-flex items-center gap-1.5">Over
            <select name="range" defaultValue={String(range.preset ?? range.days)} className="border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs">
              {MEASURE_PRESETS.map((d) => <option key={d} value={d}>the last {d} days</option>)}
            </select>
          </label>
          <button className="btn sm">Compare</button>
          {asked.length > MAX_COMPARE && <span className="text-[var(--amber-on)]">Only the first {MAX_COMPARE} are compared.</span>}
        </div>
      </form>

      {!cmp ? (
        <p className="text-sm text-[var(--mute)]" data-compare-empty>{chosen.length === 1 ? "Pick one more Topic to compare it with." : "Pick at least two Topics."}</p>
      ) : (
        <>
          <section className="card mb-4" data-compare-summary>
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-sm font-semibold flex-1 m-0">Side by side · {range.label}</h2>
              <CsvButton table="compare-summary" filename="topics-compared" />
            </div>
            <div className="overflow-x-auto">
              <table data-csv="compare-summary" className="w-full text-xs border-collapse">
                <thead><tr><th className={th}>Measure</th>{cmp.topics.map((t) => <th key={t.id} className={th}>{t.name}</th>)}</tr></thead>
                <tbody>
                  <tr><td className={td}>Search clicks</td>{cmp.topics.map((t) => <td key={t.id} className={td} data-cell={`${t.id}:clicks`}>{n(t.totals.clicks)}</td>)}</tr>
                  <tr><td className={td}>Clicks per article <span className="text-[var(--mute)]">(articles with a reading)</span></td>{cmp.topics.map((t) => <td key={t.id} className={td} data-cell={`${t.id}:cpa`}>{n(t.totals.clicksPerArticle)} <span className="text-[var(--mute)]">· {t.totals.articlesMeasured}</span></td>)}</tr>
                  <tr><td className={td}>Articles published in the range</td>{cmp.topics.map((t) => <td key={t.id} className={td} data-cell={`${t.id}:published`}>{n(t.totals.articlesPublished)}</td>)}</tr>
                  <tr><td className={td}>Social posts sent</td>{cmp.topics.map((t) => <td key={t.id} className={td} data-cell={`${t.id}:sent`}>{n(t.totals.postsSent)}</td>)}</tr>
                  <tr><td className={td}>Engagement on them</td>{cmp.topics.map((t) => <td key={t.id} className={td} data-cell={`${t.id}:eng`}>{n(t.totals.engagement)}</td>)}</tr>
                  <tr><td className={td}>Engagement per post <span className="text-[var(--mute)]">(posts with a reading)</span></td>{cmp.topics.map((t) => <td key={t.id} className={td} data-cell={`${t.id}:epp`}>{n(t.totals.engagementPerPost)} <span className="text-[var(--mute)]">· {t.totals.postsMeasured}</span></td>)}</tr>
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-[var(--mute)] mt-2 mb-0">Clicks from Search Console readings of each Topic&apos;s published articles; engagement is what the posts sent in the range have earned so far (the networks report lifetime totals).</p>
          </section>

          <section className="card mb-4" data-compare-weeks>
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-sm font-semibold flex-1 m-0">Week by week</h2>
              <CsvButton table="compare-weeks" filename="topics-by-week" />
            </div>
            <div className="overflow-x-auto">
              <table data-csv="compare-weeks" className="w-full text-xs border-collapse">
                <thead>
                  <tr><th className={th} rowSpan={2}>Week of</th>{cmp.topics.map((t) => <th key={t.id} className={th} colSpan={3}>{t.name}</th>)}</tr>
                  <tr>{cmp.topics.flatMap((t) => [<th key={`${t.id}c`} className={th}>clicks</th>, <th key={`${t.id}s`} className={th}>sent</th>, <th key={`${t.id}e`} className={th}>eng.</th>])}</tr>
                </thead>
                <tbody>
                  {cmp.weeks.map((w, i) => (
                    <tr key={w.from.toISOString()} className="odd:bg-[var(--zebra)]" data-week={i}>
                      <td className={`${td} font-mono whitespace-nowrap`}>{formatShortDay(w.from, tz)}</td>
                      {cmp.topics.flatMap((t) => [
                        <td key={`${t.id}c`} className={td}>{n(t.clicks[i])}</td>,
                        <td key={`${t.id}s`} className={td}>{t.sent[i] ? n(t.sent[i]) : <span className="text-[var(--mute)]">0</span>}</td>,
                        <td key={`${t.id}e`} className={td}>{n(t.engagement[i])}</td>,
                      ])}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
            {cmp.topics.map((t) => (
              <section key={t.id} className="card !mb-0 min-w-0" data-compare-items={t.id}>
                <h2 className="text-sm font-semibold mb-2"><Link href={`/ideas/topics/${t.id}`} className="hover:underline">{t.name}</Link></h2>
                <Items title="Its articles — clicks in the range" items={t.articles} empty="No published articles with this Topic." />
                <Items title="Its posts sent in the range — engagement" items={t.posts} empty="No posts with this Topic were sent in the range." />
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Items({ title, items, empty }: { title: string; items: CompareItem[]; empty: string }) {
  return (
    <div className="mb-3">
      <p className="text-[11px] font-semibold mb-1">{title}</p>
      {items.length === 0 ? <p className="text-xs text-[var(--mute)] m-0">{empty}</p> : (
        <ul className="m-0 p-0 list-none flex flex-col gap-1 text-xs">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-2 min-w-0" data-item={it.id}>
              <Link href={it.href} className="flex-1 min-w-0 truncate hover:underline">{it.title}</Link>
              {it.extra && <span className="font-mono text-[10px] text-[var(--mute)] shrink-0">{it.extra}</span>}
              <span className="shrink-0">{n(it.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
