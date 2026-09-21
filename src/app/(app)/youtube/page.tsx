import Link from "next/link";
import { ArrowUpRight, MonitorPlay, RefreshCw, Sparkles } from "lucide-react";
import { requireMembership, canEdit } from "@/lib/acl";
import { SubmitButton } from "@/components/SubmitButton";
import { AreaChart } from "@/components/charts";
import { Banner, SocialHeader } from "@/components/SocialPostCard";
import { AUDIT_WINDOWS, youtubeAuditFindings, youtubeAuditFor, type AuditFinding, type AuditWindow } from "@/lib/youtube/analytics";
import { refreshYoutubeAuditAction } from "@/app/actions/youtube-audit";
import { EmptyState } from "@/components/EmptyState";

// Measure → YouTube: the channel audit. What the workspace's own channel did
// over the window, from the YouTube Analytics API, and what to do about it.
// Every figure is measured; the one metric people expect and the API does
// not expose (impressions / CTR) is named as such rather than left blank.

type SP = { days?: string; ok?: string; err?: string };

const KIND: Record<AuditFinding["kind"], { label: string; hue: string }> = {
  win: { label: "keep doing", hue: "green" },
  fix: { label: "needs work", hue: "rose" },
  info: { label: "measured", hue: "blue" },
};

const fmt = (n: number) => n.toLocaleString("en-US");
const fmtDur = (sec: number | null) => (sec == null ? "—" : sec >= 3600 ? `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m` : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—");
const fmtVph = (v: number | null) => (v == null ? "—" : v >= 10 ? fmt(Math.round(v)) : v.toFixed(1));
const askUrl = (q: string) => `/assistant?q=${encodeURIComponent(q)}`;
const delta = (now: number, before: number): number | null => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

function Tile({ label, value, sub, d }: { label: string; value: string; sub?: string; d?: number | null }) {
  return (
    <div className="rounded-xl border border-[var(--line)] p-3 flex flex-col gap-1">
      <span className="text-[11px] text-[var(--mute)] leading-tight">{label}</span>
      <div className="flex items-baseline gap-2">
        <span className="font-mono font-bold text-2xl tabular-nums">{value}</span>
        {d != null && (
          <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: `var(--${d >= 0 ? "green" : "rose"}-soft)`, color: `var(--${d >= 0 ? "green" : "rose"}-on)` }} title="vs the previous window">
            {d >= 0 ? "▲" : "▼"} {Math.abs(d)}%
          </span>
        )}
      </div>
      {sub && <p className="text-[10px] text-[var(--mute)] leading-snug m-0">{sub}</p>}
    </div>
  );
}

export default async function YoutubeAuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { workspace, membership } = await requireMembership();
  const { days: rawDays, ok, err } = await searchParams;
  const parsed = parseInt(rawDays ?? "90", 10);
  const days: AuditWindow = (AUDIT_WINDOWS as readonly number[]).includes(parsed) ? (parsed as AuditWindow) : 90;
  const editor = canEdit(membership.role);
  const admin = membership.role === "ADMIN";
  const res = await youtubeAuditFor(workspace.id, days);

  return (
    <div className="p-6 w-full">
      <SocialHeader
        icon={<MonitorPlay className="w-6 h-6" strokeWidth={2.25} />}
        title="YouTube audit"
        blurb="Your own channel over the window: what pulled views, what held attention, what fell flat — from the YouTube Analytics API."
      >
        <div className="flex items-center gap-1">
          {AUDIT_WINDOWS.map((w) => (
            <Link key={w} href={`/youtube?days=${w}`} className={`btn sm ${w === days ? "primary" : ""}`}>{w}d</Link>
          ))}
          {editor && res.state !== "not_connected" && (
            <form action={refreshYoutubeAuditAction}>
              <input type="hidden" name="days" value={days} />
              <SubmitButton className="btn sm" pendingText="Pulling…" title="Pull fresh numbers from YouTube now (otherwise refreshed once a day)">
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </SubmitButton>
            </form>
          )}
          {res.state === "ok" && (
            <Link href={askUrl(`Audit my YouTube channel over the last ${days} days and give me a 90-day growth plan: what to make next, what to fix on the weak videos, and what to keep doing.`)} className="btn sm inline-flex items-center gap-1" title="Open the assistant with this audit — it reads the same numbers">
              <Sparkles className="w-3.5 h-3.5" /> Ask for a plan
            </Link>
          )}
        </div>
      </SocialHeader>

      {ok && <Banner kind="ok" text={ok} />}
      {err && <Banner kind="err" text={err} />}

      {res.state === "not_connected" && (
        <div className="card text-sm">
          <p className="m-0 mb-2">YouTube isn&apos;t connected for {workspace.name}. The audit reads your own channel&apos;s analytics, which needs the channel owner (or a Brand Account manager) to sign in once.</p>
          {admin ? (
            <Link href="/admin/analytics" className="btn sm primary inline-flex items-center gap-1">Connect YouTube <ArrowUpRight className="w-3.5 h-3.5" /></Link>
          ) : (
            <p className="m-0 text-xs text-[var(--mute)]">Ask an admin to connect it under Settings → Analytics.</p>
          )}
        </div>
      )}

      {res.state === "error" && (
        <div className="card text-sm">
          <p className="m-0 mb-1 font-semibold">YouTube didn&apos;t answer.</p>
          <p className="m-0 text-xs text-[var(--mute)]">{res.message}</p>
        </div>
      )}

      {res.state === "ok" && (() => {
        const a = res.audit;
        const t = a.totals, p = a.prev;
        const findings = youtubeAuditFindings(a);
        const wins = findings.filter((f) => f.kind === "win");
        const fixes = findings.filter((f) => f.kind === "fix");
        const infos = findings.filter((f) => f.kind === "info");
        const subsNet = t.subsGained - t.subsLost;
        const engagement = t.views > 0 ? ((t.likes + t.comments + t.shares) / t.views) * 100 : null;
        const shown = a.videos.slice(0, 25);
        const noData = t.views === 0 && a.videos.length === 0;

        return (
          <>
            <p className="text-xs text-[var(--mute)] mb-3">
              <a href={a.channel.url} target="_blank" rel="noopener noreferrer" className="font-semibold hover:underline">{a.channel.title}</a>
              {a.channel.subscribers != null && <> · {fmt(a.channel.subscribers)} subscribers</>}
              {a.channel.videoCount != null && <> · {fmt(a.channel.videoCount)} videos</>}
              {" · "}{day(a.start)} – {day(a.end)} (YouTube&apos;s figures lag about two days)
              {" · "}pulled {new Date(a.fetchedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{res.fromCache ? "" : " just now"}
            </p>

            {noData ? (
              <EmptyState
                line={`No views and no uploads in the last ${days} days.`}
                note="The channel is connected and answering — there is simply nothing to audit in this window."
                action={days < 365 ? { label: `Try ${days < 90 ? 90 : 365} days`, href: `/youtube?days=${days < 90 ? 90 : 365}` } : null}
              />
            ) : (
              <>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 mb-4">
                  <Tile label="Views" value={fmt(t.views)} d={delta(t.views, p.views)} sub={`${fmt(p.views)} the window before`} />
                  <Tile label="Watch time" value={`${fmt(Math.round(t.minutesWatched / 60))} h`} d={delta(t.minutesWatched, p.minutesWatched)} sub={`avg view ${fmtDur(t.avgViewSec)}`} />
                  <Tile label="Retention" value={t.avgViewPct == null ? "—" : `${Math.round(t.avgViewPct)}%`} d={t.avgViewPct != null && p.avgViewPct != null ? Math.round(t.avgViewPct - p.avgViewPct) : null} sub={p.avgViewPct != null ? `of a video watched, on average · ${Math.round(p.avgViewPct)}% before (points)` : "of a video watched, on average"} />
                  <Tile label="Subscribers, net" value={`${subsNet >= 0 ? "+" : ""}${fmt(subsNet)}`} d={delta(t.subsGained, p.subsGained)} sub={`${fmt(t.subsGained)} gained · ${fmt(t.subsLost)} lost`} />
                  <Tile label="Engagement" value={engagement == null ? "—" : `${engagement.toFixed(1)}%`} sub={`${fmt(t.likes)} likes · ${fmt(t.comments)} comments · ${fmt(t.shares)} shares, per view`} />
                  <Tile label="Uploads" value={fmt(a.uploadsInWindow)} d={delta(a.uploadsInWindow, a.uploadsPrev)} sub={a.lastUploadAt ? `last on ${day(a.lastUploadAt)}` : "none seen"} />
                </div>

                {a.daily.length >= 2 && (
                  <div className="card mb-4">
                    <AreaChart points={a.daily.map((d) => ({ label: day(d.date), value: d.views }))} color="var(--rose)" title={`Daily views — last ${days} days`} />
                  </div>
                )}

                <div className="grid gap-3 lg:grid-cols-2 mb-4">
                  {[{ title: "What needs work", list: fixes, empty: "Nothing measured in this window fell below the channel's own bar — findings need enough videos and a previous window to compare against, so a young channel shows none either way." }, { title: "What to keep doing", list: [...wins, ...infos], empty: "Not enough measured videos yet to say what is working." }].map((col) => (
                    <section key={col.title}>
                      <h2 className="font-mono text-[13px] font-bold mb-2">{col.title}</h2>
                      {col.list.length === 0 ? (
                        <div className="card text-xs text-[var(--mute)]">{col.empty}</div>
                      ) : (
                        col.list.map((f, i) => (
                          <div key={i} className="card mb-2">
                            <div className="flex items-start gap-2">
                              <h3 className="text-sm font-semibold flex-1 m-0">{f.title}</h3>
                              <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0" style={{ background: `var(--${KIND[f.kind].hue}-soft)`, color: `var(--${KIND[f.kind].hue}-on)` }}>{KIND[f.kind].label}</span>
                            </div>
                            <p className="text-xs text-[var(--mute)] mt-1 mb-0">{f.detail}</p>
                            {f.videos && f.videos.length > 0 && (
                              <ul className="mt-2 mb-0 pl-0 list-none flex flex-col gap-1">
                                {f.videos.map((v) => (
                                  <li key={v.id} className="text-xs flex items-baseline gap-2">
                                    <a href={v.url} target="_blank" rel="noopener noreferrer" className="font-semibold hover:underline truncate">{v.title}</a>
                                    <span className="font-mono text-[10px] text-[var(--mute)] shrink-0">{v.note}</span>
                                    {f.kind === "fix" && (
                                      <Link href={askUrl(`My YouTube video "${v.title}" (${v.id}) is under-performing: ${v.note}. Suggest five stronger titles and a thumbnail direction, in my channel's voice.`)} className="text-[10px] shrink-0 hover:underline" style={{ color: "var(--accent)" }} title="Ask the assistant for titles and a thumbnail direction">
                                        fix it →
                                      </Link>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ))
                      )}
                    </section>
                  ))}
                </div>

                <h2 className="font-mono text-[13px] font-bold mb-2">Videos in the window <span className="text-[var(--mute)] font-normal">({a.videos.length}{a.videos.length === 200 ? ", API cap" : ""})</span></h2>
                <div className="card overflow-x-auto mb-3">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="text-left text-[var(--mute)]">
                        {[["Video"], ["Published"], ["Type"], ["Views", "Views inside the window"], ["Views/hr", "Lifetime views divided by hours since publish"], ["Watched", "Average percentage of the video watched"], ["Avg view"], ["Likes"], ["Comments"], ["Subs +"]].map(([h, tip], i) => (
                          <th key={h} title={tip} className={`py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)] ${i >= 3 ? "text-right" : ""}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((v) => (
                        <tr key={v.id} className="odd:bg-[var(--zebra)]">
                          <td className="py-1.5 px-2 border-b border-[var(--line)] max-w-[320px]"><a href={v.url} target="_blank" rel="noopener noreferrer" className="font-semibold hover:underline line-clamp-1">{v.title}</a></td>
                          <td className="py-1.5 px-2 border-b border-[var(--line)] whitespace-nowrap">{day(v.publishedAt)}{v.inWindow && <span className="ml-1 font-mono text-[9px] px-1 rounded" style={{ background: "var(--blue-soft)", color: "var(--blue-on)" }}>new</span>}</td>
                          <td className="py-1.5 px-2 border-b border-[var(--line)]">{v.isShort == null ? "—" : v.isShort ? "Short" : fmtDur(v.durationSec)}</td>
                          <td className="py-1.5 px-2 border-b border-[var(--line)] text-right font-mono tabular-nums">{fmt(v.views)}</td>
                          <td className="py-1.5 px-2 border-b border-[var(--line)] text-right font-mono tabular-nums" title={v.lifetimeViews != null ? `${fmt(v.lifetimeViews)} lifetime views` : "no lifetime count"}>{fmtVph(v.viewsPerHour)}</td>
                          <td className="py-1.5 px-2 border-b border-[var(--line)] text-right font-mono tabular-nums">{v.avgViewPct == null ? "—" : `${Math.round(v.avgViewPct)}%`}</td>
                          <td className="py-1.5 px-2 border-b border-[var(--line)] text-right font-mono tabular-nums">{fmtDur(v.avgViewSec)}</td>
                          <td className="py-1.5 px-2 border-b border-[var(--line)] text-right font-mono tabular-nums">{fmt(v.likes)}</td>
                          <td className="py-1.5 px-2 border-b border-[var(--line)] text-right font-mono tabular-nums">{fmt(v.comments)}</td>
                          <td className="py-1.5 px-2 border-b border-[var(--line)] text-right font-mono tabular-nums">{fmt(v.subsGained)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {a.videos.length > shown.length && <p className="text-[11px] text-[var(--mute)] mt-2 mb-0">Top {shown.length} of {a.videos.length} by views. Ask the assistant for the rest.</p>}
                </div>
                <p className="text-[11px] text-[var(--mute)]">
                  Not on this page because YouTube doesn&apos;t expose them: impressions and impressions click-through rate (YouTube Studio only), and estimated revenue (a separate monetary consent the connection doesn&apos;t ask for). Everything above is measured; a dash means YouTube reported no figure, not zero.
                </p>
              </>
            )}
          </>
        );
      })()}
    </div>
  );
}
