import Link from "next/link";
import { notFound } from "next/navigation";
import { Megaphone } from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { getPostingTimeZone } from "@/lib/social/slots";
import { byNetwork, latestPerTarget } from "@/lib/social/performance";
import { compact, resultsForPosts } from "@/lib/social/post-results";
import { networkFor } from "@/lib/social/networks";
import { formatZonedMoment } from "@/lib/zoned-dates";
import { requestNow } from "@/lib/request-time";

// A campaign's own page (E-SOC-21): what's in it by state, a calendar of its
// posts around today, what each network brought it, and its best posts. The
// numbers are the latest reading per network (performance.ts), summed.

const DAY = 86_400_000;
const STATES = [
  { key: "draft", label: "Drafts" },
  { key: "scheduled", label: "Scheduled" },
  { key: "posted", label: "Sent" },
  { key: "partial", label: "Partly sent" },
  { key: "failed", label: "Failed" },
] as const;
const CHIP: Record<string, string> = { draft: "var(--slate)", scheduled: "var(--blue)", publishing: "var(--blue)", posted: "var(--green)", partial: "var(--amber)", failed: "var(--rose)" };

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await requireMembership();
  const campaign = await db.campaign.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!campaign) notFound();
  const [tz, posts, snaps] = await Promise.all([
    getPostingTimeZone(workspace.id),
    db.socialPost.findMany({
      where: { workspaceId: workspace.id, campaignId: campaign.id },
      orderBy: [{ scheduledAt: "asc" }, { publishedAt: "asc" }],
      select: { id: true, text: true, status: true, scheduledAt: true, publishedAt: true, createdAt: true, targets: { select: { provider: true } } },
    }),
    db.socialSnapshot.findMany({
      where: { target: { post: { campaignId: campaign.id, workspaceId: workspace.id } } },
      select: { targetId: true, capturedAt: true, impressions: true, reach: true, likes: true, comments: true, shares: true, saves: true, clicks: true, views: true, target: { select: { provider: true, postId: true } } },
    }),
  ]);
  const networks = byNetwork(latestPerTarget(snaps));
  const results = await resultsForPosts(posts.map((p) => p.id));
  const total = (pick: (n: (typeof networks)[number]) => number | null) => {
    const v = networks.map(pick).filter((n): n is number => n != null);
    return v.length ? v.reduce((a, b) => a + b, 0) : null;
  };
  const count = (k: string) => posts.filter((p) => p.status === k).length;
  const best = posts
    .map((p) => ({ p, r: results.get(p.id) }))
    .filter((x) => x.r?.engagement != null)
    .sort((a, b) => (b.r!.engagement ?? 0) - (a.r!.engagement ?? 0))
    .slice(0, 5);
  const color = /^#[0-9a-fA-F]{6}$/.test(campaign.color ?? "") ? campaign.color! : "var(--blue)";

  // The calendar: six weeks from the Monday two weeks back, in the posting zone.
  const local = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const [ty, tm, td] = local(new Date(requestNow())).split("-").map(Number);
  const todayUtc = Date.UTC(ty, tm - 1, td);
  const monday = todayUtc - ((new Date(todayUtc).getUTCDay() + 6) % 7) * DAY - 14 * DAY;
  const days = Array.from({ length: 42 }, (_, i) => new Date(monday + i * DAY).toISOString().slice(0, 10));
  const byDay = new Map<string, typeof posts>();
  for (const p of posts) {
    const when = p.publishedAt ?? p.scheduledAt;
    if (!when) continue;
    const k = local(when);
    byDay.set(k, [...(byDay.get(k) ?? []), p]);
  }
  const todayKey = new Date(todayUtc).toISOString().slice(0, 10);
  const undated = posts.filter((p) => !p.publishedAt && !p.scheduledAt);

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <Megaphone className="w-5 h-5" style={{ color: "var(--blue-on)" }} />
        <h1 className="font-mono text-[22px] font-bold m-0 flex items-center gap-2">
          <span className="w-3 h-3 rounded-full inline-block" style={{ background: color }} /> {campaign.name}
        </h1>
        {campaign.status === "archived" && <span className="font-mono text-[10px] px-2 py-0.5 rounded-full" style={{ background: "var(--zebra)", color: "var(--mute)" }}>archived</span>}
        {campaign.utmCampaign && <span className="font-mono text-[11px] text-[var(--mute)]">utm_campaign={campaign.utmCampaign}</span>}
        <span className="flex-1" />
        <Link href="/setup/schedule" className="text-xs underline text-[var(--mute)]">All campaigns</Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4" data-campaign-counts>
        {STATES.map((s) => (
          <div key={s.key} className="card !p-3" data-campaign-count={s.key}>
            <div className="text-[10px] uppercase tracking-wider font-mono text-[var(--mute)]">{s.label}</div>
            <div className="font-mono text-xl font-bold tabular-nums">{count(s.key)}</div>
          </div>
        ))}
      </div>

      <section className="card mb-4" data-campaign-calendar>
        <h2 className="text-sm font-semibold mb-2">Calendar <span className="font-normal text-xs text-[var(--mute)]">— two weeks back, four ahead ({tz})</span></h2>
        <div className="grid grid-cols-7 gap-1 text-[10px] font-mono text-[var(--mute)] mb-1">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="px-1">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((k) => {
            const items = byDay.get(k) ?? [];
            return (
              <div key={k} className="min-h-16 rounded-md border p-1 flex flex-col gap-0.5 overflow-hidden" style={{ borderColor: k === todayKey ? "var(--accent)" : "var(--line)", background: k < todayKey ? "var(--zebra)" : undefined }} data-campaign-day={k}>
                <span className="text-[10px] font-mono text-[var(--mute)]">{Number(k.slice(8))}{k.slice(8) === "01" || k === days[0] ? ` ${new Date(`${k}T00:00:00Z`).toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}` : ""}</span>
                {items.slice(0, 3).map((p) => (
                  <Link key={p.id} href={`/social/${p.id}`} className="block truncate text-[10px] rounded px-1 text-white" style={{ background: CHIP[p.status] ?? "var(--slate)" }} title={`${p.status} · ${p.text.slice(0, 120)}`} data-campaign-post={p.id}>
                    {p.text.slice(0, 40) || "(no text)"}
                  </Link>
                ))}
                {items.length > 3 && <span className="text-[10px] text-[var(--mute)]">+{items.length - 3} more</span>}
              </div>
            );
          })}
        </div>
        {undated.length > 0 && <p className="text-[11px] text-[var(--mute)] mt-2 mb-0">{undated.length} draft{undated.length === 1 ? "" : "s"} with no date yet — on <Link href="/social/drafts" className="underline">Drafts</Link>.</p>}
      </section>

      <section className="card mb-4" data-campaign-networks>
        <h2 className="text-sm font-semibold mb-0.5">By network</h2>
        <p className="text-xs text-[var(--mute)] mt-0 mb-2">The latest reading of each post on each network, summed. A dash is not measured, never zero.</p>
        {networks.length === 0 ? (
          <p className="text-xs text-[var(--mute)] m-0">No results measured yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-[var(--mute)]">
                  {["Network", "Posts", "Impressions", "Engagement", "Clicks", "Eng. rate"].map((h) => <th key={h} className="py-1.5 px-2 font-mono text-[9px] uppercase tracking-wider border-b-2 border-[var(--line)]">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {networks.map((n) => (
                  <tr key={n.provider} className="odd:bg-[var(--zebra)]" data-campaign-network={n.provider}>
                    <td className="py-1.5 px-2 border-b border-[var(--line)]">{networkFor(n.provider)?.label ?? n.provider}</td>
                    <td className="py-1.5 px-2 border-b border-[var(--line)] font-mono tabular-nums">{n.posts}</td>
                    <td className="py-1.5 px-2 border-b border-[var(--line)] font-mono tabular-nums">{compact(n.impressions)}</td>
                    <td className="py-1.5 px-2 border-b border-[var(--line)] font-mono tabular-nums">{compact(n.engagement)}</td>
                    <td className="py-1.5 px-2 border-b border-[var(--line)] font-mono tabular-nums">{compact(n.clicks)}</td>
                    <td className="py-1.5 px-2 border-b border-[var(--line)] font-mono tabular-nums">{n.engagementRate == null ? "—" : `${n.engagementRate}%`}</td>
                  </tr>
                ))}
                <tr className="font-semibold" data-campaign-total>
                  <td className="py-1.5 px-2">All networks</td>
                  <td className="py-1.5 px-2 font-mono tabular-nums">{networks.reduce((a, n) => a + n.posts, 0)}</td>
                  <td className="py-1.5 px-2 font-mono tabular-nums">{compact(total((n) => n.impressions))}</td>
                  <td className="py-1.5 px-2 font-mono tabular-nums">{compact(total((n) => n.engagement))}</td>
                  <td className="py-1.5 px-2 font-mono tabular-nums">{compact(total((n) => n.clicks))}</td>
                  <td className="py-1.5 px-2" />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" data-campaign-best>
        <h2 className="text-sm font-semibold mb-2">Best posts</h2>
        {best.length === 0 ? (
          <p className="text-xs text-[var(--mute)] m-0">None measured yet.</p>
        ) : (
          <ol className="m-0 pl-5 flex flex-col gap-1.5 text-xs">
            {best.map(({ p, r }) => (
              <li key={p.id} data-campaign-best-post={p.id}>
                <Link href={`/social/${p.id}`} className="hover:underline">{p.text.slice(0, 120) || "(no text)"}</Link>
                <span className="font-mono text-[10px] text-[var(--mute)]"> · {[...new Set(p.targets.map((t) => networkFor(t.provider)?.label ?? t.provider))].join(", ")}{p.publishedAt ? ` · ${formatZonedMoment(p.publishedAt, tz)}` : ""} · <b>{compact(r!.engagement)}</b> eng · {compact(r!.clicks)} clicks</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
