import Link from "next/link";
import { AlertTriangle, Info, Check } from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";
import { getPostingTimeZone, formatInZone } from "@/lib/social/slots";
import { networkFor } from "@/lib/social/networks";
import { getSocialOverview, type AttentionItem } from "@/lib/social/overview";
import { Banner } from "@/components/SocialPostCard";
import { StageHeader, StageList, StageRow, StateChip } from "@/components/StageShell";
import { EmptyState } from "@/components/EmptyState";

// Distribute stage: the queue on the slot grid, the accounts and their
// health, what needs a person here, and what went out. Since One-Loop step 6
// this is also where the old Social overview's content lives (that page
// redirects here). Compose, Calendar and Engage are its tabs.

export default async function DistributeStage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { workspace } = await requireMembership();
  const { ok, err } = await searchParams;
  const now = new Date();
  const [tz, scheduled, drafts, unread, overview, recent] = await Promise.all([
    getPostingTimeZone(workspace.id),
    db.socialPost.findMany({
      where: { workspaceId: workspace.id, status: "scheduled", scheduledAt: { gte: now } },
      orderBy: { scheduledAt: "asc" },
      take: 10,
      include: { targets: { select: { provider: true } } },
    }),
    db.socialPost.count({ where: { workspaceId: workspace.id, status: "draft" } }),
    db.socialInboxEvent.count({ where: { workspaceId: workspace.id, readAt: null } }),
    getSocialOverview(workspace.id),
    db.socialPost.findMany({
      where: { workspaceId: workspace.id, status: { in: ["posted", "partial"] } },
      orderBy: { updatedAt: "desc" },
      take: 5,
      include: { targets: { select: { provider: true, status: true } } },
    }),
  ]);
  // Approvals are Review's; everything else Social flags is this stage's own.
  const attention = overview.attention.filter((a) => a.kind !== "awaiting-approval");
  const warn = attention.filter((a) => a.severity === "warn");
  const info = attention.filter((a) => a.severity === "info");
  const accounts = overview.accounts;

  return (
    <div>
      <StageHeader
        title="Distribute"
        sentence={
          overview.connectedCount === 0
            ? "No social accounts connected — connect one under Settings → Connections and the queue comes alive."
            : scheduled.length
              ? `Next send ${formatInZone(scheduled[0].scheduledAt!, tz)} (${tz}) — ${scheduled.length} in the queue.`
              : "Nothing in the queue. Approved drafts take the next free slot; compose one or queue a draft."
        }
        counts={[
          { label: "scheduled", n: scheduled.length, href: "/social/calendar", hue: "blue" },
          { label: "drafts", n: drafts, href: "/social/calendar", hue: "amber" },
          { label: "replies waiting", n: unread, href: "/social/engage", hue: "cyan" },
          { label: "published, 30 days", n: overview.counts.postedLast30, href: "/social/performance", hue: "green" },
          { label: "free slots, 7 days", n: overview.slotsConfigured ? overview.freeSlotsAhead : null, href: "/setup/schedule" },
        ]}
      />
      {ok && <Banner kind="ok" text={ok} />}
      {err && <Banner kind="err" text={err} />}

      {/* Accounts and their health — coloured by TROUBLE, not by our mirrored
          status: an account can be "connected" and still refusing to publish. */}
      <section className="card mb-4">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="font-mono text-[13px] font-bold m-0">Accounts</h2>
          <span className="flex-1" />
          <Link href="/admin/connections" className="btn sm">Manage</Link>
        </div>
        {accounts.length === 0 ? (
          <EmptyState variant="inline" line="No social account is connected yet, so there is nowhere for a post to go." note="Use this app's Connect buttons — not Zernio's dashboard, which leaves duplicate accounts behind." action={{ label: "Connect an account", href: "/admin/connections" }} />
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {accounts.map((a) => {
              const bad = a.trouble?.severity === "warn";
              const meh = a.trouble?.severity === "info";
              const hue = bad ? "var(--rose)" : meh ? "var(--amber)" : a.color;
              return (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1.5 text-[11px] font-mono px-2 py-1 rounded-full border"
                  style={{ borderColor: hue, background: bad ? "var(--rose-soft)" : "transparent", color: bad ? "var(--rose-on)" : "var(--slate)" }}
                  title={a.trouble ? `${a.name} — ${a.trouble.reason}.` : `${a.name} · ${a.scheduledAhead} scheduled leg${a.scheduledAhead === 1 ? "" : "s"} in the next 7 days`}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: hue }} />
                  {a.label}
                  {bad && <AlertTriangle className="w-3 h-3" />}
                  {!a.trouble && a.scheduledAhead > 0 && <span className="text-[9.5px] text-[var(--mute)]">{a.scheduledAhead}</span>}
                </span>
              );
            })}
          </div>
        )}
        {!overview.zernioReady && (
          <p className="text-[11px] mt-3 px-2 py-1.5 rounded-lg m-0" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>
            This workspace has no Zernio API key of its own, so nothing can publish. <Link href="/setup/connections" className="underline">Connections</Link>.
          </p>
        )}
      </section>

      {/* Needs you — this stage's own; approvals live under Review */}
      {warn.length === 0 && info.length === 0 ? (
        <div className="card text-xs flex items-center gap-2 mb-4" style={{ borderColor: "var(--green)" }}>
          <Check className="w-4 h-4" style={{ color: "var(--green-on)" }} /> Nothing here needs you: accounts are fine and no send has failed.
        </div>
      ) : (
        <section className="mb-4">
          {warn.length > 0 && (
            <>
              <h2 className="font-mono text-[13px] font-bold mb-2 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" style={{ color: "var(--amber-on)" }} /> Needs you</h2>
              <div className="flex flex-col gap-2 mb-3">{warn.map((a) => <Attention key={a.kind} item={a} />)}</div>
            </>
          )}
          {info.length > 0 && (
            <>
              <h2 className="font-mono text-[13px] font-bold mb-2 flex items-center gap-1.5"><Info className="w-4 h-4" style={{ color: "var(--blue-on)" }} /> Worth knowing</h2>
              <div className="flex flex-col gap-2">{info.map((a) => <Attention key={a.kind} item={a} />)}</div>
            </>
          )}
        </section>
      )}

      <StageList
        title="The queue"
        empty={<EmptyState variant="inline" line="Nothing is scheduled — an approved draft takes the next free slot in its category." action={{ label: "Compose a post", href: "/social/compose" }} />}
      >
        {scheduled.length > 0 ? scheduled.map((p) => (
          <StageRow key={p.id}>
            <StateChip label={formatInZone(p.scheduledAt!, tz)} hue="blue" />
            <div className="flex-1 min-w-48">
              <div className="text-sm leading-snug line-clamp-2">{p.text}</div>
              <div className="text-[11px] text-[var(--mute)]">
                {[...new Set(p.targets.map((t) => t.provider))].map((x) => networkFor(x)?.label ?? x).join(" · ") || "no network chosen"}
                {p.recycledFromId ? " · evergreen recycle" : ""}
              </div>
            </div>
            <Link href={`/social/${p.id}/edit`} className="btn sm">Open</Link>
          </StageRow>
        )) : undefined}
      </StageList>

      {recent.length > 0 && (
        <StageList title="Recently published">
          {recent.map((p) => {
            const failed = p.targets.filter((t) => t.status === "failed").length;
            return (
              <StageRow key={p.id}>
                <StateChip label={failed ? `${failed} leg${failed === 1 ? "" : "s"} failed` : "sent"} hue={failed ? "rose" : "green"} />
                <div className="flex-1 min-w-48">
                  <div className="text-sm leading-snug line-clamp-1">{p.text}</div>
                  <div className="text-[11px] text-[var(--mute)]">
                    {[...new Set(p.targets.map((t) => t.provider))].map((x) => networkFor(x)?.label ?? x).join(" · ")} · {p.updatedAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                  </div>
                </div>
                <Link href={`/social/${p.id}/edit`} className="btn sm">Open</Link>
              </StageRow>
            );
          })}
        </StageList>
      )}

      {unread > 0 && (
        <p className="text-xs mb-4">
          <b>{unread}</b> repl{unread === 1 ? "y is" : "ies are"} waiting under <Link href="/social/engage" className="underline">Engage</Link> — Facebook and Instagram DMs can only be answered within 24 hours of the person&apos;s message.
        </p>
      )}

    </div>
  );
}

function Attention({ item }: { item: AttentionItem }) {
  const warn = item.severity === "warn";
  return (
    <div className="card flex items-start gap-3 flex-wrap" style={warn ? { borderColor: "var(--amber)" } : undefined}>
      <div className="flex-1 min-w-56">
        <div className="text-sm font-semibold leading-snug">{item.title}</div>
        <div className="text-xs text-[var(--mute)] mt-0.5">{item.detail}</div>
      </div>
      <Link href={item.href} className={warn ? "btn sm primary" : "btn sm"}>{item.cta}</Link>
    </div>
  );
}
