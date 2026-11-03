import Link from "next/link";
import { requireMembership, canEdit } from "@/lib/acl";
import { StageHeader } from "@/components/StageShell";
import { EmptyState } from "@/components/EmptyState";
import { topicMeasure } from "@/lib/topic-measure";
import { getPostingTimeZone } from "@/lib/social/slots";
import { RangePicker } from "@/components/RangePicker";
import { measureRange, type RangeInput } from "@/lib/measure-range";
import { CsvButton } from "@/components/CsvButton";

// Measure → Topics: what each Topic earned, per format. One row per Topic,
// columns per format, every cell measured or a dash — and the page says why
// a column is dashes, so a blank is never read as "nothing happened".

const dash = <span className="text-[var(--mute)]" title="Not measured">—</span>;
const th = "py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)]";
// Below md each Topic is a card of label: value rows (E-MEA-20) — `data-label` on each cell names it.
const td = "py-1.5 px-2 border-b border-[var(--line)] align-top max-md:flex max-md:justify-between max-md:gap-3 max-md:py-1 max-md:px-0 max-md:border-0 max-md:text-right max-md:before:content-[attr(data-label)] max-md:before:text-[var(--mute)] max-md:before:text-left max-md:before:font-mono max-md:before:text-[10px] max-md:before:uppercase";
const n = (v: number | null, suffix = "") => (v == null ? dash : <span className="font-mono tabular-nums">{v.toLocaleString()}{suffix}</span>);

export default async function MeasureTopicsPage({ searchParams }: { searchParams: Promise<RangeInput> }) {
  const { workspace, membership } = await requireMembership();
  const editor = canEdit(membership.role);
  // One range for all of Measure (E-MEA-01).
  const range = await measureRange(await searchParams, await getPostingTimeZone(workspace.id).catch(() => "UTC"));
  const m = await topicMeasure(workspace.id, range);
  const anyMeasured = m.rows.some((r) => r.articles.position != null || r.articles.clicks != null || r.video.views != null || r.social.engagement != null || r.social.impressions != null);
  const totals = m.rows.reduce(
    (a, r) => ({ made: a.made + r.articles.made + r.video.renders + r.social.posts, out: a.out + r.articles.published + r.social.posted, waiting: a.waiting + r.ideasWaiting }),
    { made: 0, out: 0, waiting: 0 },
  );

  return (
    <div>
      <StageHeader
        title="Topics"
        sentence={
          m.rows.length === 0
            ? "What each Topic earned, per format. There are no Topics yet, so there is nothing to measure against."
            : anyMeasured
              ? `What each Topic earned, per format — measured where a connected source reported it, a dash where none did. Counts (made, out, renders) are all time; clicks, views and engagement cover the ${m.range.label}; position is each article's latest.`
              : `${m.rows.length} Topic${m.rows.length === 1 ? "" : "s"}, ${totals.made} thing${totals.made === 1 ? "" : "s"} made, ${totals.out} out — and nothing measured back yet. The dashes below are unmeasured, not zero.`
        }
        counts={[
          { label: "topics", n: m.rows.length, href: "/ideas/topics", hue: "violet" },
          { label: "made", n: totals.made },
          { label: "out", n: totals.out, hue: "green" },
          { label: "ideas waiting", n: totals.waiting, href: "/ideas", hue: totals.waiting > 0 ? "amber" : undefined },
        ]}
      />

      <RangePicker range={range} path="/measure/topics" note="Counts are all time and YouTube views a fixed 90 days; clicks and engagement follow the range." />
      {m.rows.length >= 2 && (
        <p className="text-xs mb-3 -mt-1">
          {/* E-MEA-12: side by side over the same weeks, item by item. */}
          <Link href={`/measure/topics/compare?${m.rows.slice(0, 2).map((r) => `t=${r.id}`).join("&")}${range.preset ? `&range=${range.preset}` : ""}`} className="underline" data-compare-link>Compare Topics side by side, week by week →</Link>
        </p>
      )}

      {m.rows.length === 0 ? (
        <EmptyState
          line="No Topics, so nothing to measure by."
          note="Topics are the spine: research is matched to them, ideas in every format are discovered per Topic, and this table shows what each one earned."
          action={editor ? { label: "Add a Topic", href: "/ideas/topics" } : null}
        />
      ) : (
        <section className="card">
          <div className="overflow-x-auto">
            <div className="flex justify-end mb-1"><CsvButton table="topics" filename="topics" /></div>
            <table data-csv="topics" className="w-full text-xs border-collapse max-md:block" data-narrow-cards>
              <thead className="max-md:hidden">
                <tr className="text-left text-[var(--mute)]">
                  <th className={th} rowSpan={2}>Topic</th>
                  <th className={`${th} text-center`} colSpan={3} style={{ color: "var(--rose-on)" }}>Articles</th>
                  <th className={`${th} text-center`} colSpan={3} style={{ color: "var(--violet-on)" }}>Video</th>
                  <th className={`${th} text-center`} colSpan={3} style={{ color: "var(--blue-on)" }}>Social</th>
                  <th className={`${th} text-right`} rowSpan={2}>Ideas waiting</th>
                </tr>
                <tr className="text-left text-[var(--mute)]">
                  <th className={`${th} text-right`} title="Published of made, all time">Out / made</th>
                  <th className={`${th} text-right`} title="Mean latest search position over published articles with one">Position (latest)</th>
                  <th className={`${th} text-right`} title={`Search clicks over the ${m.range.label}`}>Clicks ({m.range.label.replace("last ", "")})</th>
                  <th className={`${th} text-right`} title="Finished renders, all time">Renders</th>
                  <th className={`${th} text-right`} title="Views over the last 90 days of the channel's videos whose titles match this Topic by keyword">Views (90 days)</th>
                  <th className={`${th} text-right`} title="Mean average-view percentage over the matched videos">Retention</th>
                  <th className={`${th} text-right`} title="Posted of made, all time">Out / made</th>
                  <th className={`${th} text-right`} title={`Likes, comments and shares combined, latest reading per sent target, posts sent in the ${m.range.label}`}>Engagement ({m.range.label.replace("last ", "")})</th>
                  <th className={`${th} text-right`} title="Impressions as reported by the networks that report them">Impressions</th>
                </tr>
              </thead>
              <tbody className="max-md:block">
                {m.rows.map((r) => (
                  <tr key={r.id} className="max-md:block max-md:border-b max-md:border-[var(--line)] max-md:py-2" style={r.status !== "active" ? { opacity: 0.6 } : undefined}>
                    <td data-label="Topic" className={td}>
                      <Link href={`/ideas/topics/${r.id}`} className="font-semibold hover:underline">{r.name}</Link>
                      {r.status !== "active" && <span className="ml-1 font-mono text-[9px] uppercase text-[var(--mute)]">archived</span>}
                    </td>
                    <td data-label="Articles out / made" className={`${td} text-right font-mono tabular-nums`}>{r.articles.published} / {r.articles.made}</td>
                    <td data-label="Article position" className={`${td} text-right`}>{r.articles.position == null ? dash : <span className="font-mono tabular-nums" title={`over ${r.articles.positionN} article${r.articles.positionN === 1 ? "" : "s"}`}>{r.articles.position}</span>}</td>
                    <td data-label="Search clicks" className={`${td} text-right`}>{n(r.articles.clicks)}</td>
                    <td data-label="Renders" className={`${td} text-right font-mono tabular-nums`}>{r.video.renders}</td>
                    <td data-label="YouTube views (90 days)" className={`${td} text-right`}>{r.video.views == null ? dash : <span className="font-mono tabular-nums" data-video-basis={r.video.matched ? "kw" : "linked"} title={[r.video.linked ? `${r.video.linked} linked upload${r.video.linked === 1 ? "" : "s"}` : "", r.video.matched ? `${r.video.matched} matched by keyword` : ""].filter(Boolean).join(" + ")}>{r.video.views.toLocaleString()}{r.video.matched > 0 && <span className="text-[9px] text-[var(--mute)] ml-1">kw</span>}</span>}</td>
                    <td data-label="Retention" className={`${td} text-right`}>{n(r.video.avgViewPct, "%")}</td>
                    <td data-label="Social out / made" className={`${td} text-right font-mono tabular-nums`}>{r.social.posted} / {r.social.posts}</td>
                    <td data-label="Engagement" className={`${td} text-right`}>{r.social.engagement == null ? dash : <span className="font-mono tabular-nums" title={`${r.social.n} reading${r.social.n === 1 ? "" : "s"}`}>{r.social.engagement.toLocaleString()}</span>}</td>
                    <td data-label="Impressions" className={`${td} text-right`}>{n(r.social.impressions)}</td>
                    <td data-label="Ideas waiting" className={`${td} text-right`}>{r.ideasWaiting > 0 ? <Link href="/ideas" className="font-mono tabular-nums underline">{r.ideasWaiting}</Link> : <span className="font-mono tabular-nums">0</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[10px] text-[var(--mute)] mt-3 flex flex-col gap-1">
            <p className="m-0">A dash is not measured, never zero. YouTube numbers are a project&apos;s own linked upload (link it on the project&apos;s page); <span className="font-mono">kw</span> marks a figure that also counts videos no project claims whose titles match the Topic&apos;s name or phrases.</p>
            {m.notes.articles && <p className="m-0">Articles: {m.notes.articles}</p>}
            {m.notes.video && <p className="m-0">Video: {m.notes.video}</p>}
            {m.notes.social && <p className="m-0">Social: {m.notes.social}</p>}
          </div>
        </section>
      )}
    </div>
  );
}
