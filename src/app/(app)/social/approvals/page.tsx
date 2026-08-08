import Link from "next/link";
import { ShieldCheck, Check } from "lucide-react";
import { requireRole, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { getQueue } from "@/lib/social/slots";
import { Banner, PostCard, Section, SocialHeader } from "@/components/SocialPostCard";

// The review queue. A queue nobody sees is a queue nobody clears, which is why
// it gets its own tab with an urgent badge rather than a section three screens
// down the scheduler.

type SP = { ok?: string; err?: string };

export default async function SocialApprovalsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { workspace, membership } = await requireRole("EDITOR");
  const { ok, err } = await searchParams;
  const isAdmin = canAdmin(membership.role);

  const [posts, queue, requireApproval] = await Promise.all([
    db.socialPost.findMany({
      where: { workspaceId: workspace.id, approval: { in: ["pending", "changes"] } },
      orderBy: { createdAt: "desc" },
      include: {
        targets: true,
        topic: { select: { name: true } },
        campaign: { select: { name: true, color: true } },
        recycledFrom: { select: { id: true } },
      },
    }),
    getQueue(workspace.id),
    getSetting("social:require_approval", workspace.id).catch(() => "").then((v) => v === "true"),
  ]);

  const awaiting = posts.filter((p) => p.approval === "pending");
  const changes = posts.filter((p) => p.approval === "changes");
  const hasSlots = queue.slots.some((s) => s.enabled);

  return (
    <div className="p-6 w-full">
      <SocialHeader
        icon={<ShieldCheck className="w-6 h-6" strokeWidth={2.25} />}
        title="Approvals"
        blurb="Posts held for review. Nothing here can be sent, scheduled, queued or dragged until it's approved."
      />

      {ok && <Banner kind="ok" text={ok} />}
      {err && <Banner kind="err" text={err} />}

      {!requireApproval && (
        <div className="card mb-4 text-xs text-[var(--mute)]">
          The approval workflow is <b>off</b>, so new posts go straight to the queue. Anything listed below was held
          while it was on.{" "}
          {isAdmin && <Link href="/social/settings" className="underline">Turn it on in Settings</Link>}
        </div>
      )}

      {!isAdmin && awaiting.length > 0 && (
        <div className="card mb-4 text-xs text-[var(--mute)]">
          Only workspace admins can approve. Yours are listed here so you can see where they stand — editing one
          resubmits it.
        </div>
      )}

      {awaiting.length === 0 && changes.length === 0 ? (
        <div className="card text-xs flex items-center gap-2" style={{ borderColor: "var(--green)" }}>
          <Check className="w-4 h-4" style={{ color: "var(--green-on)" }} />
          Nothing waiting for review.
        </div>
      ) : (
        <>
          {awaiting.length > 0 && (
            <>
              <Section icon={<ShieldCheck className="w-4 h-4" style={{ color: "var(--amber-on)" }} />} title="Awaiting approval" count={awaiting.length} />
              <div className="flex flex-col gap-2 mb-6">
                {awaiting.map((p) => (
                  <PostCard key={p.id} post={p} canQueue={hasSlots} timeZone={queue.timeZone} isAdmin={isAdmin} approvalOn={requireApproval} />
                ))}
              </div>
            </>
          )}

          {changes.length > 0 && (
            <>
              <Section icon={<ShieldCheck className="w-4 h-4" style={{ color: "var(--rose-on)" }} />} title="Changes requested" count={changes.length} />
              <p className="text-[11px] text-[var(--mute)] mb-2">
                Editing one of these answers the note and resubmits it for approval automatically.
              </p>
              <div className="flex flex-col gap-2 mb-6">
                {changes.map((p) => (
                  <PostCard key={p.id} post={p} canQueue={hasSlots} timeZone={queue.timeZone} isAdmin={isAdmin} approvalOn={requireApproval} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
