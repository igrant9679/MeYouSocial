import Link from "next/link";
import { Clapperboard } from "lucide-react";
import { requireMembership, canAdmin } from "@/lib/acl";
import { getActiveChannel } from "@/lib/channel";
import { db } from "@/lib/db";
import { studioState } from "@/lib/studio";
import { getModes, isGloballyPaused } from "@/lib/governance";
import { StageHeader, StageList, StageRow, StateChip } from "@/components/StageShell";
import { EmptyState } from "@/components/EmptyState";

// Drafts stage: everything being written or rendered, by format — articles
// always; scripts and video renders when the video studio is shown (a YouTube
// channel exists and the switch under Settings is on — One-Loop step 6).

const BLOG_HUE: Record<string, string> = { drafting: "amber", draft_review: "blue" };

export default async function DraftsStage() {
  const { workspace, membership } = await requireMembership();
  const { active } = await getActiveChannel();
  const admin = canAdmin(membership.role);
  const studio = await studioState(workspace.id);
  const [posts, scripts, renders, counts, approvedIdeas, paused, modes] = await Promise.all([
    db.blogPost.findMany({
      where: { workspaceId: workspace.id, status: { in: ["drafting", "draft_review"] } },
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: { id: true, title: true, status: true, updatedAt: true, body: true },
    }),
    studio.show
      ? db.script.findMany({
          where: { channel: { workspaceId: workspace.id }, status: "draft" },
          orderBy: { updatedAt: "desc" },
          take: 6,
          select: { id: true, title: true, workflow: true, wordCount: true, updatedAt: true, channel: { select: { name: true } } },
        })
      : Promise.resolve([]),
    studio.show
      ? db.videoRender.findMany({
          where: { workspaceId: workspace.id, status: { in: ["queued", "rendering"] } },
          orderBy: { createdAt: "desc" },
          take: 6,
          select: { id: true, status: true, createdAt: true },
        })
      : Promise.resolve([]),
    db.blogPost.groupBy({ by: ["status"], where: { workspaceId: workspace.id, status: { in: ["drafting", "draft_review"] } }, _count: { _all: true } }),
    // ⚠ The empty state has to say WHY nothing is being written, and there are
    // two different answers: the queue is empty, or the queue is full and the
    // autopilot simply hasn't got to it (audit B6/D4).
    db.blogIdea.count({ where: { workspaceId: workspace.id, status: "approved" } }),
    // ⚠ An empty Articles list does NOT mean the pool is empty — that is only
    // ONE of the reasons nothing is being written, and the app knows which.
    // The troubleshooting table lists five (empty pool, weekly target reached,
    // daily budget spent, drafting set to manual, global pause). Naming the
    // wrong one sends someone to approve an idea that will then sit there
    // because the pause is on. Both reads are 30s-cached settings lookups.
    isGloballyPaused(workspace.id),
    getModes(workspace.id),
  ]);
  // Ordered by which blocker actually dominates: a pause stops everything, a
  // manual mode stops the sweep, and only then does the pool matter.
  const notDrafting = paused
    ? { why: "the global pause is on, so no AI action runs at all", label: "Open Automation", href: "/setup/automation" }
    : modes.blog_drafting === "manual"
      ? { why: "blog drafting is set to manual, so it only runs when someone asks for it", label: "Open Automation", href: "/setup/automation" }
      : approvedIdeas === 0
        ? { why: "no idea has been approved yet — drafting only ever consumes approved ideas", label: "Approve an idea", href: "/ideas" }
        : null;
  const n = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;

  return (
    <div>
      <StageHeader
        title="Drafts"
        sentence={
          posts.length
            ? `${posts.length} article${posts.length === 1 ? "" : "s"} in progress — review happens one stage on.`
            : notDrafting
              ? `Nothing is being written: ${notDrafting.why}.`
              : `Nothing is being written yet — ${approvedIdeas} approved idea${approvedIdeas === 1 ? " is" : "s are"} queued, and the autopilot drafts them on its weekly allowance.`
        }
        counts={[
          { label: "drafting", n: n("drafting"), href: "/blog?view=list", hue: "amber" },
          { label: "in review", n: n("draft_review"), href: "/inbox", hue: "blue" },
          ...(studio.show
            ? [
                { label: "scripts", n: scripts.length, href: active ? `/channels/${active.id}/scripts` : "/scripts", hue: "green" },
                { label: "renders", n: renders.length, href: "/videos", hue: "violet" },
              ]
            : []),
        ]}
      />

      <StageList
        title="Articles"
        empty={
          <EmptyState
            variant="inline"
            line={notDrafting ? `No article is drafting: ${notDrafting.why}.` : "No article is drafting or in review right now."}
            action={notDrafting ? { label: notDrafting.label, href: notDrafting.href } : { label: "See the approved ideas", href: "/ideas" }}
          />
        }
      >
        {posts.length > 0 ? posts.map((p) => (
          <StageRow key={p.id}>
            <StateChip label={p.status === "draft_review" ? "in review" : "drafting"} hue={BLOG_HUE[p.status] ?? "zebra"} />
            <div className="flex-1 min-w-48">
              <Link href={`/blog/${p.id}`} className="text-sm font-semibold hover:underline line-clamp-1">{p.title}</Link>
              <div className="text-[11px] text-[var(--mute)]">
                {p.body ? `${Math.round(p.body.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length)} words` : "no body yet"} · updated {p.updatedAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
              </div>
            </div>
            <Link href={`/blog/${p.id}`} className="btn sm">Open</Link>
          </StageRow>
        )) : undefined}
      </StageList>

      {studio.show && scripts.length > 0 && (
        <StageList title="Scripts">
          {scripts.map((s) => (
            <StageRow key={s.id}>
              <StateChip label={s.workflow} hue="green" />
              <div className="flex-1 min-w-48">
                <Link href={s.workflow === "builder" ? `/scripts/${s.id}/builder` : `/scripts/${s.id}`} className="text-sm font-semibold hover:underline line-clamp-1">{s.title}</Link>
                <div className="text-[11px] text-[var(--mute)]">{s.channel.name} · {s.wordCount} words</div>
              </div>
              <Link href={s.workflow === "builder" ? `/scripts/${s.id}/builder` : `/scripts/${s.id}`} className="btn sm">Open</Link>
            </StageRow>
          ))}
        </StageList>
      )}

      {studio.show && renders.length > 0 && (
        <StageList title="Video renders">
          {renders.map((r) => (
            <StageRow key={r.id}>
              <StateChip label={r.status} hue={r.status === "rendering" ? "amber" : "violet"} />
              <div className="flex-1 min-w-48 text-sm">Render started {r.createdAt.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
              <Link href={`/videos/${r.id}`} className="btn sm">Open</Link>
            </StageRow>
          ))}
        </StageList>
      )}

      {!studio.show && (
        <p className="text-[11px] text-[var(--mute)] mb-4 flex items-center gap-1.5">
          <Clapperboard className="w-3.5 h-3.5" />
          {studio.channels === 0
            ? <>Scripts, thumbnails, video renders and the production board appear here once a YouTube channel exists{admin ? <> — <Link href="/channels" className="underline">add one under Channels</Link></> : " (an admin adds one under Channels)"}.</>
            : <>The video studio is switched off for this workspace{admin ? <> — <Link href="/setup" className="underline">turn it on under Settings</Link></> : ""}. Nothing was deleted.</>}
        </p>
      )}

    </div>
  );
}
