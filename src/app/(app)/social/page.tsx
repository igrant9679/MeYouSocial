import Link from "next/link";
import {
  Share2, AlertTriangle, Info, CalendarClock, Send, Plug, Clock, BarChart3, Sparkles, ExternalLink, Check,
} from "lucide-react";
import { requireRole, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { getSocialOverview, type AttentionItem } from "@/lib/social/overview";
import { readingsForWorkspace, byNetwork } from "@/lib/social/performance";
import { networkFor } from "@/lib/social/networks";
import { Banner, SocialHeader } from "@/components/SocialPostCard";

// Social command centre. Answers three questions in order, because that's the
// order they matter in: is the plumbing connected, what needs a decision, and
// what is about to happen.
//
// ⚠ Truthfulness spine: nothing on this page is estimated. Engagement that has
// never been synced renders as a dash with the reason, not a zero — a zero here
// would read as "nobody engaged" when it means "we haven't asked yet".

type SP = { ok?: string; err?: string };

const DAY = 24 * 60 * 60 * 1000;

export default async function SocialOverviewPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { workspace, membership } = await requireRole("EDITOR");
  const { ok, err } = await searchParams;
  const isAdmin = canAdmin(membership.role);

  const [overview, readings, upcoming, recent, dials] = await Promise.all([
    getSocialOverview(workspace.id),
    readingsForWorkspace(workspace.id, new Date(Date.now() - 30 * DAY)),
    db.socialPost.findMany({
      where: { workspaceId: workspace.id, status: "scheduled", scheduledAt: { gte: new Date() } },
      orderBy: { scheduledAt: "asc" },
      take: 6,
      select: {
        id: true, text: true, scheduledAt: true, approval: true,
        campaign: { select: { name: true } },
        targets: { select: { id: true, provider: true } },
      },
    }),
    db.socialPost.findMany({
      where: { workspaceId: workspace.id, status: { in: ["posted", "partial", "failed"] } },
      orderBy: { publishedAt: "desc" },
      take: 5,
      select: {
        id: true, text: true, status: true, publishedAt: true,
        targets: { select: { id: true, provider: true, status: true, platformPostUrl: true } },
      },
    }),
    Promise.all([
      getSetting("social:autogen", workspace.id).catch(() => "").then((v) => v === "true"),
      getSetting("social:autogen_weekly", workspace.id).catch(() => "").then((v) => parseInt(v, 10) || 5),
      getSetting("social:evergreen_fill", workspace.id).catch(() => "").then((v) => v === "true"),
      getSetting("social:auto_image", workspace.id).catch(() => "").then((v) => v !== "false"),
      getSetting("social:require_approval", workspace.id).catch(() => "").then((v) => v === "true"),
      getSetting("social:utm_enabled", workspace.id).catch(() => "").then((v) => v === "true"),
    ]),
  ]);
  const [autogenOn, autogenWeekly, evergreenFill, autoImage, requireApproval, utmOn] = dials;
  const networks = byNetwork(readings);
  const hasEngagement = networks.length > 0;
  // "Needs you" is things that are broken or blocking; "Worth knowing" is
  // everything else the page surfaces. Mixing them makes the urgent ones
  // easier to scroll past.
  const warn = overview.attention.filter((a) => a.severity === "warn");
  const info = overview.attention.filter((a) => a.severity === "info");

  return (
    <div className="p-6 w-full">
      <SocialHeader
        icon={<Share2 className="w-6 h-6" strokeWidth={2.25} />}
        title="Social"
        blurb="What's connected, what needs you, and what goes out next."
      >
        <Link href="/social/compose" className="btn sm primary">New post</Link>
      </SocialHeader>

      {ok && <Banner kind="ok" text={ok} />}
      {err && <Banner kind="err" text={err} />}

      {/* ── Health ─────────────────────────────────────────────────────────── */}
      <div className="card mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Plug className="w-4 h-4" style={{ color: "var(--purple-on)" }} />
          <h2 className="font-mono font-bold text-sm">Connected</h2>
          <span className="flex-1" />
          <Link href="/admin/connections" className="btn sm">Manage accounts</Link>
        </div>

        {overview.accounts.length === 0 ? (
          <p className="text-xs text-[var(--mute)]">
            No accounts yet. Connect them from{" "}
            <Link href="/admin/connections" className="underline">Admin → Connections</Link> — use this app&apos;s
            Connect buttons, not Zernio&apos;s dashboard.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {overview.accounts.map((a) => {
              // Colour by TROUBLE, not by our mirrored status: an account can
              // be "connected" here and still be refusing to publish, which is
              // exactly the state that used to be invisible.
              const bad = a.trouble?.severity === "warn";
              const meh = a.trouble?.severity === "info";
              const hue = bad ? "var(--rose)" : meh ? "var(--amber)" : a.color;
              return (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1.5 text-[11px] font-mono px-2 py-1 rounded-full border"
                  style={{
                    borderColor: hue,
                    background: bad ? "var(--rose-soft)" : "transparent",
                    color: bad ? "var(--rose-on)" : "var(--slate)",
                  }}
                  title={
                    a.trouble
                      ? `${a.name} — ${a.trouble.reason}.`
                      : `${a.name} · ${a.scheduledAhead} scheduled leg${a.scheduledAhead === 1 ? "" : "s"} in the next 7 days` +
                        // Shown, but never alerted on — see troubleWith().
                        (a.tokenExpiresAt ? ` · token renews by ${a.tokenExpiresAt.toISOString().slice(0, 16).replace("T", " ")}Z` : "")
                  }
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: hue }} />
                  {a.label}
                  {bad && <AlertTriangle className="w-3 h-3" />}
                  {!a.trouble && a.scheduledAhead > 0 && (
                    <span className="text-[9.5px] text-[var(--mute)]">{a.scheduledAhead}</span>
                  )}
                </span>
              );
            })}
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Next send"
            value={overview.nextSend ? overview.nextSend.label : null}
            reason="Nothing scheduled"
            hint={overview.nextSend ? overview.nextSend.providers.map((p) => networkFor(p)?.label ?? p).join(" · ") : undefined}
          />
          <Stat
            label="Free slots (7 days)"
            value={overview.slotsConfigured ? String(overview.freeSlotsAhead) : null}
            reason="No slots set"
            hint={overview.slotsConfigured ? `${overview.timeZone}${overview.timeZoneConfigured ? "" : " (default)"}` : undefined}
          />
          <Stat
            label="Scheduled"
            value={String(overview.counts.scheduled)}
            hint={`${overview.counts.drafts} draft${overview.counts.drafts === 1 ? "" : "s"}`}
          />
          <Stat
            label="Published (30 days)"
            value={String(overview.counts.postedLast30)}
            hint={`${overview.counts.postedAllTime} all time`}
          />
        </div>

        {!overview.zernioReady && (
          <p className="text-[11px] mt-3 px-2 py-1.5 rounded-lg" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>
            This workspace has no Zernio API key of its own, so nothing can publish.
          </p>
        )}
      </div>

      {/* ── Attention ──────────────────────────────────────────────────────── */}
      {/* Split by severity, and NO count chip on either heading: the sub-nav
          badge is already a number, and it counts only what the layout can
          cheaply aggregate. Two numbers that disagree on the same screen is
          worse than one number and a list. */}
      <div className="flex items-center gap-2 mb-2 mt-6">
        <AlertTriangle className="w-4 h-4" style={{ color: warn.length ? "var(--amber-on)" : "var(--green-on)" }} />
        <h2 className="font-mono font-bold text-sm">Needs you</h2>
      </div>
      {warn.length === 0 ? (
        <div className="card text-xs flex items-center gap-2" style={{ borderColor: "var(--green)" }}>
          <Check className="w-4 h-4" style={{ color: "var(--green-on)" }} />
          Nothing waiting. Accounts are connected, nothing is held for review, and no send has failed.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {warn.map((item) => <AttentionCard key={item.kind} item={item} />)}
        </div>
      )}

      {info.length > 0 && (
        <>
          <div className="flex items-center gap-2 mb-2 mt-6">
            <Info className="w-4 h-4" style={{ color: "var(--blue-on)" }} />
            <h2 className="font-mono font-bold text-sm">Worth knowing</h2>
          </div>
          <div className="flex flex-col gap-2">
            {info.map((item) => <AttentionCard key={item.kind} item={item} />)}
          </div>
        </>
      )}

      {/* ── Next out ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-2 mt-6">
        <CalendarClock className="w-4 h-4" style={{ color: "var(--blue-on)" }} />
        <h2 className="font-mono font-bold text-sm">Going out next</h2>
        <span className="flex-1" />
        <Link href="/social/calendar" className="btn sm">Open calendar</Link>
      </div>
      {upcoming.length === 0 ? (
        <div className="card text-xs text-[var(--mute)]">
          Nothing scheduled.{" "}
          <Link href="/social/compose" className="underline">Compose a post</Link> and queue it into the next free slot.
        </div>
      ) : (
        <div className="card flex flex-col divide-y divide-[var(--line)]">
          {upcoming.map((p) => (
            <Link key={p.id} href={`/social/${p.id}/edit`} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0 group">
              <span className="font-mono text-[11px] text-[var(--mute)] w-32 flex-shrink-0 pt-0.5">
                {p.scheduledAt?.toLocaleString("en-GB", {
                  timeZone: overview.timeZone, weekday: "short", day: "2-digit", month: "short",
                  hour: "2-digit", minute: "2-digit",
                })}
              </span>
              <span className="flex-1 min-w-0 text-xs text-[var(--slate)] truncate group-hover:underline">
                {p.text || <span className="italic text-[var(--mute)]">(image only)</span>}
              </span>
              <span className="flex gap-1 flex-shrink-0">
                {p.targets.map((t) => {
                  const net = networkFor(t.provider);
                  return (
                    <span key={t.id} className="w-2 h-2 rounded-full" title={net?.label ?? t.provider}
                      style={{ background: net?.color ?? "var(--mute)" }} />
                  );
                })}
              </span>
              {p.approval === "pending" && (
                <span className="font-mono text-[9.5px] px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
                  held
                </span>
              )}
            </Link>
          ))}
        </div>
      )}

      {/* ── Performance snapshot ───────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-2 mt-6">
        <BarChart3 className="w-4 h-4" style={{ color: "var(--green-on)" }} />
        <h2 className="font-mono font-bold text-sm">Engagement, last 30 days</h2>
        <span className="flex-1" />
        <Link href="/social/performance" className="btn sm">All posts</Link>
      </div>
      {!hasEngagement ? (
        <div className="card text-xs text-[var(--mute)]">
          {/* Blank ≠ zero: say WHY it's blank. */}
          No engagement pulled back yet — the networks are asked for it on demand, not continuously.{" "}
          <Link href="/social/performance" className="underline">Pull engagement</Link> once something has been posted.
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {networks.map((n) => {
            const net = networkFor(n.provider);
            return (
              <div key={n.provider} className="card">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: net?.color ?? "var(--mute)" }} />
                  <span className="text-xs font-semibold">{net?.label ?? n.provider}</span>
                  <span className="flex-1" />
                  <span className="font-mono text-[10px] text-[var(--mute)]">{n.posts} post{n.posts === 1 ? "" : "s"}</span>
                </div>
                <div className="flex gap-4">
                  <Mini label="impressions" value={n.impressions} />
                  <Mini label="engagement" value={n.engagement} />
                  <Mini label="clicks" value={n.clicks} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Recent ─────────────────────────────────────────────────────────── */}
      {recent.length > 0 && (
        <>
          <div className="flex items-center gap-2 mb-2 mt-6">
            <Send className="w-4 h-4" style={{ color: "var(--green-on)" }} />
            <h2 className="font-mono font-bold text-sm">Recently published</h2>
          </div>
          <div className="card flex flex-col divide-y divide-[var(--line)]">
            {recent.map((p) => (
              <div key={p.id} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
                <span className="font-mono text-[11px] text-[var(--mute)] w-28 flex-shrink-0 pt-0.5">
                  {p.publishedAt
                    ? p.publishedAt.toLocaleString("en-GB", { timeZone: overview.timeZone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
                    : "—"}
                </span>
                <span className="flex-1 min-w-0 text-xs text-[var(--slate)] truncate">{p.text}</span>
                <span className="flex gap-1.5 flex-shrink-0">
                  {p.targets.map((t) => {
                    const net = networkFor(t.provider);
                    const label = net?.label ?? t.provider;
                    // A live URL is the only proof a leg really landed, so link it.
                    return t.platformPostUrl ? (
                      <a key={t.id} href={t.platformPostUrl} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.5 rounded-full border hover:underline"
                        style={{ borderColor: net?.color ?? "var(--line-2)" }} title={`Open on ${label}`}>
                        {label}<ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    ) : (
                      <span key={t.id} className="text-[10px] font-mono px-1.5 py-0.5 rounded-full border"
                        style={{
                          borderColor: t.status === "failed" ? "var(--rose)" : "var(--line-2)",
                          color: t.status === "failed" ? "var(--rose-on)" : "var(--mute)",
                        }}
                        title={t.status === "failed" ? "This leg failed" : "No public URL reported by the network"}>
                        {label}
                      </span>
                    );
                  })}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Automation ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-2 mt-6">
        <Sparkles className="w-4 h-4" style={{ color: "var(--violet-on)" }} />
        <h2 className="font-mono font-bold text-sm">Running unattended</h2>
        <span className="flex-1" />
        {isAdmin && <Link href="/social/settings" className="btn sm">Change</Link>}
      </div>
      <div className="card flex flex-wrap gap-1.5">
        <Dial on={autogenOn} label={autogenOn ? `auto-generate ${autogenWeekly}/wk` : "auto-generate off"} />
        <Dial on={evergreenFill} label={`evergreen fill ${evergreenFill ? "on" : "off"}`} />
        <Dial on={autoImage} label={`auto-image ${autoImage ? "on" : "off"}`} />
        <Dial on={requireApproval} label={`approval ${requireApproval ? "required" : "off"}`} />
        <Dial on={utmOn} label={`link tagging ${utmOn ? "on" : "off"}`} />
      </div>
    </div>
  );
}

/**
 * A single figure. `value: null` renders a dash and the reason — never a zero,
 * which would assert something we haven't measured.
 */
function Stat({ label, value, reason, hint }: { label: string; value: string | null; reason?: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-[var(--line)] px-2.5 py-2">
      <div className="font-mono text-[9.5px] uppercase tracking-wider text-[var(--mute)]">{label}</div>
      {value === null ? (
        <>
          <div className="text-lg font-bold leading-tight text-[var(--mute)]">—</div>
          {reason && <div className="text-[10px] text-[var(--mute)]">{reason}</div>}
        </>
      ) : (
        <>
          <div className="text-lg font-bold leading-tight">{value}</div>
          {hint && <div className="text-[10px] text-[var(--mute)] truncate" title={hint}>{hint}</div>}
        </>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div className="text-sm font-bold leading-tight">
        {value === null ? <span className="text-[var(--mute)]">—</span> : value.toLocaleString("en-GB")}
      </div>
      <div className="font-mono text-[9px] uppercase tracking-wider text-[var(--mute)]">{label}</div>
    </div>
  );
}

function Dial({ on, label }: { on: boolean; label: string }) {
  return (
    <span className="font-mono text-[10px] px-2 py-1 rounded-full"
      style={{ background: on ? "var(--green-soft)" : "var(--zebra)", color: on ? "var(--green-on)" : "var(--mute)" }}>
      {label}
    </span>
  );
}

function AttentionCard({ item }: { item: AttentionItem }) {
  const warn = item.severity === "warn";
  return (
    <div className="card flex items-start gap-2.5" style={{ borderColor: warn ? "var(--amber)" : "var(--line)" }}>
      <span className="mt-0.5 flex-shrink-0">
        {warn
          ? <AlertTriangle className="w-4 h-4" style={{ color: "var(--amber-on)" }} />
          : <Info className="w-4 h-4" style={{ color: "var(--blue-on)" }} />}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{item.title}</div>
        <div className="text-xs text-[var(--mute)] leading-relaxed">{item.detail}</div>
      </div>
      <Link href={item.href} className="btn sm flex-shrink-0">{item.cta}</Link>
    </div>
  );
}
