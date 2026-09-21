import Link from "next/link";
import { requireMembership, canEdit } from "@/lib/acl";
import { StageHeader } from "@/components/StageShell";
import { EmptyState } from "@/components/EmptyState";
import { topicMeasure } from "@/lib/topic-measure";

// Measure → Topics: what each Topic earned, per format. One row per Topic,
// columns per format, every cell measured or a dash — and the page says why
// a column is dashes, so a blank is never read as "nothing happened".

const dash = <span className="text-[var(--mute)]" title="Not measured">—</span>;
const th = "py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)]";
const td = "py-1.5 px-2 border-b border-[var(--line)] align-top";
const n = (v: number | null, suffix = "") => (v == null ? dash : <span className="font-mono tabular-nums">{v.toLocaleString()}{suffix}</span>);

export default async function MeasureTopicsPage() {
  const { workspace, membership } = await requireMembership();
  const editor = canEdit(membership.role);
  const m = await topicMeasure(workspace.id, 90);
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
              ? `What each Topic earned over the ${m.range.label}, per format — measured where a connected source reported it, a dash where none did.`
              : `${m.rows.length} Topic${m.rows.length === 1 ? "" : "s"}, ${totals.made} thing${totals.made === 1 ? "" : "s"} made, ${totals.out} out — and nothing measured back yet. The dashes below are unmeasured, not zero.`
        }
        counts={[
          { label: "topics", n: m.rows.length, href: "/ideas/topics", hue: "violet" },
          { label: "made", n: totals.made },
          { label: "out", n: totals.out, hue: "green" },
          { label: "ideas waiting", n: totals.waiting, href: "/ideas", hue: totals.waiting > 0 ? "amber" : undefined },
        ]}
      />

      {m.rows.length === 0 ? (
        <EmptyState
          line="No Topics, so nothing to measure by."
          note="Topics are the spine: research is matched to them, ideas in every format are discovered per Topic, and this table shows what each one earned."
          action={editor ? { label: "Add a Topic", href: "/ideas/topics" } : null}
        />
      ) : (
        <section className="card">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-[var(--mute)]">
                  <th className={th} rowSpan={2}>Topic</th>
                  <th className={`${th} text-center`} colSpan={3} style={{ color: "var(--rose-on)" }}>Articles</th>
                  <th className={`${th} text-center`} colSpan={3} style={{ color: "var(--violet-on)" }}>Video</th>
                  <th className={`${th} text-center`} colSpan={3} style={{ color: "var(--blue-on)" }}>Social</th>
                  <th className={`${th} text-right`} rowSpan={2}>Ideas waiting</th>
                </tr>
                <tr className="text-left text-[var(--mute)]">
                  <th className={`${th} text-right`} title="Published of made">Out / made</th>
                  <th className={`${th} text-right`} title="Mean latest search position over published articles with one">Position</th>
                  <th className={`${th} text-right`} title={`Search clicks over the ${m.range.label}`}>Clicks</th>
                  <th className={`${th} text-right`} title="Finished renders">Renders</th>
                  <th className={`${th} text-right`} title="Views over the last 90 days of the channel's videos whose titles match this Topic by keyword">Views</th>
                  <th className={`${th} text-right`} title="Mean average-view percentage over the matched videos">Retention</th>
                  <th className={`${th} text-right`} title="Posted of made">Out / made</th>
                  <th className={`${th} text-right`} title={`Likes, comments and shares combined, latest reading per sent target, posts sent in the ${m.range.label}`}>Engagement</th>
                  <th className={`${th} text-right`} title="Impressions as reported by the networks that report them">Impressions</th>
                </tr>
              </thead>
              <tbody>
                {m.rows.map((r) => (
                  <tr key={r.id} style={r.status !== "active" ? { opacity: 0.6 } : undefined}>
                    <td className={td}>
                      <Link href={`/ideas/topics/${r.id}`} className="font-semibold hover:underline">{r.name}</Link>
                      {r.status !== "active" && <span className="ml-1 font-mono text-[9px] uppercase text-[var(--mute)]">archived</span>}
                    </td>
                    <td className={`${td} text-right font-mono tabular-nums`}>{r.articles.published} / {r.articles.made}</td>
                    <td className={`${td} text-right`}>{r.articles.position == null ? dash : <span className="font-mono tabular-nums" title={`over ${r.articles.positionN} article${r.articles.positionN === 1 ? "" : "s"}`}>{r.articles.position}</span>}</td>
                    <td className={`${td} text-right`}>{n(r.articles.clicks)}</td>
                    <td className={`${td} text-right font-mono tabular-nums`}>{r.video.renders}</td>
                    <td className={`${td} text-right`}>{r.video.views == null ? dash : <span className="font-mono tabular-nums" title={`${r.video.matched} video${r.video.matched === 1 ? "" : "s"} matched by keyword`}>{r.video.views.toLocaleString()}<span className="text-[9px] text-[var(--mute)] ml-1">kw</span></span>}</td>
                    <td className={`${td} text-right`}>{n(r.video.avgViewPct, "%")}</td>
                    <td className={`${td} text-right font-mono tabular-nums`}>{r.social.posted} / {r.social.posts}</td>
                    <td className={`${td} text-right`}>{r.social.engagement == null ? dash : <span className="font-mono tabular-nums" title={`${r.social.n} reading${r.social.n === 1 ? "" : "s"}`}>{r.social.engagement.toLocaleString()}</span>}</td>
                    <td className={`${td} text-right`}>{n(r.social.impressions)}</td>
                    <td className={`${td} text-right`}>{r.ideasWaiting > 0 ? <Link href="/ideas" className="font-mono tabular-nums underline">{r.ideasWaiting}</Link> : <span className="font-mono tabular-nums">0</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[10px] text-[var(--mute)] mt-3 flex flex-col gap-1">
            <p className="m-0">A dash is not measured, never zero. <span className="font-mono">kw</span> = matched by keyword: the app has no link from a render to the uploaded video, so a Topic's YouTube numbers are its channel videos whose titles match the Topic's name or phrases.</p>
            {m.notes.articles && <p className="m-0">Articles: {m.notes.articles}</p>}
            {m.notes.video && <p className="m-0">Video: {m.notes.video}</p>}
            {m.notes.social && <p className="m-0">Social: {m.notes.social}</p>}
          </div>
        </section>
      )}
    </div>
  );
}
