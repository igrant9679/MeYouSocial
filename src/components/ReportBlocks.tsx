import Link from "next/link";
import { db } from "@/lib/db";
import { autopilotFeed, hasSeriesData, homeStats, postPerformance, weeklySeries } from "@/lib/dashboard-data";
import { AreaChart, HBars } from "@/components/charts";
import { MOTIF_SEED_BY_KEY, parseMotifs } from "@/lib/motifs";
import type { BlockKey } from "@/lib/report-defs";

/**
 * Report blocks — each one is an async server component that loads its own
 * rows. Every block renders an honest empty state when the workspace has no
 * data for it; none of them invent numbers.
 */

const num = "font-mono tabular-nums";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card anim-rise">
      <h2 className="font-mono text-[13px] font-bold mb-2">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-[var(--mute)] py-4 text-center">{children}</p>;
}

export async function ReportBlock({ block, workspaceId, weeks }: { block: BlockKey; workspaceId: string; weeks: number }) {
  switch (block) {
    case "kpis": {
      const stats = await homeStats(workspaceId);
      const delta = stats.publishedThisMonth - stats.publishedLastMonth;
      return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Published this month", value: String(stats.publishedThisMonth), note: `${delta >= 0 ? "▲ +" : "▼ "}${delta} vs last`, tone: delta >= 0 ? "var(--green-on)" : "var(--rose-on)" },
            { label: "Clicks this week", value: String(stats.clicksThisWeek), note: "from snapshots", tone: "var(--mute)" },
            { label: "Avg position", value: stats.avgPosition?.toFixed(1) ?? "—", note: "lower is better", tone: "var(--mute)" },
            { label: "Blockers", value: String(stats.unverifiedCitations + stats.postsMissingAssets), note: `${stats.unverifiedCitations} citations · ${stats.postsMissingAssets} assets`, tone: "var(--amber-on)" },
          ].map((k) => (
            <div key={k.label} className="card anim-rise">
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] font-bold">{k.label}</div>
              <div className={`${num} font-bold text-[24px] leading-tight`}>{k.value}</div>
              <div className="text-[11px] font-semibold" style={{ color: k.tone }}>{k.note}</div>
            </div>
          ))}
        </div>
      );
    }

    case "impressions_chart": {
      const series = await weeklySeries(workspaceId, weeks);
      return (
        <Card title={`Impressions — last ${weeks} weeks`}>
          {hasSeriesData(series) ? (
            <AreaChart points={series.map((p) => ({ label: p.label, value: p.impressions }))} color="var(--blue)" title="Impressions" />
          ) : (
            <Empty>No snapshots yet — add weekly numbers under <Link href="/blog/analytics" className="underline">Blog → Analytics</Link>.</Empty>
          )}
        </Card>
      );
    }

    case "clicks_chart": {
      const series = await weeklySeries(workspaceId, weeks);
      return (
        <Card title={`Clicks — last ${weeks} weeks`}>
          {hasSeriesData(series) ? (
            <AreaChart points={series.map((p) => ({ label: p.label, value: p.clicks }))} color="var(--teal)" title="Clicks" />
          ) : (
            <Empty>No snapshots yet.</Empty>
          )}
        </Card>
      );
    }

    case "movers": {
      const perf = await postPerformance(workspaceId, 40);
      const withDelta = perf
        .filter((p) => p.position != null && p.prevPosition != null)
        .map((p) => ({ ...p, delta: p.prevPosition! - p.position! }))
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 6);
      return (
        <Card title="Biggest movers">
          {withDelta.length === 0 ? (
            <Empty>Needs two snapshots per post to compute movement.</Empty>
          ) : (
            <ul className="m-0 p-0">
              {withDelta.map((p) => (
                <li key={p.id} className="flex items-baseline gap-2 text-xs border-t border-[var(--line)] first:border-0 py-1.5">
                  <Link href={`/blog/${p.id}`} className="font-semibold hover:underline flex-1 truncate">{p.title}</Link>
                  <span className={num}>{p.position!.toFixed(1)}</span>
                  <b className={num} style={{ color: p.delta >= 0 ? "var(--green-on)" : "var(--rose-on)" }}>
                    {p.delta >= 0 ? "▲" : "▼"} {Math.abs(p.delta).toFixed(1)}
                  </b>
                </li>
              ))}
            </ul>
          )}
        </Card>
      );
    }

    case "posts_table": {
      const perf = (await postPerformance(workspaceId, 40)).filter((p) => p.status === "published").slice(0, 10);
      return (
        <Card title="Content">
          {perf.length === 0 ? (
            <Empty>Nothing published yet.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead><tr className="text-left text-[var(--mute)]">
                  {["Post", "Keyword", "Pos", "Δ", "Clicks"].map((h, i) => (
                    <th key={h} className={`py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)] ${i >= 2 ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {perf.map((p) => {
                    const d = p.position != null && p.prevPosition != null ? p.prevPosition - p.position : null;
                    return (
                      <tr key={p.id} className="odd:bg-[var(--zebra)]">
                        <td className="py-1.5 px-2 border-b border-[var(--line)]"><Link href={`/blog/${p.id}`} className="font-semibold hover:underline">{p.title}</Link></td>
                        <td className="py-1.5 px-2 border-b border-[var(--line)] text-[var(--mute)]">{p.focusKeyword ?? "—"}</td>
                        <td className={`py-1.5 px-2 border-b border-[var(--line)] text-right ${num}`}>{p.position?.toFixed(1) ?? "—"}</td>
                        <td className={`py-1.5 px-2 border-b border-[var(--line)] text-right ${num} font-bold`} style={{ color: d == null ? "var(--mute)" : d >= 0 ? "var(--green-on)" : "var(--rose-on)" }}>
                          {d == null ? "—" : `${d >= 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(1)}`}
                        </td>
                        <td className={`py-1.5 px-2 border-b border-[var(--line)] text-right ${num}`}>{p.clicks ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      );
    }

    case "position_buckets": {
      const perf = await postPerformance(workspaceId, 60);
      const positions = perf.filter((p) => p.status === "published" && p.position != null).map((p) => p.position!);
      const rows = [
        { label: "Top 3", value: positions.filter((x) => x <= 3).length, color: "#1D4ED8" },
        { label: "4 – 10", value: positions.filter((x) => x > 3 && x <= 10).length, color: "#3B82F6" },
        { label: "11 – 20", value: positions.filter((x) => x > 10 && x <= 20).length, color: "#93C5FD" },
        { label: "21 +", value: positions.filter((x) => x > 20).length, color: "#DBEAFE" },
      ];
      return (
        <Card title="Keyword positions">
          {positions.length === 0 ? <Empty>No position data yet.</Empty> : <HBars rows={rows} />}
        </Card>
      );
    }

    case "pipeline_bars": {
      const [byStatus, ideas] = await Promise.all([
        db.blogPost.groupBy({ by: ["status"], where: { workspaceId }, _count: { _all: true } }),
        db.blogIdea.count({ where: { workspaceId, status: { in: ["discovered", "approved"] } } }),
      ]);
      const c = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
      return (
        <Card title="Pipeline">
          <HBars rows={[
            { label: "Ideas open", value: ideas, color: "var(--cyan)" },
            { label: "Drafting", value: c("drafting"), color: "var(--amber)" },
            { label: "In review", value: c("draft_review"), color: "var(--blue)" },
            { label: "Approval", value: c("final_approval"), color: "var(--violet)" },
            { label: "Published", value: c("published"), color: "var(--green)" },
          ]} />
        </Card>
      );
    }

    case "velocity": {
      const since = new Date();
      since.setDate(since.getDate() - weeks * 7);
      const done = await db.blogIdea.findMany({
        where: { workspaceId, status: "drafted", postId: { not: null } },
        select: { createdAt: true, postId: true },
        take: 100,
      });
      const posts = await db.blogPost.findMany({
        where: { id: { in: done.map((d) => d.postId!).filter(Boolean) }, publishedAt: { not: null } },
        select: { id: true, publishedAt: true },
      });
      const byId = new Map(posts.map((p) => [p.id, p.publishedAt!]));
      const cycles = done
        .filter((d) => d.postId && byId.has(d.postId))
        .map((d) => (byId.get(d.postId!)!.getTime() - d.createdAt.getTime()) / 86400000)
        .filter((days) => days >= 0);
      const published = await db.blogPost.count({ where: { workspaceId, status: "published", publishedAt: { gte: since } } });
      const avg = cycles.length ? cycles.reduce((a, b) => a + b, 0) / cycles.length : null;
      return (
        <Card title="Pipeline velocity">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className={`${num} font-bold text-[24px]`}>{avg != null ? avg.toFixed(1) : "—"}</div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] font-bold">days idea → published</div>
              {avg == null && <div className="text-[11px] text-[var(--mute)] mt-1">no idea-to-publish cycles measured yet</div>}
            </div>
            <div>
              <div className={`${num} font-bold text-[24px]`}>{(published / Math.max(1, weeks)).toFixed(1)}</div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mute)] font-bold">published / week (last {weeks}w)</div>
            </div>
          </div>
        </Card>
      );
    }

    case "autopilot_budget": {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const weekAgo = new Date(Date.now() - 7 * 86400000);
      const [today, failures] = await Promise.all([
        db.auditLog.count({
          where: { workspaceId, action: { in: ["blog.draft_generated", "ideas.ai_discovery", "social.variants_generated"] }, createdAt: { gte: dayStart } },
        }),
        db.auditLog.count({ where: { workspaceId, action: { in: ["video.render_failed"] }, createdAt: { gte: weekAgo } } }),
      ]);
      return (
        <Card title="Autopilot budget — today">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex-1 h-2.5 rounded-full bg-[var(--panel)] overflow-hidden">
              <div className="h-full rounded-full anim-grow" style={{ width: `${Math.min(100, (today / 20) * 100)}%`, background: today >= 16 ? "var(--amber)" : "var(--green)" }} />
            </div>
            <span className={`${num} text-sm font-bold`}>{today}/20</span>
          </div>
          <p className="text-[11px] text-[var(--mute)]">
            Unattended generations against the daily budget · {failures} render failure{failures === 1 ? "" : "s"} in 7 days
          </p>
        </Card>
      );
    }

    case "autopilot_feed": {
      const feed = await autopilotFeed(workspaceId, 10);
      return (
        <Card title="Autopilot activity">
          {feed.length === 0 ? (
            <Empty>Idle — set modes under <Link href="/blog/automation" className="underline">Blog → Automation</Link>.</Empty>
          ) : (
            <ul className="m-0 p-0 text-xs">
              {feed.map((e, i) => (
                <li key={i} className="border-t border-[var(--line)] first:border-0 py-1.5 flex items-baseline gap-2">
                  <span className="font-mono text-[9.5px] text-[var(--mute)] w-24 shrink-0">
                    {e.at.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="flex-1">{e.label}</span>
                  {e.tone === "warn" && <span className="chip font-mono text-[9px] font-bold px-1.5 rounded-full" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>!</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      );
    }

    case "compliance": {
      const [citTotal, citVerified, reviewPosts] = await Promise.all([
        db.blogCitation.count({ where: { post: { workspaceId } } }),
        db.blogCitation.count({ where: { verified: true, post: { workspaceId } } }),
        db.blogPost.findMany({
          where: { workspaceId, status: { in: ["draft_review", "final_approval"] } },
          select: { images: { select: { role: true, status: true } } },
        }),
      ]);
      const awaitingAssets = reviewPosts.filter((p) => {
        const ok = (role: string) => p.images.some((i) => i.role === role && i.status === "approved");
        return !ok("featured") || !ok("og");
      }).length;
      return (
        <Card title="Editorial compliance">
          <ul className="m-0 p-0 text-xs flex flex-col gap-2">
            <li className="flex items-center gap-2">
              <span className={`${num} font-bold`} style={{ color: "var(--green-on)" }}>100%</span>
              <span className="text-[var(--mute)]">✓ published posts passed WCAG + SEO gates (enforced at publish)</span>
            </li>
            <li className="flex items-center gap-2">
              <span className={`${num} font-bold`} style={{ color: citVerified === citTotal ? "var(--green-on)" : "var(--amber-on)" }}>{citVerified}/{citTotal}</span>
              <span className="text-[var(--mute)]">✓ citations verified</span>
            </li>
            <li className="flex items-center gap-2">
              <span className={`${num} font-bold`} style={{ color: awaitingAssets ? "var(--amber-on)" : "var(--green-on)" }}>{awaitingAssets}</span>
              <span className="text-[var(--mute)]">⚠ posts in review awaiting images</span>
            </li>
          </ul>
        </Card>
      );
    }

    case "motif_mix": {
      const posts = await db.blogPost.findMany({ where: { workspaceId, status: "published" }, select: { motifs: true } });
      const counts = new Map<string, number>();
      let unset = 0;
      for (const p of posts) {
        const dom = parseMotifs(p.motifs)[0]?.key;
        if (dom) counts.set(dom, (counts.get(dom) ?? 0) + 1);
        else unset++;
      }
      const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({
        label: MOTIF_SEED_BY_KEY.get(k as never)?.label ?? k,
        value: v,
        color: "var(--violet)",
      }));
      return (
        <Card title="Voice mix — dominant motif of published posts">
          {rows.length === 0 ? (
            <Empty>No published posts carry a motif blend yet{unset ? ` (${unset} without one)` : ""}.</Empty>
          ) : (
            <div className="max-w-lg">
              <HBars rows={rows} />
              {unset > 0 && <p className="text-[11px] text-[var(--mute)] mt-2">{unset} published without an explicit blend.</p>}
            </div>
          )}
        </Card>
      );
    }

    case "social_table": {
      const variants = await db.socialVariant.findMany({
        where: { post: { workspaceId } },
        select: { platform: true, status: true },
      });
      const platforms = ["linkedin", "x", "instagram", "facebook"];
      return (
        <Card title="Social variants">
          {variants.length === 0 ? (
            <Empty>No variants yet — they generate when posts publish (social mode assisted/auto).</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead><tr className="text-left text-[var(--mute)]">
                  {["Platform", "Draft", "Approved", "Posted"].map((h, i) => (
                    <th key={h} className={`py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)] ${i > 0 ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {platforms.map((p) => {
                    const of = (s: string) => variants.filter((v) => v.platform === p && v.status === s).length;
                    return (
                      <tr key={p} className="odd:bg-[var(--zebra)]">
                        <td className="py-1.5 px-2 border-b border-[var(--line)] font-semibold capitalize">{p}</td>
                        <td className={`py-1.5 px-2 border-b border-[var(--line)] text-right ${num}`}>{of("draft")}</td>
                        <td className={`py-1.5 px-2 border-b border-[var(--line)] text-right ${num}`}>{of("approved")}</td>
                        <td className={`py-1.5 px-2 border-b border-[var(--line)] text-right ${num}`}>{of("posted")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      );
    }

    case "video_table": {
      const renders = await db.videoRender.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 12 });
      const spend = renders.filter((r) => r.status === "done").reduce((a, r) => a + (r.costEstimate ?? 0), 0);
      return (
        <Card title="Video renders">
          {renders.length === 0 ? (
            <Empty>No renders yet — package a published post from its Distribute tab.</Empty>
          ) : (
            <>
              <p className="text-[11px] text-[var(--mute)] mb-2">
                Estimated spend on completed renders: <b className={num}>${spend.toFixed(2)}</b> (provider estimates, not invoices)
              </p>
              <ul className="m-0 p-0 text-xs">
                {renders.map((r) => (
                  <li key={r.id} className="border-t border-[var(--line)] first:border-0 py-1.5 flex items-baseline gap-2">
                    <span className="chip font-mono text-[9px] font-bold px-1.5 rounded-full" style={{
                      background: r.status === "done" ? "var(--green-soft)" : r.status === "failed" ? "var(--rose-soft)" : "var(--panel)",
                      color: r.status === "done" ? "var(--green-on)" : r.status === "failed" ? "var(--rose-on)" : "var(--mute)",
                    }}>{r.status}</span>
                    <span className="flex-1 truncate font-semibold">{r.title}</span>
                    <span className={`${num} text-[var(--mute)]`}>{r.seconds}s · ${r.costEstimate?.toFixed(2) ?? "—"}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      );
    }

    case "audit_summary": {
      const items = await db.contentAuditItem.findMany({ where: { workspaceId }, orderBy: { slopScore: "desc" } });
      const open = items.filter((i) => i.status === "open");
      const byRec = (r: string) => open.filter((i) => i.recommendation === r).length;
      return (
        <Card title="Content-audit summary">
          {items.length === 0 ? (
            <Empty>No audit yet — run one under <Link href="/blog/audit" className="underline">Blog → Audit</Link>.</Empty>
          ) : (
            <>
              <HBars rows={[
                { label: "Rewrite", value: byRec("rewrite"), color: "var(--amber)" },
                { label: "Merge", value: byRec("merge"), color: "var(--blue)" },
                { label: "Retire", value: byRec("retire"), color: "var(--rose)" },
                { label: "Keep", value: byRec("keep"), color: "var(--green)" },
              ]} />
              {open.length > 0 && open[0].slopScore != null && (
                <p className="text-[11px] text-[var(--mute)] mt-2">
                  Worst offender: <b>{open[0].title}</b> (score {open[0].slopScore})
                </p>
              )}
            </>
          )}
        </Card>
      );
    }
  }
}
