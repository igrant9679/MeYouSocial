import Link from "next/link";
import { db } from "@/lib/db";
import { AreaChart } from "@/components/charts";
import { weightedPosition, WINDOW_DAYS } from "@/lib/dashboard-data";
import { compact, resultsForPosts } from "@/lib/social/post-results";
import { networkFor } from "@/lib/social/networks";
import { formatDay, formatZonedMoment } from "@/lib/zoned-dates";
import { requestNow } from "@/lib/request-time";
import { marksFor } from "@/lib/chart-annotations";
import { bucketsFromMoments } from "@/lib/chart-marks";
import { ChartMarkList } from "@/components/ChartMarks";
import { normQuery, queryWindow, topQueriesForPost } from "@/lib/search-queries";
import { visitsForPost, visitWindow } from "@/lib/social-visits";

/**
 * One article's performance (E-MEA-06): its daily search numbers, the 28 days
 * to its latest reading against the 28 before, and the social posts that
 * pointed at it with what each earned, and (E-MEA-08) the searches that found
 * it — Search Console's page × query rows over the last 28 days, with the
 * article's focus keyword marked or said to be missing.
 */

const DAY = 86_400_000;
const CHART_DAYS = 90;

type Snap = { capturedAt: Date; clicks: number | null; impressions: number | null; position: number | null };
const sum = (rows: Snap[], pick: (r: Snap) => number | null) => (rows.some((r) => pick(r) != null) ? rows.reduce((a, r) => a + (pick(r) ?? 0), 0) : null);

export async function ArticlePerformance({ postId, workspaceId, publishedUrl, timeZone }: { postId: string; workspaceId: string; publishedUrl: string | null; timeZone: string }) {
  const [snaps, fromIdeas, byLink] = await Promise.all([
    db.blogSnapshot.findMany({
      where: { postId, capturedAt: { gte: new Date(requestNow() - (CHART_DAYS + 2 * WINDOW_DAYS) * DAY) } },
      orderBy: { capturedAt: "asc" },
      select: { capturedAt: true, clicks: true, impressions: true, position: true },
    }),
    // Social posts made from this article's social ideas…
    db.socialIdea.findMany({ where: { workspaceId, sourceBlogPostId: postId, socialPostId: { not: null } }, select: { socialPostId: true } }),
    // …and any post carrying its live link.
    publishedUrl
      ? db.socialPost.findMany({ where: { workspaceId, text: { contains: publishedUrl } }, select: { id: true } })
      : Promise.resolve([] as Array<{ id: string }>),
  ]);
  const postIds = [...new Set([...fromIdeas.map((i) => i.socialPostId!), ...byLink.map((p) => p.id)])];
  const focus = await db.blogPost.findUnique({ where: { id: postId }, select: { focusKeyword: true } }).then((p) => (p?.focusKeyword ? normQuery(p.focusKeyword) : null));
  const [queries, qWindow, visits, vWindow] = await Promise.all([topQueriesForPost(postId, focus), queryWindow(workspaceId), visitsForPost(postId), visitWindow(workspaceId)]);
  const visitTotal = visits.reduce((a, v) => a + v.sessions, 0);
  const [posts, results] = await Promise.all([
    postIds.length
      ? db.socialPost.findMany({
          where: { id: { in: postIds }, workspaceId },
          orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { scheduledAt: "desc" }],
          select: { id: true, text: true, status: true, publishedAt: true, scheduledAt: true, targets: { select: { provider: true } } },
        })
      : Promise.resolve([]),
    resultsForPosts(postIds),
  ]);

  // The windows end at the latest reading (Search Console lags), as on Measure.
  const anchor = snaps.length ? snaps[snaps.length - 1].capturedAt.getTime() : null;
  const recent = anchor == null ? [] : snaps.filter((s) => s.capturedAt.getTime() > anchor - WINDOW_DAYS * DAY);
  const prior = anchor == null ? [] : snaps.filter((s) => s.capturedAt.getTime() <= anchor - WINDOW_DAYS * DAY && s.capturedAt.getTime() > anchor - 2 * WINDOW_DAYS * DAY);
  const chart = anchor == null ? [] : snaps.filter((s) => s.capturedAt.getTime() > anchor - CHART_DAYS * DAY);
  // E-MEA-04: this article's publish, the posts that pointed at it, and the
  // workspace's automation changes and notes, on the readings they fall in.
  const marks = chart.length ? await marksFor(workspaceId, bucketsFromMoments(chart.map((s) => s.capturedAt), DAY), { blogPostId: postId, socialPostIds: postIds }) : [];
  const metric = (label: string, now: number | null, before: number | null, fmt: (n: number) => string, lowerIsBetter = false) => {
    const delta = now != null && before != null && before !== 0 ? (now - before) / before : null;
    const good = delta == null ? null : lowerIsBetter ? delta < 0 : delta > 0;
    return (
      <div className="rounded-lg border border-[var(--line)] p-2.5" data-perf-metric={label}>
        <div className="text-[10px] uppercase tracking-wider font-mono text-[var(--mute)]">{label}</div>
        <div className="font-mono text-lg font-bold tabular-nums">{now == null ? "—" : fmt(now)}</div>
        <div className="text-[10px] font-mono text-[var(--mute)]">
          {before == null ? "nothing to compare" : <>was {fmt(before)}{delta != null && <b style={{ color: good ? "var(--green-on)" : "var(--rose-on)" }}> {delta > 0 ? "▲" : "▼"} {Math.abs(Math.round(delta * 100))}%</b>}</>}
        </div>
      </div>
    );
  };
  const clicksNow = sum(recent, (s) => s.clicks), clicksBefore = sum(prior, (s) => s.clicks);
  const imprNow = sum(recent, (s) => s.impressions), imprBefore = sum(prior, (s) => s.impressions);
  const ctr = (c: number | null, i: number | null) => (c != null && i ? (c / i) * 100 : null);
  const socialClicks = posts.map((p) => results.get(p.id)?.clicks ?? null).filter((n): n is number => n != null);

  return (
    <div className="flex flex-col gap-4" data-article-performance>
      <section className="card">
        <h2 className="text-sm font-semibold mb-0.5">Search</h2>
        {anchor == null ? (
          <p className="text-xs text-[var(--mute)] m-0" data-perf-empty>No search readings for this article yet — they arrive with the Search Console sync once it&apos;s live at a known link, or can be entered under Measure → Analytics.</p>
        ) : (
          <>
            <p className="text-xs text-[var(--mute)] mt-0 mb-3">The 28 days to the latest reading ({formatDay(new Date(anchor), timeZone)}) against the 28 days before.</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              {metric("Clicks", clicksNow, clicksBefore, (n) => compact(n))}
              {metric("Impressions", imprNow, imprBefore, (n) => compact(n))}
              {metric("CTR", ctr(clicksNow, imprNow), ctr(clicksBefore, imprBefore), (n) => `${n.toFixed(1)}%`)}
              {metric("Avg position", weightedPosition(recent), weightedPosition(prior), (n) => n.toFixed(1), true)}
            </div>
            <AreaChart points={chart.map((s) => ({ label: formatDay(s.capturedAt, "UTC"), value: s.clicks ?? 0 }))} color="var(--green)" title={`Clicks a day — last ${Math.min(CHART_DAYS, chart.length)} readings`} marks={marks} />
            <AreaChart points={chart.map((s) => ({ label: formatDay(s.capturedAt, "UTC"), value: s.impressions ?? 0 }))} color="var(--blue)" title="Impressions a day" marks={marks} />
            {chart.some((s) => s.clicks == null) && <p className="text-[10px] text-[var(--mute)] mt-1 mb-0">Days without a click reading are drawn at zero — not measured, not zero.</p>}
            <ChartMarkList marks={marks} timeZone={timeZone} canDelete={false} returnTo={`/blog/${postId}?tab=performance`} />
          </>
        )}
        <div className="mt-4" data-perf-queries>
          <h3 className="text-xs font-semibold m-0 mb-1">Searches that found it</h3>
          {queries.length === 0 ? (
            <p className="text-[11px] text-[var(--mute)] m-0">
              {qWindow
                ? `No searches recorded for this article in ${formatDay(qWindow.start, "UTC")} – ${formatDay(qWindow.end, "UTC")} — it may not show in Google yet, or only for searches too rare for Search Console to report.`
                : "Not read yet — the searches arrive with the Search Console sync (Settings → Analytics)."}
            </p>
          ) : (
            <>
              <p className="text-[11px] text-[var(--mute)] m-0 mb-1.5">{formatDay(queries[0].windowStart, "UTC")} – {formatDay(queries[0].windowEnd, "UTC")}, from Search Console. Position is Google&apos;s average for the search, weighted by impressions.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-left text-[9px] uppercase tracking-wider font-mono text-[var(--mute)]">
                      <th className="py-1 pr-3">Search</th>
                      <th className="py-1 pr-3 text-right">Clicks</th>
                      <th className="py-1 pr-3 text-right">Impressions</th>
                      <th className="py-1 pr-3 text-right">CTR</th>
                      <th className="py-1 text-right">Position</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queries.map((q) => (
                      <tr key={q.query} className="border-t border-[var(--line)]" data-query={q.query} data-focus={q.query === focus ? "1" : undefined}>
                        <td className="py-1 pr-3">{q.query}{q.query === focus && <span className="ml-1.5 font-mono text-[9px] uppercase px-1 py-0.5 rounded" style={{ background: "var(--violet-soft)", color: "var(--violet-on)" }}>focus keyword</span>}</td>
                        <td className="py-1 pr-3 text-right font-mono tabular-nums">{q.clicks.toLocaleString()}</td>
                        <td className="py-1 pr-3 text-right font-mono tabular-nums">{q.impressions.toLocaleString()}</td>
                        <td className="py-1 pr-3 text-right font-mono tabular-nums">{q.impressions ? `${((q.clicks / q.impressions) * 100).toFixed(1)}%` : "—"}</td>
                        <td className="py-1 text-right font-mono tabular-nums">{q.position.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {focus && !queries.some((q) => q.query === focus) && (
                <p className="text-[11px] m-0 mt-1.5" style={{ color: "var(--amber-on)" }} data-focus-missing>
                  Its focus keyword “{focus}” isn&apos;t among the searches that found it in this window.
                </p>
              )}
            </>
          )}
        </div>
      </section>

      <section className="card" data-perf-social>
        <h2 className="text-sm font-semibold mb-0.5">Social posts that pointed here</h2>
        <p className="text-xs text-[var(--mute)] mt-0 mb-3">
          Posts made from this article&apos;s social ideas{publishedUrl ? ", and any post carrying its link" : ""}.
          {socialClicks.length > 0 && <> Together: <b>{compact(socialClicks.reduce((a, b) => a + b, 0))}</b> clicks measured.</>}
        </p>
        {posts.length === 0 ? (
          <p className="text-xs text-[var(--mute)] m-0">None yet.</p>
        ) : (
          <ul className="m-0 p-0 list-none flex flex-col gap-2">
            {posts.map((p) => {
              const r = results.get(p.id);
              const when = p.publishedAt ?? p.scheduledAt;
              return (
                <li key={p.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 text-xs border-t border-[var(--line)] pt-2" data-perf-post={p.id}>
                  <Link href={`/social/${p.id}`} className="flex-1 min-w-56 line-clamp-2 hover:underline">{p.text || "(no text)"}</Link>
                  <span className="font-mono text-[10px] text-[var(--mute)]">
                    {[...new Set(p.targets.map((t) => networkFor(t.provider)?.label ?? t.provider))].join(", ")}
                    {when ? ` · ${p.publishedAt ? "" : "scheduled "}${formatZonedMoment(when, timeZone)}` : ` · ${p.status}`}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums">
                    {r ? <><b>{compact(r.clicks)}</b> clicks · {compact(r.impressions)} impr · {compact(r.engagement)} eng</> : <span className="text-[var(--mute)]">{p.status === "posted" || p.status === "partial" ? "not measured yet" : p.status}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {/* E-MEA-07: what those posts brought — GA4 sessions that landed here from social. */}
        <div className="mt-4" data-perf-visits>
          <h3 className="text-xs font-semibold m-0 mb-1">Visits it brought</h3>
          {visits.length === 0 ? (
            <p className="text-[11px] text-[var(--mute)] m-0">
              {vWindow
                ? `No visits from social landed on this article in ${formatDay(vWindow.start, "UTC")} – ${formatDay(vWindow.end, "UTC")}.`
                : "Not read yet — visits arrive with the GA4 sync (Settings → Analytics), from the links the app tags per network."}
            </p>
          ) : (
            <>
              <p className="text-[11px] text-[var(--mute)] m-0 mb-1.5"><b>{visitTotal.toLocaleString()}</b> session{visitTotal === 1 ? "" : "s"} from social, {formatDay(visits[0].windowStart, "UTC")} – {formatDay(visits[0].windowEnd, "UTC")}, from GA4.</p>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-left text-[9px] uppercase tracking-wider font-mono text-[var(--mute)]">
                    <th className="py-1 pr-3">Network</th>
                    <th className="py-1 pr-3">Campaign</th>
                    <th className="py-1 pr-3 text-right">Sessions</th>
                    <th className="py-1 text-right" title="GA4's engaged sessions: 10 seconds or more, a key event, or two page views">Engaged</th>
                  </tr>
                </thead>
                <tbody>
                  {visits.map((v) => (
                    <tr key={`${v.network}:${v.campaign ?? ""}`} className="border-t border-[var(--line)]" data-visit={`${v.network}:${v.campaign ?? ""}`}>
                      <td className="py-1 pr-3">{networkFor(v.network)?.label ?? v.network}</td>
                      <td className="py-1 pr-3">{v.campaignId ? <Link href={`/social/campaigns/${v.campaignId}`} className="underline">{v.campaignName ?? v.campaign}</Link> : v.campaign ?? <span className="text-[var(--mute)]">—</span>}</td>
                      <td className="py-1 pr-3 text-right font-mono tabular-nums">{v.sessions.toLocaleString()}</td>
                      <td className="py-1 text-right font-mono tabular-nums">{v.sessions ? `${Math.round((v.engaged / v.sessions) * 100)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
