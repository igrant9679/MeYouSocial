import Link from "next/link";
import { BarChart3, Send } from "lucide-react";
import { requireRole, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { SubmitButton } from "@/components/SubmitButton";
import { getQueue } from "@/lib/social/slots";
import { readingsForWorkspace, byNetwork } from "@/lib/social/performance";
import { networkFor } from "@/lib/social/networks";
import { syncSocialPerformanceAction } from "@/app/actions/social-slots";
import { Banner, Empty, PostCard, Section, SocialHeader } from "@/components/SocialPostCard";

// What went out, and what came back. Engagement is pulled on demand rather than
// polled, so an empty panel means "not asked yet" — and says so.

type SP = { ok?: string; err?: string };

const DAY = 24 * 60 * 60 * 1000;

export default async function SocialPerformancePage({ searchParams }: { searchParams: Promise<SP> }) {
  const { workspace, membership } = await requireRole("EDITOR");
  const { ok, err } = await searchParams;
  const isAdmin = canAdmin(membership.role);

  const [history, queue, requireApproval, readings] = await Promise.all([
    db.socialPost.findMany({
      where: { workspaceId: workspace.id, status: { in: ["posted", "partial", "failed", "publishing"] } },
      orderBy: { createdAt: "desc" },
      include: {
        targets: true,
        topic: { select: { name: true } },
        campaign: { select: { name: true, color: true } },
        recycledFrom: { select: { id: true } },
      },
      take: 100,
    }),
    getQueue(workspace.id),
    getSetting("social:require_approval", workspace.id).catch(() => "").then((v) => v === "true"),
    readingsForWorkspace(workspace.id, new Date(Date.now() - 90 * DAY)),
  ]);

  const networks = byNetwork(readings);

  return (
    <div className="p-6 w-full">
      <SocialHeader
        icon={<BarChart3 className="w-6 h-6" strokeWidth={2.25} />}
        title="Performance"
        blurb="Every published post, per network, with the engagement each one reported back."
      >
        {history.length > 0 && (
          <form action={syncSocialPerformanceAction}>
            <SubmitButton className="btn sm" pendingText="Pulling…" title="Pull likes, comments, shares and impressions back from each network">
              <BarChart3 className="w-3.5 h-3.5" /> Pull engagement
            </SubmitButton>
          </form>
        )}
      </SocialHeader>

      {ok && <Banner kind="ok" text={ok} />}
      {err && <Banner kind="err" text={err} />}

      {/* Per-network rollup — 90 days. */}
      {networks.length === 0 ? (
        <div className="card mb-4 text-xs text-[var(--mute)]">
          {/* Blank ≠ zero. Say which of the two this is. */}
          No engagement figures yet. Networks are asked for them on demand — hit <b>Pull engagement</b> above once
          something has been published. Figures that a network doesn&apos;t report stay blank rather than becoming zero.
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 mb-6">
          {networks.map((n) => {
            const net = networkFor(n.provider);
            return (
              <div key={n.provider} className="card">
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: net?.color ?? "var(--mute)" }} />
                  <span className="text-sm font-semibold">{net?.label ?? n.provider}</span>
                  <span className="flex-1" />
                  <span className="font-mono text-[10px] text-[var(--mute)]">{n.posts} post{n.posts === 1 ? "" : "s"}</span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <Metric label="impressions" value={n.impressions} />
                  <Metric label="engagement" value={n.engagement} />
                  <Metric label="clicks" value={n.clicks} />
                  <Metric label="eng. rate" value={n.engagementRate} suffix="%" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Section icon={<Send className="w-4 h-4" style={{ color: "var(--green-on)" }} />} title="History" count={history.length} />
      {history.length === 0 ? (
        <Empty text="Posts you publish appear here with per-network status." />
      ) : (
        <div className="flex flex-col gap-2">
          {history.map((p) => (
            <PostCard key={p.id} post={p} timeZone={queue.timeZone} isAdmin={isAdmin} approvalOn={requireApproval} />
          ))}
        </div>
      )}

      <p className="text-[11px] text-[var(--mute)] mt-4">
        Looking for search and traffic instead? That lives on{" "}
        <Link href="/insights" className="underline">Insights</Link>, which joins these numbers to GA4 and Search Console.
      </p>
    </div>
  );
}

/** A measured figure, or a dash. Never a zero standing in for "unknown". */
function Metric({ label, value, suffix = "" }: { label: string; value: number | null; suffix?: string }) {
  return (
    <div>
      <div className="text-sm font-bold leading-tight">
        {value === null
          ? <span className="text-[var(--mute)]" title="Not reported by this network">—</span>
          : `${value.toLocaleString("en-GB")}${suffix}`}
      </div>
      <div className="font-mono text-[9px] uppercase tracking-wider text-[var(--mute)]">{label}</div>
    </div>
  );
}
